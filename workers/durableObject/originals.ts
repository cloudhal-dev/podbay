// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * The original of a received message, inside the mailbox's database (ADR-0015).
 *
 * A message is in `arrivals` from the moment Podbay takes it until its row is written: the
 * arrival row is there before the bytes are, and the message's row replaces it in one
 * transaction. So the bucket never holds an object that no row names, and a handler that was
 * stopped half way leaves a row the next arrival finds.
 *
 * The key of an original is written whole into the message's row (`raw_key`) and is the only
 * way to the object. It is read here and nowhere built: what goes out of this module about a
 * message carries no key, and the keys go out only to the code that reads or deletes objects.
 */

import { Folders } from "../../shared/folders";
import type { Unparsed } from "../../shared/original";
import { fileKey } from "./drafts";
import type { AttachmentData, EmailData } from "./shapes";

interface Storage {
	sql: SqlStorage;
	transactionSync: <T>(closure: () => T) => T;
}

/** An arrival row older than this was left half done (decision 9). */
export const ARRIVAL_STALE_MS = 15 * 60_000;

/**
 * What the text of a message's row may weigh, in bytes. A string, a blob or a row of the
 * mailbox's database holds at most 8 MB (docs/cloudflare/ledger.json); this stays under it,
 * so a message that is too large is known before it is handed to the database.
 */
export const MAX_ROW_BYTES = 8_000_000;

export interface Arrival {
	id: string;
	raw_key: string;
	raw_size: number;
	envelope_from: string;
	started_at: string;
	attempts: number;
}

/** What step f writes: a message that was read, or one that says why it was not. */
export type Filed =
	| {
			kind: "parsed";
			email: Omit<EmailData, "id" | "date">;
			attachments: Omit<AttachmentData, "email_id">[];
			auth_results: string | null;
	  }
	| { kind: "unparsed"; why: Unparsed; recipient: string; auth_results: string | null };

export type FiledAs = "filed" | "gone" | "too_large";

/** Step c: the arrival's row, before a byte is stored. */
export function beginArrival(
	storage: Storage,
	arrival: Pick<Arrival, "id" | "raw_key" | "raw_size" | "envelope_from">,
	now: number,
): void {
	storage.sql.exec(
		`INSERT INTO arrivals (id, raw_key, raw_size, envelope_from, started_at, attempts)
		 VALUES (?1, ?2, ?3, ?4, ?5, 0)`,
		arrival.id,
		arrival.raw_key,
		arrival.raw_size,
		arrival.envelope_from,
		new Date(now).toISOString(),
	);
}

/** Removes an arrival whose bytes were not stored, or are no longer there. */
export function dropArrival(storage: Storage, id: string): void {
	storage.sql.exec(`DELETE FROM arrivals WHERE id = ?1`, id);
}

const arrivalOf = (sql: SqlStorage, id: string): Arrival | null =>
	([...sql.exec(`SELECT * FROM arrivals WHERE id = ?1`, id)][0] as unknown as
		| Arrival
		| undefined) ?? null;

const bytesOf = (text: string | null | undefined): number =>
	text === null || text === undefined ? 0 : new TextEncoder().encode(text).length;

/** What the text of a message's row weighs, in bytes. */
export function rowWeight(email: Omit<EmailData, "id" | "date">): number {
	return (
		bytesOf(email.subject) +
		bytesOf(email.sender) +
		bytesOf(email.recipient) +
		bytesOf(email.cc) +
		bytesOf(email.bcc) +
		bytesOf(email.body) +
		bytesOf(email.email_references) +
		bytesOf(email.raw_headers)
	);
}

/** Whether the database refused a value for its size. */
const tooBig = (error: unknown): boolean =>
	error instanceof Error && /too big|TOOBIG/i.test(error.message);

/**
 * Step f, in one transaction: the message's row with `raw_key` and `raw_size`, its attachment
 * rows, and the arrival's row removed. The key, the size and the time come from the arrival's
 * own row, never from the caller. The attachment rows are written before their bytes, marked
 * as on their way (`uploading_since`), so a file is never in the bucket without a row.
 *
 * `gone` when there is no such arrival: it was filed or removed already, and nothing is
 * written. `too_large` when the row would not fit: the caller files the message as unparsed.
 */
export function fileArrival(storage: Storage, id: string, filed: Filed, now: number): FiledAs {
	const { sql } = storage;
	if (filed.kind === "parsed" && rowWeight(filed.email) > MAX_ROW_BYTES) return "too_large";
	try {
		return storage.transactionSync((): FiledAs => {
			const arrival = arrivalOf(sql, id);
			if (arrival === null) return "gone";
			const email = filed.kind === "parsed" ? filed.email : null;
			sql.exec(
				`INSERT INTO emails (id, folder_id, subject, sender, recipient, cc, bcc, date, read, starred,
					body, in_reply_to, email_references, thread_id, message_id, raw_headers,
					raw_key, raw_size, unparsed, auth_results)
				 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, 0, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)`,
				arrival.id,
				Folders.INBOX,
				email?.subject ?? "",
				// A message that could not be read has the envelope sender as its sender.
				email === null ? arrival.envelope_from.toLowerCase() : email.sender,
				filed.kind === "parsed" ? filed.email.recipient : filed.recipient,
				email?.cc ?? null,
				email?.bcc ?? null,
				// The time it arrived, also when it is finished later.
				arrival.started_at,
				email?.body ?? "",
				email?.in_reply_to ?? null,
				email?.email_references ?? null,
				// One that could not be read joins no conversation: it is its own.
				email?.thread_id ?? arrival.id,
				email?.message_id ?? null,
				email?.raw_headers ?? null,
				arrival.raw_key,
				arrival.raw_size,
				filed.kind === "parsed" ? null : filed.why,
				filed.auth_results,
			);
			if (filed.kind === "parsed") {
				const since = new Date(now).toISOString();
				for (const file of filed.attachments) {
					sql.exec(
						`INSERT INTO attachments (id, email_id, filename, mimetype, size, content_id, disposition, uploading_since)
						 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
						file.id,
						arrival.id,
						file.filename,
						file.mimetype,
						file.size,
						file.content_id ?? null,
						file.disposition ?? null,
						since,
					);
				}
			}
			sql.exec(`DELETE FROM arrivals WHERE id = ?1`, arrival.id);
			return "filed";
		});
	} catch (error) {
		// The transaction wrote nothing; the arrival is still there for the caller to file.
		if (filed.kind === "parsed" && tooBig(error)) return "too_large";
		throw error;
	}
}

/** Step g, done: the files whose bytes are stored are part of the message. */
export function filesStored(storage: Storage, emailId: string, fileIds: readonly string[]): void {
	for (const fileId of fileIds) {
		storage.sql.exec(
			`UPDATE attachments SET uploading_since = NULL WHERE id = ?1 AND email_id = ?2`,
			fileId,
			emailId,
		);
	}
}

/**
 * One arrival that was left half done, and counts the attempt: the oldest whose row is older
 * than fifteen minutes and is not in `skip`. The count is written before the work begins, so
 * a message that stops the handler is not tried for ever: the caller parses it on the first
 * attempt and files it as `interrupted` from the second on.
 */
export function claimArrival(
	storage: Storage,
	now: number,
	skip: readonly string[],
): Arrival | null {
	const { sql } = storage;
	return storage.transactionSync(() => {
		const before = new Date(now - ARRIVAL_STALE_MS).toISOString();
		const taken = skip.slice(0, 20);
		const marks = taken.map((_id, n) => `?${n + 2}`).join(", ");
		const row = [
			...sql.exec(
				`SELECT * FROM arrivals WHERE started_at < ?1 ${
					taken.length > 0 ? `AND id NOT IN (${marks})` : ""
				} ORDER BY started_at, id LIMIT 1`,
				before,
				...taken,
			),
		][0] as unknown as Arrival | undefined;
		if (row === undefined) return null;
		sql.exec(`UPDATE arrivals SET attempts = attempts + 1 WHERE id = ?1`, row.id);
		return { ...row, attempts: Number(row.attempts) + 1 };
	});
}

// ── Reading ────────────────────────────────────────────────────────

/** Where a message's original is, for the two routes that read it. Never part of an answer. */
export interface OriginalOf {
	raw_key: string | null;
	raw_size: number | null;
	date: string | null;
	auth_results: string | null;
}

/** The original of a message of this mailbox, or `null` when there is no such message. */
export function originalOf(storage: Storage, id: string): OriginalOf | null {
	const row = [
		...storage.sql.exec(
			`SELECT raw_key, raw_size, date, auth_results FROM emails WHERE id = ?1`,
			id,
		),
	][0] as unknown as OriginalOf | undefined;
	if (row === undefined) return null;
	return { ...row, raw_key: row.raw_key === "" ? null : row.raw_key };
}

/**
 * A message's row as it is answered: with `has_original`, and without the key of the original
 * and the platform's field, which stay inside the Worker (decision 4).
 */
export function shownMessage<T extends object>(
	row: T,
): Omit<T, "raw_key" | "auth_results"> & { has_original: boolean } {
	const {
		raw_key,
		auth_results: _kept,
		...rest
	} = row as T & {
		raw_key?: unknown;
		auth_results?: unknown;
	};
	return {
		...(rest as Omit<T, "raw_key" | "auth_results">),
		has_original: typeof raw_key === "string" && raw_key !== "",
	};
}

// ── Deleting (decision 22: objects go before rows) ─────────────────

/**
 * The keys of every object a message has: its files, stored or still on their way, and its
 * original. `null` when there is no such message.
 */
export function messageKeys(storage: Storage, id: string): string[] | null {
	const { sql } = storage;
	const row = [...sql.exec(`SELECT raw_key FROM emails WHERE id = ?1`, id)][0];
	if (row === undefined) return null;
	const keys = [
		...sql.exec(`SELECT id, email_id, filename FROM attachments WHERE email_id = ?1`, id),
	].map((file) => fileKey(file as unknown as Parameters<typeof fileKey>[0]));
	if (typeof row.raw_key === "string" && row.raw_key !== "") keys.push(row.raw_key);
	return keys;
}

/** The keys of the originals of these messages. */
export function rawKeysOf(sql: SqlStorage, ids: readonly string[]): string[] {
	if (ids.length === 0) return [];
	const marks = ids.map(() => "?").join(", ");
	return [
		...sql.exec(
			`SELECT raw_key FROM emails WHERE id IN (${marks}) AND raw_key IS NOT NULL AND raw_key != ''`,
			...ids,
		),
	].map((row) => String(row.raw_key));
}

/**
 * The keys of everything the mailbox has in the bucket: every file, every original, and the
 * original of every arrival that is not a message yet.
 */
export function allKeys(storage: Storage): string[] {
	const { sql } = storage;
	return [
		...[...sql.exec(`SELECT id, email_id, filename FROM attachments`)].map((file) =>
			fileKey(file as unknown as Parameters<typeof fileKey>[0]),
		),
		...[...sql.exec(`SELECT raw_key FROM emails WHERE raw_key IS NOT NULL AND raw_key != ''`)].map(
			(row) => String(row.raw_key),
		),
		...[...sql.exec(`SELECT raw_key FROM arrivals`)].map((row) => String(row.raw_key)),
	];
}
