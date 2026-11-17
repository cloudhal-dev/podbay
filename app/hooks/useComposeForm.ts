// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified by the Podbay contributors.

import { useKumoToastManager } from "@cloudflare/kumo";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { attachmentRisk } from "shared/attachment-risk";
import { Folders } from "shared/folders";
import { MAX_ATTACHMENTS_BYTES, MAX_RECIPIENTS } from "shared/sending-limits";
import { useKnownAddresses } from "~/hooks/useKnownAddresses";
import { useUIStore } from "~/hooks/useUIStore";
import { quoteLanguage, t } from "~/i18n";
import {
	buildQuotedReplyBlock,
	escapeHtml,
	formatComposeDate,
	getSignatureBlock,
	htmlToPlainText,
	splitEmailList,
	stripHtml,
	toEmailListValue,
} from "~/lib/utils";
import {
	useDeleteEmail,
	useForwardEmail,
	useMoveEmail,
	useReplyToEmail,
	useSaveDraft,
	useSendEmail,
} from "~/queries/emails";
import { useMailbox } from "~/queries/mailboxes";
import api from "~/services/api";
import type { Attachment } from "~/types";

function appendUniqueAddress(
	addresses: string[],
	seen: Set<string>,
	address: string,
	exclude?: string,
) {
	const trimmed = address.trim();
	if (!trimmed) return;

	const normalized = trimmed.toLowerCase();
	if (normalized === exclude || seen.has(normalized)) return;

	seen.add(normalized);
	addresses.push(trimmed);
}

/**
 * The files of a message, fetched to travel with a forward of it. One that can do harm when
 * opened is not fetched: the reader would have to ask for it, and a forward must not pass it on
 * without that. Files beyond what a message can carry are left behind too.
 */
async function carryFiles(
	mailboxId: string,
	emailId: string,
	attachments: readonly Attachment[],
): Promise<{ files: File[]; left: string[] }> {
	const files: File[] = [];
	const left: string[] = [];
	let total = 0;
	for (const attachment of attachments) {
		// A picture shown inside the message is part of its text, not a file of it.
		if (attachment.disposition === "inline") continue;
		if (attachmentRisk(attachment) !== null) {
			left.push(t("{name} (can do harm when opened)", { name: attachment.filename }));
		} else if (total + attachment.size > MAX_ATTACHMENTS_BYTES) {
			left.push(t("{name} (too large to send with the rest)", { name: attachment.filename }));
		} else {
			try {
				const blob = await api.getAttachment(mailboxId, emailId, attachment.id);
				files.push(new File([blob], attachment.filename, { type: attachment.mimetype }));
				total += attachment.size;
			} catch {
				left.push(t("{name} (could not be fetched)", { name: attachment.filename }));
			}
		}
	}
	return { files, left };
}

/** A file as the send request carries it: its bytes as base64, and what it is. */
async function asAttachment(file: File) {
	const bytes = new Uint8Array(await file.arrayBuffer());
	let binary = "";
	// In pieces: one call with every byte as an argument overflows the stack on a large file.
	for (let start = 0; start < bytes.length; start += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
	}
	return {
		content: btoa(binary),
		filename: file.name,
		type: file.type || "application/octet-stream",
		disposition: "attachment" as const,
	};
}

/** How long after the last change what is written is saved by itself. */
const AUTOSAVE_AFTER_MS = 2500;

interface ComposeFormFields {
	to: string;
	cc: string;
	bcc: string;
	showCcBcc: boolean;
	subject: string;
	body: string;
}

const EMPTY_FIELDS: ComposeFormFields = {
	to: "",
	cc: "",
	bcc: "",
	showCcBcc: false,
	subject: "",
	body: "",
};

function getPrefixedSubject(subject: string, prefix: "Re" | "Fwd") {
	const expectedPrefix = `${prefix}: `;
	return subject.startsWith(expectedPrefix) ? subject : `${expectedPrefix}${subject}`;
}

function buildForwardBody(
	original: NonNullable<ReturnType<typeof useUIStore.getState>["composeOptions"]["originalEmail"]>,
	sigBlock: string,
) {
	const safeSender = escapeHtml(original.sender);
	const safeSubject = escapeHtml(original.subject);
	const safeBody = escapeHtml(stripHtml(original.body || "")).replace(/\n/g, "<br>");

	return `<p><br></p>${sigBlock ? `${sigBlock}<br>` : ""}<div style="border: 1px solid #ddd; padding: 1em; background-color: #f9f9f9; margin: 1em 0;"><strong>${escapeHtml(t("Forwarded message:"))}</strong><br><strong>${escapeHtml(t("From:"))}</strong> ${safeSender}<br><strong>${escapeHtml(t("Date:"))}</strong> ${formatComposeDate(original.date, quoteLanguage())}<br><strong>${escapeHtml(t("Subject:"))}</strong> ${safeSubject}<br><br>${safeBody}</div>`;
}

function buildReplyAllFields(
	original: NonNullable<ReturnType<typeof useUIStore.getState>["composeOptions"]["originalEmail"]>,
	selfAddress?: string,
) {
	const toRecipients: string[] = [];
	const toSeen = new Set<string>();
	appendUniqueAddress(toRecipients, toSeen, original.sender, selfAddress);

	for (const recipient of splitEmailList(original.recipient)) {
		appendUniqueAddress(toRecipients, toSeen, recipient, selfAddress);
	}

	const ccRecipients: string[] = [];
	const ccSeen = new Set<string>();
	for (const recipient of splitEmailList(original.cc)) {
		const normalized = recipient.toLowerCase();
		if (normalized === selfAddress || toSeen.has(normalized) || ccSeen.has(normalized)) {
			continue;
		}
		ccSeen.add(normalized);
		ccRecipients.push(recipient);
	}

	return {
		to: toRecipients.join(", "),
		cc: ccRecipients.join(", "),
		showCcBcc: ccRecipients.length > 0,
	};
}

function buildInitialComposeFields(
	composeOptions: ReturnType<typeof useUIStore.getState>["composeOptions"],
	mailboxEmail: string | undefined,
	sigBlock: string,
): ComposeFormFields {
	const { draftEmail: draft, originalEmail: original, mode } = composeOptions;

	if (draft) {
		return {
			to: draft.recipient || "",
			cc: draft.cc || "",
			bcc: draft.bcc || "",
			showCcBcc: Boolean(draft.cc || draft.bcc),
			subject: draft.subject || "",
			body: draft.body || "",
		};
	}

	if (!original) {
		return {
			...EMPTY_FIELDS,
			to: composeOptions.prefill?.to ?? "",
			subject: composeOptions.prefill?.subject ?? "",
			body: sigBlock ? `<p><br></p>${sigBlock}` : "",
		};
	}

	if (mode === "reply") {
		return {
			...EMPTY_FIELDS,
			to: original.sender,
			subject: getPrefixedSubject(original.subject, "Re"),
			body: `<p><br></p>${sigBlock ? `${sigBlock}<br>` : ""}${buildQuotedReplyBlock(original.date, original.sender, original.body || "")}`,
		};
	}

	if (mode === "reply-all") {
		const recipients = buildReplyAllFields(original, mailboxEmail?.toLowerCase());
		return {
			...EMPTY_FIELDS,
			...recipients,
			subject: getPrefixedSubject(original.subject, "Re"),
			body: `<p><br></p>${sigBlock ? `${sigBlock}<br>` : ""}${buildQuotedReplyBlock(original.date, original.sender, original.body || "")}`,
		};
	}

	if (mode === "forward") {
		return {
			...EMPTY_FIELDS,
			subject: getPrefixedSubject(original.subject, "Fwd"),
			body: buildForwardBody(original, sigBlock),
		};
	}

	return {
		...EMPTY_FIELDS,
		body: sigBlock ? `<p><br></p>${sigBlock}` : "",
	};
}

export type ComposeForm = ReturnType<typeof useComposeForm>;

export function useComposeForm(mailboxId?: string, _folder?: string) {
	const toastManager = useKumoToastManager();
	const { composeOptions, closePanel, closeCompose } = useUIStore();
	const { data: currentMailbox } = useMailbox(mailboxId);
	const knownAddresses = useKnownAddresses(mailboxId, currentMailbox?.email);
	const sendEmailMutation = useSendEmail();
	const saveDraftMutation = useSaveDraft();
	const replyMutation = useReplyToEmail();
	const forwardMutation = useForwardEmail();
	const deleteEmailMutation = useDeleteEmail();
	const moveEmailMutation = useMoveEmail();

	const [to, setTo] = useState("");
	const [cc, setCc] = useState("");
	const [bcc, setBcc] = useState("");
	const [showCcBcc, setShowCcBcc] = useState(false);
	const [subject, setSubject] = useState("");
	const [body, setBody] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [isSavingDraft, setIsSavingDraft] = useState(false);
	const [isSending, setIsSending] = useState(false);
	/** Whether the person wrote anything since the window opened or the draft was last saved. */
	const [touched, setTouched] = useState(false);
	/** The files to send with the message. They live in this window only: a draft does not keep them. */
	const [files, setFiles] = useState<File[]>([]);
	/** The draft this window saved, so saving again replaces it and sending or discarding removes it. */
	const draftId = useRef<string | null>(null);
	/** A save that is on its way, so that sending or discarding waits for it. */
	const pendingSave = useRef<Promise<boolean> | null>(null);
	/** Counts what the person did, so a save does not call something saved that came after it. */
	const version = useRef(0);
	/** When what is written was last saved by itself; shown as "Saved". */
	const [savedAt, setSavedAt] = useState<number | null>(null);
	const isComposing = useUIStore((state) => state.isComposing);
	/** Files of a forwarded message that are not carried, each with the reason. */
	const [leftBehind, setLeftBehind] = useState<string[]>([]);
	const lastInitializedOptionsRef = useRef<typeof composeOptions | null>(null);
	const isDraftEdit = !!composeOptions.draftEmail;

	const sigBlock = useMemo(() => getSignatureBlock(currentMailbox?.settings), [currentMailbox]);

	useEffect(() => {
		if (lastInitializedOptionsRef.current === composeOptions) return;
		lastInitializedOptionsRef.current = composeOptions;

		const initialFields = buildInitialComposeFields(
			composeOptions,
			currentMailbox?.email,
			sigBlock,
		);
		setError(null);
		draftId.current = null;
		setSavedAt(null);
		setTouched(false);
		setFiles([]);
		setTo(initialFields.to);
		setCc(initialFields.cc);
		setBcc(initialFields.bcc);
		setShowCcBcc(initialFields.showCcBcc);
		setSubject(initialFields.subject);
		setBody(initialFields.body);
		setLeftBehind([]);

		// A forward carries the files of the message it forwards. They are fetched as the reader
		// could download them, so one that can do harm when opened is left behind and named.
		const original = composeOptions.originalEmail;
		const carried = composeOptions.mode === "forward" ? (original?.attachments ?? []) : [];
		if (mailboxId && original && carried.length > 0) {
			void carryFiles(mailboxId, original.id, carried).then(({ files: fetched, left }) => {
				// Only if this is still the message being written.
				if (lastInitializedOptionsRef.current !== composeOptions) return;
				setFiles(fetched);
				setLeftBehind(left);
			});
		}
	}, [composeOptions, currentMailbox?.email, sigBlock, mailboxId]);

	/**
	 * Saves what is written as a draft. `quiet` is the save the window makes by itself while the
	 * person writes: it says nothing, and a failure is simply tried again after the next change.
	 */
	const saveDraft = async (quiet: boolean): Promise<boolean> => {
		if (!mailboxId || isSending) return false;
		// One save at a time: the next one must know the id the last one made.
		await pendingSave.current;
		const saving = version.current;
		if (!quiet) {
			setIsSavingDraft(true);
			setError(null);
		}
		try {
			const saved = await saveDraftMutation.mutateAsync({
				mailboxId,
				draft: {
					to,
					cc: cc || undefined,
					bcc: bcc || undefined,
					subject,
					body,
					in_reply_to:
						composeOptions.originalEmail?.id || composeOptions.draftEmail?.in_reply_to || undefined,
					thread_id:
						composeOptions.originalEmail?.thread_id ||
						composeOptions.draftEmail?.thread_id ||
						undefined,
					draft_id: draftId.current || composeOptions.draftEmail?.id || undefined,
				},
			});
			if (saved?.id) draftId.current = saved.id;
			// Only what was there when the save began is saved.
			if (version.current === saving) setTouched(false);
			setSavedAt(Date.now());
			if (!quiet) toastManager.add({ title: t("Draft saved") });
			return true;
		} catch (err: unknown) {
			if (quiet) return false;
			const message = (err instanceof Error ? err.message : null) || t("Failed to save draft.");
			setError(message);
			toastManager.add({ title: message, variant: "error" });
			return false;
		} finally {
			if (!quiet) setIsSavingDraft(false);
		}
	};
	const saveOnce = (quiet: boolean): Promise<boolean> => {
		const save = saveDraft(quiet).finally(() => {
			if (pendingSave.current === save) pendingSave.current = null;
		});
		pendingSave.current = save;
		return save;
	};
	const handleSaveDraft = () => saveOnce(false);

	// What is written is saved by itself a moment after the person stops writing, so a closed
	// tab or a lost connection costs a few words at most.
	// biome-ignore lint/correctness/useExhaustiveDependencies: the fields are the trigger; the save reads them when it runs
	useEffect(() => {
		if (!isComposing || !touched || isSending) return;
		const timer = setTimeout(() => void saveOnce(true), AUTOSAVE_AFTER_MS);
		return () => clearTimeout(timer);
	}, [isComposing, touched, isSending, to, cc, bcc, subject, body]);

	/** Closing keeps what was written: it is saved as a draft first, and stays open if that fails. */
	const saveAndClose = async () => {
		if (isSending) return;
		if (touched) {
			if (!(await handleSaveDraft())) return;
		} else {
			// Already saved while it was written: wait for a save on its way, and say it is kept.
			await pendingSave.current;
			if (draftId.current) toastManager.add({ title: t("Draft saved") });
		}
		closeCompose();
	};

	/** Discarding throws away what this window wrote, including a draft it saved itself. */
	const discard = () => {
		if (isSending) return;
		// A save on its way would bring the draft back: it is waited for, then the draft goes.
		const waited = pendingSave.current;
		void Promise.resolve(waited).then(() => {
			if (mailboxId && draftId.current) {
				deleteEmailMutation.mutate({ mailboxId, id: draftId.current });
			}
		});
		setTouched(false);
		closeCompose();
	};

	/** The person changed something: what is written is no longer what was saved. */
	const touch = () => {
		version.current += 1;
		setTouched(true);
	};

	/** Adds files, unless together they would be more than a message can carry. */
	const addFiles = (added: Iterable<File>) => {
		const next = [...files, ...added];
		const total = next.reduce((sum, file) => sum + file.size, 0);
		if (total > MAX_ATTACHMENTS_BYTES) {
			setError(
				t("Attached files can be {limit} MB together. These would be {size} MB.", {
					limit: Math.floor(MAX_ATTACHMENTS_BYTES / (1024 * 1024)),
					size: Math.ceil(total / (1024 * 1024)),
				}),
			);
			return;
		}
		setError(null);
		setFiles(next);
		touch();
	};
	const removeFile = (index: number) => setFiles(files.filter((_file, at) => at !== index));

	/**
	 * Sends the message. With `archive`, an answer also files the conversation it answers in
	 * Archive once it is sent, and goes back to the list.
	 */
	const handleSend = async (
		e: Pick<FormEvent, "preventDefault">,
		onClose: () => void,
		archive = false,
	) => {
		e.preventDefault();
		if (isSending) return;
		setError(null);
		if (!currentMailbox || !mailboxId) {
			setError(t("No mailbox selected."));
			return;
		}
		const toRecipients = splitEmailList(to);
		if (toRecipients.length === 0) {
			setError(t("Add at least one recipient."));
			return;
		}
		const ccRecipients = splitEmailList(cc);
		const bccRecipients = splitEmailList(bcc);
		if (toRecipients.length + ccRecipients.length + bccRecipients.length > MAX_RECIPIENTS) {
			setError(t("A message can go to {count} recipients at most.", { count: MAX_RECIPIENTS }));
			return;
		}
		const fromName = currentMailbox.settings?.fromName || currentMailbox.name;
		const from =
			fromName && fromName !== currentMailbox.email
				? { email: currentMailbox.email, name: fromName }
				: currentMailbox.email;
		const attachments = await Promise.all(files.map(asAttachment));
		const emailData = {
			...(attachments.length > 0 ? { attachments } : {}),
			to: toEmailListValue(toRecipients),
			cc: toEmailListValue(ccRecipients),
			bcc: toEmailListValue(bccRecipients),
			from,
			subject,
			html: body,
			text: htmlToPlainText(body),
		};
		// A draft saved a moment ago must be known before the message goes, or it would be left.
		await pendingSave.current;
		const sentDraftId = draftId.current || composeOptions.draftEmail?.id;
		const mode = composeOptions.mode;
		const originalId = composeOptions.originalEmail?.id || composeOptions.draftEmail?.in_reply_to;
		setIsSending(true);
		try {
			if ((mode === "reply" || mode === "reply-all") && originalId)
				await replyMutation.mutateAsync({ mailboxId, emailId: originalId, email: emailData });
			else if (mode === "forward" && originalId)
				await forwardMutation.mutateAsync({ mailboxId, emailId: originalId, email: emailData });
			else await sendEmailMutation.mutateAsync({ mailboxId, email: emailData });
			if (sentDraftId) deleteEmailMutation.mutate({ mailboxId, id: sentDraftId });
			const answered = composeOptions.originalEmail;
			if (archive && answered && answered.folder_id === Folders.INBOX) {
				moveEmailMutation.mutate({ mailboxId, id: answered.id, folderId: Folders.ARCHIVE });
				closePanel();
				toastManager.add({ title: t("Message sent and conversation archived") });
			} else {
				toastManager.add({ title: t("Message sent") });
			}
			onClose();
		} catch (err: unknown) {
			const message = (err instanceof Error ? err.message : null) || t("Failed to send email.");
			setError(message);
			toastManager.add({ title: message, variant: "error" });
		} finally {
			setIsSending(false);
		}
	};

	return {
		to,
		setTo,
		cc,
		setCc,
		bcc,
		setBcc,
		showCcBcc,
		setShowCcBcc,
		subject,
		setSubject,
		body,
		setBody,
		error,
		setError,
		isSavingDraft,
		isSending,
		handleSaveDraft,
		handleSend,
		knownAddresses,
		files,
		leftBehind,
		addFiles,
		removeFile,
		saveAndClose,
		discard,
		touch,
		/** Whether what is written is saved as it stands. */
		isSaved: savedAt !== null && !touched,
		mode: composeOptions.mode,
		isDraftEdit,
		closeCompose,
		closePanel,
	};
}
