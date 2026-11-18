// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * A draft and its files (ADR-0011).
 *
 * A draft keeps its id for its whole life: it is saved in place, and when it is sent its row
 * becomes the message that waits and then leaves (`./submissions`). A file of a draft is a row in `attachments` like any message's
 * file, with the same storage key. The row is written before the bytes, so nothing of a draft
 * is ever in the bucket without a row that names it: `uploading_since` says a file was
 * declared and its bytes have not arrived, and such a file is not part of the message.
 */

import { Folders } from "../../shared/folders";
import { MAX_ATTACHMENTS, MAX_ATTACHMENTS_BYTES } from "../../shared/sending-limits";

interface Storage {
	sql: SqlStorage;
	transactionSync: <T>(closure: () => T) => T;
}

/** A declared file whose bytes did not arrive within this time is removed. */
export const UNFINISHED_AFTER_MS = 60 * 60 * 1000;

/** What a save may change of a draft. */
export interface DraftFields {
	subject: string;
	recipient: string;
	cc: string | null;
	bcc: string | null;
	body: string;
	date: string;
	in_reply_to?: string | null;
	thread_id?: string | null;
}

/** What a draft becomes when it is sent. */
export interface SentFields extends DraftFields {
	sender: string;
	email_references: string | null;
	message_id: string;
	raw_headers: string;
}

export interface FileRow {
	id: string;
	email_id: string;
	filename: string;
	mimetype: string;
	size: number;
	content_id: string | null;
	disposition: string | null;
	uploading_since: string | null;
}

/** The storage key of a file, from its row and from nothing else. */
export const fileKey = (file: Pick<FileRow, "id" | "email_id" | "filename">): string =>
	`attachments/${file.email_id}/${file.id}/${file.filename}`;

const isDraft = (sql: SqlStorage, id: string): boolean =>
	[...sql.exec(`SELECT 1 FROM emails WHERE id = ?1 AND folder_id = ?2`, id, Folders.DRAFT)].length >
	0;

/**
 * Whether a message is a draft wherever it is now: the mailbox wrote it and it never left. A
 * draft is stored without a Message-ID, a header list or an original, and keeps none of them
 * until it is sent; a message that left has the first two, one that arrived has the second or
 * the third, and one taken back from Scheduled is given none again. A draft in Trash is one
 * that was deleted, and only such a message may go back to Drafts (issue #31).
 */
export const writtenHere = (sql: SqlStorage, id: string): boolean =>
	[
		...sql.exec(
			`SELECT 1 FROM emails WHERE id = ?1 AND message_id IS NULL AND raw_headers IS NULL
				AND raw_key IS NULL AND unparsed IS NULL`,
			id,
		),
	].length > 0;

const filesOf = (sql: SqlStorage, draftId: string): FileRow[] =>
	[...sql.exec(`SELECT * FROM attachments WHERE email_id = ?1`, draftId)] as unknown as FileRow[];

/** Removes the rows of the files that match, and gives the keys their bytes would be under. */
function drop(sql: SqlStorage, files: readonly FileRow[]): string[] {
	for (const file of files) sql.exec(`DELETE FROM attachments WHERE id = ?1`, file.id);
	return files.map(fileKey);
}

/** Whether a message has any file, stored or still on its way. */
export function holdsFiles(storage: Storage, id: string): boolean {
	return (
		[...storage.sql.exec(`SELECT 1 FROM attachments WHERE email_id = ?1 LIMIT 1`, id)].length > 0
	);
}

/** Saves over a draft in place. False when the id is not a draft's: nothing else is ever changed. */
export function saveDraft(storage: Storage, id: string, fields: DraftFields): boolean {
	const { sql } = storage;
	if (!isDraft(sql, id)) return false;
	sql.exec(
		`UPDATE emails SET subject = ?1, recipient = ?2, cc = ?3, bcc = ?4, body = ?5, date = ?6,
			in_reply_to = COALESCE(?7, in_reply_to), thread_id = COALESCE(?8, thread_id)
		 WHERE id = ?9 AND folder_id = ?10`,
		fields.subject,
		fields.recipient,
		fields.cc,
		fields.bcc,
		fields.body,
		fields.date,
		fields.in_reply_to ?? null,
		fields.thread_id ?? null,
		id,
		Folders.DRAFT,
	);
	return true;
}

export type Declared =
	| { file: FileRow; swept: string[] }
	| { refused: "not_found" | "too_large" | "too_many" };

/**
 * Declares a file of a draft: checks the limits before a byte travels and writes the row. The
 * files of a draft are held to what a message being sent may carry, so a draft can always be
 * sent as it stands. Unfinished files older than an hour are removed first.
 */
export function declareFile(
	storage: Storage,
	draftId: string,
	file: Pick<FileRow, "id" | "filename" | "mimetype" | "size"> & { stored?: boolean },
	now: number,
): Declared {
	const { sql } = storage;
	return storage.transactionSync((): Declared => {
		if (!isDraft(sql, draftId)) return { refused: "not_found" };
		const cutoff = new Date(now - UNFINISHED_AFTER_MS).toISOString();
		const all = filesOf(sql, draftId);
		const stale = all.filter((one) => one.uploading_since !== null && one.uploading_since < cutoff);
		const swept = drop(sql, stale);
		const held = all.filter((one) => !stale.includes(one));

		if (held.length >= MAX_ATTACHMENTS) return { refused: "too_many" };
		const total = held.reduce((sum, one) => sum + one.size, 0);
		if (file.size > MAX_ATTACHMENTS_BYTES || total + file.size > MAX_ATTACHMENTS_BYTES) {
			return { refused: "too_large" };
		}
		const row: FileRow = {
			id: file.id,
			email_id: draftId,
			filename: file.filename,
			mimetype: file.mimetype,
			size: file.size,
			content_id: null,
			disposition: "attachment",
			uploading_since: new Date(now).toISOString(),
		};
		sql.exec(
			`INSERT INTO attachments (id, email_id, filename, mimetype, size, content_id, disposition, uploading_since)
			 VALUES (?1, ?2, ?3, ?4, ?5, NULL, 'attachment', ?6)`,
			row.id,
			row.email_id,
			row.filename,
			row.mimetype,
			row.size,
			row.uploading_since,
		);
		return { file: row, swept };
	});
}

/** A file of this draft, whether its bytes have arrived or not; `null` for anything else. */
export function draftFile(storage: Storage, draftId: string, fileId: string): FileRow | null {
	const { sql } = storage;
	if (!isDraft(sql, draftId)) return null;
	const row = [
		...sql.exec(`SELECT * FROM attachments WHERE id = ?1 AND email_id = ?2`, fileId, draftId),
	][0] as unknown as FileRow | undefined;
	return row ?? null;
}

/** Marks a declared file as stored. False when it was stored already, or is not there. */
export function markStored(storage: Storage, draftId: string, fileId: string): boolean {
	const { sql } = storage;
	if (!isDraft(sql, draftId)) return false;
	const changed = sql.exec(
		`UPDATE attachments SET uploading_since = NULL WHERE id = ?1 AND email_id = ?2 AND uploading_since IS NOT NULL`,
		fileId,
		draftId,
	);
	return changed.rowsWritten > 0;
}

/** Removes one file of a draft. Gives the key its bytes are under, or `null` when it is not one. */
export function removeFile(storage: Storage, draftId: string, fileId: string): string | null {
	return storage.transactionSync(() => {
		const file = draftFile(storage, draftId, fileId);
		return file === null ? null : (drop(storage.sql, [file])[0] ?? null);
	});
}

/**
 * Removes the files of a message whose bytes never arrived: they are not part of it. Gives
 * the keys their bytes would be under. Called when a draft is sent (ADR-0016): the draft's
 * row becomes the message, so its stored files keep their rows and their keys.
 */
export function dropUnfinished(sql: SqlStorage, id: string): string[] {
	return drop(
		sql,
		filesOf(sql, id).filter((one) => one.uploading_since !== null),
	);
}

/** The stored files of a message: the ones whose bytes have arrived. */
export function storedFiles(sql: SqlStorage, id: string): FileRow[] {
	return filesOf(sql, id).filter((one) => one.uploading_since === null);
}
