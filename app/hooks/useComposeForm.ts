// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified by the Podbay contributors.

import { useKumoToastManager } from "@cloudflare/kumo";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Folders } from "shared/folders";
import { MAX_RECIPIENTS } from "shared/sending-limits";
import { useDisplay } from "~/hooks/useDisplay";
import { type DraftFile, type LeftBehind, useDraftFiles } from "~/hooks/useDraftFiles";
import { useKnownAddresses } from "~/hooks/useKnownAddresses";
import { type SendRoute, useSending } from "~/hooks/useSending";
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
import { useDeleteEmail, useInvalidateEmailData, useSaveDraft } from "~/queries/emails";
import { useMailbox } from "~/queries/mailboxes";
import api, { ApiError } from "~/services/api";

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
	const sending = useSending(mailboxId);
	const saveDraftMutation = useSaveDraft();
	const deleteEmailMutation = useDeleteEmail();
	const invalidate = useInvalidateEmailData();
	const conversations = useDisplay((state) => state.conversationView);

	const [to, setTo] = useState("");
	const [cc, setCc] = useState("");
	const [bcc, setBcc] = useState("");
	const [showCcBcc, setShowCcBcc] = useState(false);
	const [subject, setSubject] = useState("");
	const [body, setBody] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [isSavingDraft, setIsSavingDraft] = useState(false);
	const [isSending, setIsSending] = useState(false);
	/** Set at the first press of Send, before any wait, so a second press does not send again. */
	const sendingNow = useRef(false);
	/** Whether the person wrote anything since the window opened or the draft was last saved. */
	const [touched, setTouched] = useState(false);
	/** The draft of this window: saving again saves over it, and sending makes it the sent message. */
	const draftId = useRef<string | null>(null);
	/** Gives the draft's id, saving one first when there is none yet. Set below, once saving exists. */
	const ensureDraft = useRef<() => Promise<string | null>>(async () => null);
	/** The files of the message. They are the draft's: uploaded once, kept in every browser. */
	const draftFiles = useDraftFiles(mailboxId, () => ensureDraft.current(), setError);
	/** A save that is on its way, so that sending or discarding waits for it. */
	const pendingSave = useRef<Promise<boolean> | null>(null);
	/** Counts what the person did, so a save does not call something saved that came after it. */
	const version = useRef(0);
	/** When what is written was last saved by itself; shown as "Saved". */
	const [savedAt, setSavedAt] = useState<number | null>(null);
	const isComposing = useUIStore((state) => state.isComposing);
	const lastInitializedOptionsRef = useRef<typeof composeOptions | null>(null);
	const isDraftEdit = !!composeOptions.draftEmail;
	/** The mailbox the message being written belongs to: it is saved there, wherever the page went. */
	const writtenIn = useRef(mailboxId);
	/**
	 * Counts the messages this window began. A save that began for one message and ends after the
	 * next began leaves the next alone: it does not give it the first one's draft.
	 */
	const generation = useRef(0);
	/** The count of what the person did when what is written was last saved. */
	const savedVersion = useRef(0);
	/** Whether the message being written is being saved before the next one begins. */
	const keeping = useRef(false);
	/** Asks the window to look again at the message to begin, once the one written is kept. */
	const [kept, setKept] = useState(0);

	const sigBlock = useMemo(() => getSignatureBlock(currentMailbox?.settings), [currentMailbox]);

	// One message is written at a time (#113). When another begins (Compose, its key, an answer, a
	// forward, a draft opened, the window closed), what is written and not yet saved is saved as
	// its draft first, as closing does, and the next one begins only then. If that save fails, the
	// message being written stays open and says why; nothing is thrown away.
	// biome-ignore lint/correctness/useExhaustiveDependencies: a new message is the trigger; the files follow it
	useEffect(() => {
		if (keeping.current) return;
		const previous = lastInitializedOptionsRef.current;
		if (previous === composeOptions) return;
		// The draft being written, opened again from a list: it stays as it is, with every word
		// written since it was last saved.
		const opened = composeOptions.draftEmail?.id;
		if (previous && opened && opened === draftId.current && writtenIn.current === mailboxId) {
			lastInitializedOptionsRef.current = composeOptions;
			return;
		}
		if (previous && touched) {
			keeping.current = true;
			const sameMailbox = writtenIn.current === mailboxId;
			void keepWritten().then((saved) => {
				keeping.current = false;
				if (!saved && sameMailbox) {
					// The message written stays: the one asked for does not begin.
					useUIStore.setState({
						composeOptions: previous,
						composePlacement: "window",
						isComposing: true,
					});
					return;
				}
				setKept((count) => count + 1);
			});
			return;
		}
		lastInitializedOptionsRef.current = composeOptions;
		generation.current += 1;
		writtenIn.current = mailboxId;

		const initialFields = buildInitialComposeFields(
			composeOptions,
			currentMailbox?.email,
			sigBlock,
		);
		setError(null);
		// A draft that is opened again keeps its id: it is saved over, not replaced (ADR-0011).
		const editing = composeOptions.draftEmail;
		draftId.current = editing?.id ?? null;
		setSavedAt(null);
		setTouched(false);
		draftFiles.reset(editing?.attachments ?? []);
		setTo(initialFields.to);
		setCc(initialFields.cc);
		setBcc(initialFields.bcc);
		setShowCcBcc(initialFields.showCcBcc);
		setSubject(initialFields.subject);
		setBody(initialFields.body);

		// A draft opened from a list comes without its files: they are asked for.
		if (mailboxId && editing && editing.attachments === undefined) {
			void api.getEmail(mailboxId, editing.id).then((whole) => {
				if (lastInitializedOptionsRef.current === composeOptions) {
					draftFiles.reset(whole.attachments ?? []);
				}
			});
		}
		// A forward carries the files of the message it forwards. They are copied inside the
		// account; one that can do harm when opened is left behind and named.
		const original = composeOptions.originalEmail;
		if (composeOptions.mode === "forward" && original && !editing) {
			void draftFiles.carry(original.id, original.attachments ?? []);
		}
	}, [composeOptions, currentMailbox?.email, sigBlock, mailboxId, kept]);

	/**
	 * Saves what is written as a draft. `quiet` is the save the window makes by itself while the
	 * person writes: it says nothing, and a failure is simply tried again after the next change.
	 */
	const saveDraft = async (quiet: boolean): Promise<boolean> => {
		// The message being written: its mailbox and what it answers, even while the next waits.
		const box = writtenIn.current;
		const writing = lastInitializedOptionsRef.current ?? composeOptions;
		if (!box || isSending) return false;
		// One save at a time: the next one must know the id the last one made.
		await pendingSave.current;
		const saving = version.current;
		const forMessage = generation.current;
		if (!quiet) {
			setIsSavingDraft(true);
			setError(null);
		}
		try {
			const draft = {
				to,
				cc: cc || undefined,
				bcc: bcc || undefined,
				subject,
				body,
				in_reply_to: writing.originalEmail?.id || writing.draftEmail?.in_reply_to || undefined,
				thread_id: writing.originalEmail?.thread_id || writing.draftEmail?.thread_id || undefined,
			};
			const save = (id: string | undefined) =>
				saveDraftMutation.mutateAsync({ mailboxId: box, draft, id });
			// A draft that is gone (sent or discarded elsewhere) is written again as a new one.
			const saved = await save(draftId.current ?? undefined).catch((caught) => {
				if (draftId.current === null || !(caught instanceof ApiError) || caught.status !== 404) {
					throw caught;
				}
				return save(undefined);
			});
			// A save that ends after the next message began belongs to the one before.
			if (generation.current !== forMessage) return true;
			draftId.current = saved.id;
			savedVersion.current = saving;
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
	/**
	 * Saves what is written before the next message begins: after a save on its way, and only
	 * when something was written since the last one. Says "Draft saved", as closing does.
	 */
	const keepWritten = async (): Promise<boolean> => {
		await pendingSave.current;
		if (savedVersion.current === version.current && draftId.current !== null) {
			setTouched(false);
			return true;
		}
		return saveOnce(false);
	};
	ensureDraft.current = async () => {
		await pendingSave.current;
		if (draftId.current === null) await saveOnce(true);
		return draftId.current;
	};

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

	/**
	 * Sends the message: the mailbox takes it, and it leaves after the undo window, or at
	 * `sendAt` when the person chose a time (ADR-0016). The notes that follow, Undo and what
	 * became of the message, are `useSending`'s. With `archive`, an answer also files the
	 * conversation it answers in Archive, and goes back to the list.
	 */
	const handleSend = async (
		e: Pick<FormEvent, "preventDefault">,
		onClose: () => void,
		archive = false,
		sendAt?: string,
	) => {
		e.preventDefault();
		if (isSending || sendingNow.current) return;
		// Sending from the first press: the waits below can be long, and Send must not look idle.
		sendingNow.current = true;
		setIsSending(true);
		try {
			await sendOnce(onClose, archive, sendAt);
		} finally {
			sendingNow.current = false;
			setIsSending(false);
		}
	};

	const sendOnce = async (onClose: () => void, archive: boolean, sendAt?: string) => {
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
		if (draftFiles.uploading) {
			setError(t("Wait until the files are attached."));
			return;
		}
		// A draft saved a moment ago must be known before the message goes: the message is sent
		// from its draft, whose files are its files and whose row becomes the sent message. A file
		// taken away while it travelled must have left that draft too (#43).
		await pendingSave.current;
		const emailData = {
			...(draftId.current ? { draft_id: draftId.current } : {}),
			to: toEmailListValue(toRecipients),
			cc: toEmailListValue(ccRecipients),
			bcc: toEmailListValue(bccRecipients),
			from,
			subject,
			html: body,
			text: htmlToPlainText(body),
		};
		const mode = composeOptions.mode;
		const originalId = composeOptions.originalEmail?.id || composeOptions.draftEmail?.in_reply_to;
		const route: SendRoute =
			(mode === "reply" || mode === "reply-all") && originalId
				? { kind: "reply", emailId: originalId }
				: mode === "forward" && originalId
					? { kind: "forward", emailId: originalId }
					: { kind: "new" };
		try {
			await draftFiles.settled();
			await sending.send({
				route,
				email: emailData,
				sendAt,
				compose: { mode, originalEmail: composeOptions.originalEmail },
				said: archive ? t("Message sent and conversation archived") : undefined,
			});
			// What was written is the mailbox's now: closing must not save it as a draft again.
			setTouched(false);
			const answered = composeOptions.originalEmail;
			if (archive && answered && answered.folder_id === Folders.INBOX) {
				// The answered conversation goes whole, as a line of a list does (ADR-0014).
				void api
					.actOnLines(mailboxId, {
						ids: [answered.id],
						unit: conversations ? "conversation" : "message",
						change: { move: "archive" },
					})
					.finally(() => invalidate(mailboxId));
				closePanel();
			}
			onClose();
		} catch (err: unknown) {
			const message = (err instanceof Error ? err.message : null) || t("Failed to send email.");
			setError(message);
			toastManager.add({ title: message, variant: "error" });
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
		files: draftFiles.files,
		leftBehind: draftFiles.leftBehind,
		uploading: draftFiles.uploading,
		addFiles: (added: Iterable<File>) => void draftFiles.addFiles(added),
		removeFile: (file: DraftFile) => void draftFiles.removeFile(file),
		/** Carries a file that can do harm after all: the person said so. */
		carryAnyway: (left: LeftBehind) => {
			const original = composeOptions.originalEmail;
			const file = original?.attachments?.find((one) => one.id === left.id);
			if (original && file) void draftFiles.carry(original.id, [file], true);
		},
		saveAndClose,
		discard,
		touch,
		/** Whether what is written is saved as it stands. */
		isSaved: savedAt !== null && !touched,
		/** Why the draft being edited was not sent when it was sent before, if it was not. */
		notSent:
			composeOptions.draftEmail?.submission?.state === "failed"
				? (composeOptions.draftEmail.submission.error ?? "")
				: undefined,
		mode: composeOptions.mode,
		isDraftEdit,
		closeCompose,
		closePanel,
	};
}
