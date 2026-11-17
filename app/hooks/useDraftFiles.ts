// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { useRef, useState } from "react";
import { MAX_ATTACHMENTS, MAX_ATTACHMENTS_BYTES, MAX_COPIED_AT_ONCE } from "shared/sending-limits";
import { t } from "~/i18n";
import api, { type DraftFileLeft, type DraftFileShown } from "~/services/api";
import type { Attachment } from "~/types";

/** A file of the message being written. It belongs to the draft once its bytes are stored. */
export interface DraftFile {
	/** Stable while the window is open, also before the Worker gave the file an id. */
	key: string;
	/** The file's id in the draft; `null` until it is declared. */
	id: string | null;
	name: string;
	size: number;
	type: string;
	/** From 0 to 1 while the bytes travel; `null` once they are stored. */
	uploading: number | null;
}

/** A file of a forwarded message that was not carried, and why. */
export interface LeftBehind {
	id: string;
	name: string;
	reason: DraftFileLeft;
}

const stored = (file: DraftFileShown): DraftFile => ({
	key: file.id,
	id: file.id,
	name: file.filename,
	size: file.size,
	type: file.type,
	uploading: null,
});

/**
 * The files of the message being written (ADR-0011). A file is uploaded once, into the draft:
 * it is declared, its bytes follow, and from then on the draft keeps it, in every browser. A
 * forward's files are copied inside the account and never pass through this browser.
 *
 * `ensureDraft` gives the id of the draft, saving one first when there is none yet.
 */
export function useDraftFiles(
	mailboxId: string | undefined,
	ensureDraft: () => Promise<string | null>,
	setError: (message: string | null) => void,
) {
	const [files, setFiles] = useState<DraftFile[]>([]);
	const [leftBehind, setLeftBehind] = useState<LeftBehind[]>([]);
	/** Changes when the window starts another message, so late answers are not shown in it. */
	const writing = useRef(0);
	const next = useRef(0);
	/** Files the person took away again while their bytes were still on the way. */
	const removed = useRef(new Set<string>());

	const patch = (key: string, change: Partial<DraftFile> | null) =>
		setFiles((now) =>
			change === null
				? now.filter((file) => file.key !== key)
				: now.map((file) => (file.key === key ? { ...file, ...change } : file)),
		);

	/** Starts over for another message, with the files its draft already holds. */
	const reset = (held: readonly Attachment[] = []) => {
		writing.current += 1;
		removed.current = new Set();
		setLeftBehind([]);
		setFiles(
			held
				.filter((file) => file.disposition !== "inline")
				.map((file) =>
					stored({ id: file.id, filename: file.filename, type: file.mimetype, size: file.size }),
				),
		);
	};

	/** Adds files, unless together they would be more than a message can carry. */
	const addFiles = async (added: Iterable<File>) => {
		const list = [...added];
		if (!mailboxId || list.length === 0) return;
		if (files.length + list.length > MAX_ATTACHMENTS) {
			setError(t("A message carries {count} files at most.", { count: MAX_ATTACHMENTS }));
			return;
		}
		const total = [...files, ...list].reduce((sum, file) => sum + file.size, 0);
		if (total > MAX_ATTACHMENTS_BYTES) {
			setError(
				t("Attached files can be {limit} MB together. These would be {size} MB.", {
					limit: Math.floor(MAX_ATTACHMENTS_BYTES / (1024 * 1024)),
					size: Math.ceil(total / (1024 * 1024)),
				}),
			);
			return;
		}
		if (list.some((file) => file.size === 0)) {
			setError(t("An empty file cannot be attached."));
			return;
		}
		setError(null);
		const session = writing.current;
		const entries = list.map((file) => {
			next.current += 1;
			return { file, key: `new-${next.current}` };
		});
		setFiles((now) => [
			...now,
			...entries.map(({ file, key }) => ({
				key,
				id: null,
				name: file.name,
				size: file.size,
				type: file.type,
				uploading: 0,
			})),
		]);
		const draftId = await ensureDraft();
		for (const { file, key } of entries) {
			if (session !== writing.current) return;
			// Taken away before it was sent: it is never declared.
			if (removed.current.has(key)) continue;
			try {
				if (draftId === null) throw new Error("no draft");
				const declared = await api.declareDraftFile(mailboxId, draftId, file);
				patch(key, { id: declared.id, name: declared.filename });
				await api.uploadDraftFile(mailboxId, draftId, declared.id, file, (part) => {
					if (session === writing.current) patch(key, { uploading: part });
				});
				// Taken away while it travelled: what arrived is removed from the draft again.
				if (removed.current.has(key)) {
					await api.removeDraftFile(mailboxId, draftId, declared.id).catch(() => {});
					continue;
				}
				if (session === writing.current) patch(key, { uploading: null });
			} catch (caught) {
				if (session !== writing.current) return;
				patch(key, null);
				const said = caught instanceof Error && caught.message ? caught.message : null;
				setError(said ?? t("{name} could not be attached.", { name: file.name }));
			}
		}
	};

	const removeFile = async (file: DraftFile) => {
		patch(file.key, null);
		// A file whose bytes are still on the way is removed by the upload when it gets there.
		if (file.uploading !== null) {
			removed.current.add(file.key);
			return;
		}
		if (!mailboxId || file.id === null) return;
		const draftId = await ensureDraft();
		if (draftId !== null) await api.removeDraftFile(mailboxId, draftId, file.id).catch(() => {});
	};

	/**
	 * Carries files of another message into the draft, as a forward does. A file that can do
	 * harm is left behind and named, unless the person agreed (`acknowledged`).
	 */
	const carry = async (emailId: string, from: readonly Attachment[], acknowledged = false) => {
		// A picture shown inside the message is part of its text, not a file of it.
		const wanted = from.filter((file) => file.disposition !== "inline");
		if (!mailboxId || wanted.length === 0) return;
		const session = writing.current;
		const draftId = await ensureDraft();
		if (draftId === null || session !== writing.current) return;
		const names = new Map(wanted.map((file) => [file.id, file.filename]));
		for (let at = 0; at < wanted.length; at += MAX_COPIED_AT_ONCE) {
			const ids = wanted.slice(at, at + MAX_COPIED_AT_ONCE).map((file) => file.id);
			try {
				const answer = await api.copyDraftFiles(mailboxId, draftId, {
					emailId,
					attachmentIds: ids,
					...(acknowledged ? { acknowledged: true } : {}),
				});
				if (session !== writing.current) return;
				setFiles((now) => [...now, ...answer.copied.map(stored)]);
				setLeftBehind((now) => [
					...now.filter((left) => !ids.includes(left.id)),
					...answer.left.map((left) => ({ ...left, name: names.get(left.id) ?? left.id })),
				]);
			} catch {
				if (session !== writing.current) return;
				setLeftBehind((now) => [
					...now.filter((left) => !ids.includes(left.id)),
					...ids.map((id) => ({ id, name: names.get(id) ?? id, reason: "missing" as const })),
				]);
			}
		}
	};

	return {
		files,
		leftBehind,
		/** Whether bytes are still on their way: a message is not sent before they arrived. */
		uploading: files.some((file) => file.uploading !== null),
		reset,
		addFiles,
		removeFile,
		carry,
	};
}
