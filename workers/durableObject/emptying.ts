// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Emptying Trash or Spam (ADR-0009). A place is emptied in batches, and each batch in two
 * steps: the mailbox names some messages and the objects they have, the route deletes those
 * objects from the bucket, and then the mailbox deletes the rows of exactly those messages in
 * one transaction. Objects go before rows (ADR-0015, decision 22), so a batch that fails half
 * way leaves rows that can be deleted again and never an object without a row.
 */

import { Folders } from "../../shared/folders";
import { fileKey } from "./drafts";
import { rawKeysOf } from "./originals";

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

export interface BatchToEmpty {
	/** The messages of this batch. */
	ids: string[];
	/** The storage keys of what those messages have: their files and their originals. */
	keys: string[];
}

export interface EmptiedBatch {
	/** Messages deleted in this batch. */
	deleted: number;
	/** Whether the place still holds mail that was there when emptying was asked for. */
	more: boolean;
}

/**
 * Names one batch of what a place held at `before`, and the objects of those messages, and
 * changes nothing. Mail stored after `before` is left alone, so what arrives in Spam while it
 * is emptied stays.
 */
export function batchToEmpty(storage: Storage, place: string, before: string): BatchToEmpty {
	if (!EMPTIABLE.includes(place)) return { ids: [], keys: [] };
	const { sql } = storage;
	const ids = [
		...sql.exec(
			`SELECT id FROM emails WHERE folder_id = ?1 AND date <= ?2 ORDER BY date LIMIT ?3`,
			place,
			before,
			EMPTY_BATCH,
		),
	].map((row) => String(row.id));
	if (ids.length === 0) return { ids: [], keys: [] };
	const marks = ids.map(() => "?").join(", ");
	const keys = [
		...sql.exec(
			`SELECT email_id, id, filename FROM attachments WHERE email_id IN (${marks})`,
			...ids,
		),
	].map((row) => fileKey(row as unknown as Parameters<typeof fileKey>[0]));
	return { ids, keys: [...keys, ...rawKeysOf(sql, ids)] };
}

/**
 * Deletes the rows of a named batch, after its objects are gone: the messages, their label
 * rows and their attachment rows, all or none. The rows go wherever the messages are by now:
 * the objects of one that was moved out of the place meanwhile are gone all the same, and no
 * row may be left that names an object that is not there.
 */
export function emptyBatch(
	storage: Storage,
	place: string,
	before: string,
	ids: readonly string[],
): EmptiedBatch {
	if (!EMPTIABLE.includes(place)) return { deleted: 0, more: false };
	const { sql } = storage;
	const batch = ids.slice(0, EMPTY_BATCH);
	return storage.transactionSync(() => {
		let deleted = 0;
		if (batch.length > 0) {
			const marks = batch.map(() => "?").join(", ");
			sql.exec(`DELETE FROM email_labels WHERE email_id IN (${marks})`, ...batch);
			// What a deed recorded about a message goes with the message (ADR-0014, decision 18).
			sql.exec(`DELETE FROM deed_changes WHERE email_id IN (${marks})`, ...batch);
			sql.exec(`DELETE FROM attachments WHERE email_id IN (${marks})`, ...batch);
			deleted = Number(
				[...sql.exec(`SELECT COUNT(*) AS n FROM emails WHERE id IN (${marks})`, ...batch)][0]?.n,
			);
			sql.exec(`DELETE FROM emails WHERE id IN (${marks})`, ...batch);
		}
		const left = [
			...sql.exec(
				`SELECT 1 FROM emails WHERE folder_id = ?1 AND date <= ?2 LIMIT 1`,
				place,
				before,
			),
		];
		return { deleted, more: left.length > 0 };
	});
}
