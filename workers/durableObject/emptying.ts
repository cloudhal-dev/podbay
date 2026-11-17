// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Emptying Trash or Spam (ADR-0009). A place is emptied in batches: each call deletes the rows
 * of some messages in one transaction and names the objects that held their files, which the
 * route then deletes from the bucket before it asks for the next batch.
 */

import { Folders } from "../../shared/folders";

/** The only places that can be emptied. Anything else is refused before this is reached. */
export const EMPTIABLE: readonly string[] = [Folders.TRASH, Folders.SPAM];

/**
 * Messages in one batch. A query takes at most 100 bound parameters
 * (docs/cloudflare/ledger.json); a batch names its messages in one.
 */
export const EMPTY_BATCH = 50;

interface Storage {
	sql: SqlStorage;
	transactionSync: <T>(closure: () => T) => T;
}

export interface EmptiedBatch {
	/** Messages deleted in this batch. */
	deleted: number;
	/** The storage keys of the files those messages had. */
	keys: string[];
	/** Whether the place still holds mail that was there when emptying was asked for. */
	more: boolean;
}

/**
 * Deletes one batch of what a place held at `before`: the messages, their label rows and their
 * attachment rows, all or none. Mail stored after `before` is left alone, so what arrives in
 * Spam while it is emptied stays.
 */
export function emptyBatch(storage: Storage, place: string, before: string): EmptiedBatch {
	if (!EMPTIABLE.includes(place)) return { deleted: 0, keys: [], more: false };
	const { sql } = storage;
	return storage.transactionSync(() => {
		const ids = [
			...sql.exec(
				`SELECT id FROM emails WHERE folder_id = ?1 AND date <= ?2 ORDER BY date LIMIT ?3`,
				place,
				before,
				EMPTY_BATCH,
			),
		].map((row) => String(row.id));
		if (ids.length === 0) return { deleted: 0, keys: [], more: false };

		const marks = ids.map(() => "?").join(", ");
		const keys = [
			...sql.exec(
				`SELECT email_id, id, filename FROM attachments WHERE email_id IN (${marks})`,
				...ids,
			),
		].map((row) => `attachments/${row.email_id}/${row.id}/${row.filename}`);
		sql.exec(`DELETE FROM email_labels WHERE email_id IN (${marks})`, ...ids);
		// What a deed recorded about a message goes with the message (ADR-0014, decision 18).
		sql.exec(`DELETE FROM deed_changes WHERE email_id IN (${marks})`, ...ids);
		sql.exec(`DELETE FROM attachments WHERE email_id IN (${marks})`, ...ids);
		sql.exec(`DELETE FROM emails WHERE id IN (${marks})`, ...ids);

		const left = [
			...sql.exec(
				`SELECT 1 FROM emails WHERE folder_id = ?1 AND date <= ?2 LIMIT 1`,
				place,
				before,
			),
		];
		return { deleted: ids.length, keys, more: left.length > 0 };
	});
}
