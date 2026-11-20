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

/** A file on its way out of the draft. */
interface Removal {
	/** Its id in the draft, once it was declared. */
	id: string | null;
	/** `null` when it left the draft; its name when it could not be taken out. */
	done: Promise<string | null>;
	finish: (stayed: string | null) => void;
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
	/**
	 * Removals still on their way, by key, kept across messages: a file taken away while it
	 * travelled is removed when its upload stops, which can be after the window closed or opened
	 * the draft again (#43). Each ends with `null` when the file left the draft, or with the
	 * file's name when it could not be taken out and is still the draft's.
	 */
	const removals = useRef(new Map<string, Removal>());
	/** The uploads on their way, by key, so a file taken away stops travelling at once. */
	const travelling = useRef(new Map<string, AbortController>());
	/**
	 * The files the upload's loop is done with, by key, and the id each was declared under. The
	 * loop and a click each decide by this, not by the file as the screen last drew it: the loop
	 * adds a file here in the same step in which it looks whether the file was taken away, and a
	 * click reads it in the step in which it takes the file away. So whichever comes second sees
	 * the first, and a removal that is opened is always finished (#140): by the loop when the file
	 * was taken away before it looked, by the click when after.
	 */
	const landed = useRef(new Map<string, string>());

	/** Marks a file as on its way out, until `finish` says whether it left. */
	const leaving = (key: string, id: string | null) => {
		let end: (stayed: string | null) => void = () => {};
		const done = new Promise<string | null>((resolve) => {
			end = resolve;
		});
		const removal: Removal = {
			id,
			done,
			finish: (stayed) => {
				removals.current.delete(key);
				end(stayed);
			},
		};
		removals.current.set(key, removal);
		return removal;
	};

	/** Takes a declared file out of the draft; `true` when it is gone. */
	const takeOut = (draftId: string, id: string) =>
		mailboxId
			? api.removeDraftFile(mailboxId, draftId, id).then(
					() => true,
					() => false,
				)
			: Promise.resolve(false);

	/** A file that could not be taken out of the draft is shown again, with what went wrong. */
	const stayed = (session: number, file: DraftFile) => {
		if (session !== writing.current) return;
		setFiles((now) => (now.some((one) => one.key === file.key) ? now : [...now, file]));
		setError(t("{name} could not be taken out of the message. Try again.", { name: file.name }));
	};

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
		// A file on its way out of the draft is not shown again, though the draft still lists it.
		const outgoing = new Set([...removals.current.values()].map((removal) => removal.id));
		setFiles(
			held
				.filter((file) => file.disposition !== "inline" && !outgoing.has(file.id))
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
		// This message's own list of files taken away: another message starting does not empty it.
		const gone = removed.current;
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
		// The first file of the batch not yet handled. Every way out of the loop ends, in the
		// `finally`, the removals of the files after it: never declared, they have left already.
		let unhandled = 0;
		try {
			for (const [at, { file, key }] of entries.entries()) {
				// Another message began: what is left of this one is never declared.
				if (session !== writing.current) return;
				unhandled = at + 1;
				// Taken away before it was sent: it is never declared.
				if (gone.has(key)) {
					removals.current.get(key)?.finish(null);
					continue;
				}
				let declaredId: string | null = null;
				try {
					if (draftId === null) throw new Error("no draft");
					const declared = await api.declareDraftFile(mailboxId, draftId, file);
					declaredId = declared.id;
					patch(key, { id: declared.id, name: declared.filename });
					const removal = removals.current.get(key);
					if (removal) removal.id = declared.id;
					if (!gone.has(key)) {
						const stop = new AbortController();
						travelling.current.set(key, stop);
						await api.uploadDraftFile(
							mailboxId,
							draftId,
							declared.id,
							file,
							(part) => {
								if (session === writing.current) patch(key, { uploading: part });
							},
							stop.signal,
						);
					}
				} catch (caught) {
					if (!gone.has(key)) {
						travelling.current.delete(key);
						if (session !== writing.current) return;
						patch(key, null);
						const said = caught instanceof Error && caught.message ? caught.message : null;
						setError(said ?? t("{name} could not be attached.", { name: file.name }));
						continue;
					}
				}
				travelling.current.delete(key);
				// Taken away while it travelled: what was declared leaves the draft again.
				if (gone.has(key)) {
					const left =
						declaredId === null || draftId === null || (await takeOut(draftId, declaredId));
					removals.current.get(key)?.finish(left ? null : file.name);
					if (!left && declaredId !== null) {
						stayed(session, {
							key,
							id: declaredId,
							name: file.name,
							size: file.size,
							type: file.type,
							uploading: null,
						});
					}
					continue;
				}
				// Done with it: from here a click takes it out itself.
				if (declaredId !== null) landed.current.set(key, declaredId);
				if (session === writing.current) patch(key, { uploading: null });
			}
		} finally {
			for (const left of entries.slice(unhandled)) removals.current.get(left.key)?.finish(null);
		}
	};

	const removeFile = async (file: DraftFile) => {
		patch(file.key, null);
		// What the loop is done with is read here, not from the file as it was drawn: the drawing
		// can still say "uploading" after the loop has looked for the last time.
		const landedId = landed.current.get(file.key);
		// A file whose bytes are still on the way stops travelling, and the loop takes it out.
		if (file.uploading !== null && landedId === undefined) {
			removed.current.add(file.key);
			leaving(file.key, file.id);
			travelling.current.get(file.key)?.abort();
			return;
		}
		const id = landedId ?? file.id;
		if (!mailboxId || id === null) return;
		const session = writing.current;
		const removal = leaving(file.key, id);
		const draftId = await ensureDraft();
		const left = draftId !== null && (await takeOut(draftId, id));
		removal.finish(left ? null : file.name);
		if (!left) stayed(session, { ...file, id, uploading: null });
	};

	/**
	 * Waits until every file taken away has left the draft, as a message must before it goes. A
	 * file that could not be taken out stops the message: it would go with it (#43).
	 */
	const settled = async () => {
		const ends = await Promise.all([...removals.current.values()].map((removal) => removal.done));
		const kept = ends.filter((name): name is string => name !== null);
		if (kept.length > 0) {
			throw new Error(
				t("{name} could not be taken out of the message, so it was not sent. Try again.", {
					name: kept.join(", "),
				}),
			);
		}
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
		settled,
		reset,
		addFiles,
		removeFile,
		carry,
	};
}
