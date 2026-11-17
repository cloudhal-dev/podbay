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
			left.push(`${attachment.filename} (can do harm when opened)`);
		} else if (total + attachment.size > MAX_ATTACHMENTS_BYTES) {
			left.push(`${attachment.filename} (too large to send with the rest)`);
		} else {
			try {
				const blob = await api.getAttachment(mailboxId, emailId, attachment.id);
				files.push(new File([blob], attachment.filename, { type: attachment.mimetype }));
				total += attachment.size;
			} catch {
				left.push(`${attachment.filename} (could not be fetched)`);
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

	return `<p><br></p>${sigBlock ? `${sigBlock}<br>` : ""}<div style="border: 1px solid #ddd; padding: 1em; background-color: #f9f9f9; margin: 1em 0;"><strong>Forwarded message:</strong><br><strong>From:</strong> ${safeSender}<br><strong>Date:</strong> ${formatComposeDate(original.date)}<br><strong>Subject:</strong> ${safeSubject}<br><br>${safeBody}</div>`;
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
	/** The draft this window saved, so saving again replaces it and sending removes it. */
	const [savedDraftId, setSavedDraftId] = useState<string | null>(null);
	/** Whether the person wrote anything since the window opened or the draft was last saved. */
	const [touched, setTouched] = useState(false);
	/** The files to send with the message. They live in this window only: a draft does not keep them. */
	const [files, setFiles] = useState<File[]>([]);
	/** Files of a forwarded message that are not carried, each with the reason. */
	const [leftBehind, setLeftBehind] = useState<string[]>([]);
	const lastInitializedOptionsRef = useRef<typeof composeOptions | null>(null);
	const isDraftEdit = !!composeOptions.draftEmail;

	const formTitle = useMemo(() => {
		if (isDraftEdit) return "Edit Draft";
		switch (composeOptions.mode) {
			case "reply":
				return "Reply";
			case "reply-all":
				return "Reply All";
			case "forward":
				return "Forward";
			default:
				return "New Message";
		}
	}, [composeOptions.mode, isDraftEdit]);

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
		setSavedDraftId(null);
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

	const handleSaveDraft = async (): Promise<boolean> => {
		if (!mailboxId || isSending) return false;
		setIsSavingDraft(true);
		setError(null);
		try {
			const saved = (await saveDraftMutation.mutateAsync({
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
					draft_id: savedDraftId || composeOptions.draftEmail?.id || undefined,
				},
			})) as { id?: string } | undefined;
			if (saved?.id) setSavedDraftId(saved.id);
			setTouched(false);
			toastManager.add({ title: "Draft saved" });
			return true;
		} catch (err: unknown) {
			const message = (err instanceof Error ? err.message : null) || "Failed to save draft.";
			setError(message);
			toastManager.add({ title: message, variant: "error" });
			return false;
		} finally {
			setIsSavingDraft(false);
		}
	};

	/** Closing keeps what was written: it is saved as a draft first, and stays open if that fails. */
	const saveAndClose = async () => {
		if (isSending) return;
		if (touched && !(await handleSaveDraft())) return;
		closeCompose();
	};

	/** Discarding throws away what this window wrote, including a draft it saved itself. */
	const discard = () => {
		if (isSending) return;
		if (mailboxId && savedDraftId) deleteEmailMutation.mutate({ mailboxId, id: savedDraftId });
		closeCompose();
	};

	/** Adds files, unless together they would be more than a message can carry. */
	const addFiles = (added: Iterable<File>) => {
		const next = [...files, ...added];
		const total = next.reduce((sum, file) => sum + file.size, 0);
		if (total > MAX_ATTACHMENTS_BYTES) {
			setError(
				`Attached files can be ${Math.floor(MAX_ATTACHMENTS_BYTES / (1024 * 1024))} MB together. These would be ${Math.ceil(total / (1024 * 1024))} MB.`,
			);
			return;
		}
		setError(null);
		setFiles(next);
		setTouched(true);
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
			setError("No mailbox selected.");
			return;
		}
		const toRecipients = splitEmailList(to);
		if (toRecipients.length === 0) {
			setError("Add at least one recipient.");
			return;
		}
		const ccRecipients = splitEmailList(cc);
		const bccRecipients = splitEmailList(bcc);
		if (toRecipients.length + ccRecipients.length + bccRecipients.length > MAX_RECIPIENTS) {
			setError(`A message can go to ${MAX_RECIPIENTS} recipients at most.`);
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
		const draftId = savedDraftId || composeOptions.draftEmail?.id;
		const mode = composeOptions.mode;
		const originalId = composeOptions.originalEmail?.id || composeOptions.draftEmail?.in_reply_to;
		setIsSending(true);
		try {
			if ((mode === "reply" || mode === "reply-all") && originalId)
				await replyMutation.mutateAsync({ mailboxId, emailId: originalId, email: emailData });
			else if (mode === "forward" && originalId)
				await forwardMutation.mutateAsync({ mailboxId, emailId: originalId, email: emailData });
			else await sendEmailMutation.mutateAsync({ mailboxId, email: emailData });
			if (draftId) deleteEmailMutation.mutate({ mailboxId, id: draftId });
			const answered = composeOptions.originalEmail;
			if (archive && answered && answered.folder_id === Folders.INBOX) {
				moveEmailMutation.mutate({ mailboxId, id: answered.id, folderId: Folders.ARCHIVE });
				closePanel();
				toastManager.add({ title: "Message sent and conversation archived" });
			} else {
				toastManager.add({ title: "Message sent" });
			}
			onClose();
		} catch (err: unknown) {
			const message = (err instanceof Error ? err.message : null) || "Failed to send email.";
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
		formTitle,
		handleSaveDraft,
		handleSend,
		knownAddresses,
		files,
		leftBehind,
		addFiles,
		removeFile,
		saveAndClose,
		discard,
		touch: () => setTouched(true),
		mode: composeOptions.mode,
		isDraftEdit,
		closeCompose,
		closePanel,
	};
}
