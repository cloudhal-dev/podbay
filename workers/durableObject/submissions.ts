// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * A message on its way out (ADR-0016): the table `submissions` and the place Scheduled.
 *
 * | State     | Place     | It means                                             |
 * |-----------|-----------|------------------------------------------------------|
 * | no row    | any       | never handed over, or taken back                     |
 * | `waiting` | Scheduled | it leaves at its time, or at its next try            |
 * | `sending` | Scheduled | it was handed to the service, the answer not written |
 * | `sent`    | Sent      | the service took it                                  |
 * | `failed`  | Drafts    | it did not leave, and why                            |
 *
 * **A message is in Scheduled exactly when its state is `waiting` or `sending`.** Every
 * function here that changes a state moves the message in the same transaction, and nothing
 * else moves a message into or out of Scheduled: the routes that move, delete, mark and label
 * refuse it (`inScheduled`).
 *
 * **Leaving at most once.** `handOver` is the handover: it changes `waiting` to `sending` only
 * if the row is still as it was read, and counts the message against the caps in the same
 * transaction. A row that is `sending` is never handed over again, by anything. The call to
 * the sending service is in `./leaving`, the only caller of `handOver`.
 *
 * Everything is in rows: nothing here is kept in memory between two calls.
 */
import { Folders } from "../../shared/folders";
import { retryAfterMs, SENDING, type Submission, type SubmissionState } from "../../shared/sending";
import { dropUnfinished, type SentFields } from "./drafts";
import { type CapFull, capFull, capsFreeAt, logSend, type SendKind, unlogSend } from "./sending";

interface Storage {
	sql: SqlStorage;
	transactionSync: <T>(closure: () => T) => T;
}

/** A query takes at most 100 bound parameters (docs/cloudflare/ledger.json). */
const CHUNK = 90;
const iso = (time: number) => new Date(time).toISOString();
const rows = <T>(cursor: Iterable<unknown>): T[] => [...cursor] as T[];

/** A row of `submissions`. */
export interface SubmissionRow {
	email_id: string;
	state: SubmissionState;
	send_at: string;
	retry_at: string | null;
	attempts: number;
	started_at: string | null;
	requested_at: string;
	requested_by: string;
	error: string | null;
	sent_at: string | null;
	service_id: string | null;
}

export function submissionOf(sql: SqlStorage, id: string): SubmissionRow | null {
	return (
		rows<SubmissionRow>(sql.exec(`SELECT * FROM submissions WHERE email_id = ?1`, id))[0] ?? null
	);
}

function placeOf(sql: SqlStorage, id: string): string | null {
	const row = [...sql.exec(`SELECT folder_id FROM emails WHERE id = ?1`, id)][0];
	return row === undefined ? null : String(row.folder_id);
}

/** Whether a message waits to leave. Such a message is changed by nothing but this module. */
export function inScheduled(sql: SqlStorage, id: string): boolean {
	return placeOf(sql, id) === Folders.SCHEDULED;
}

/** How many messages wait in this mailbox, handed over or not. */
export function waitingCount(sql: SqlStorage): number {
	const row = [
		...sql.exec(`SELECT COUNT(*) AS n FROM submissions WHERE state IN ('waiting', 'sending')`),
	][0];
	return Number(row?.n ?? 0);
}

/** What the rail says beside two places: how many wait, and how many drafts are marked not sent. */
export function placeMarks(sql: SqlStorage): { waiting: number; notSent: number } {
	const row = [
		...sql.exec(
			`SELECT COUNT(*) AS n FROM submissions s JOIN emails e ON e.id = s.email_id
			 WHERE s.state = 'failed' AND e.folder_id = ?1`,
			Folders.DRAFT,
		),
	][0];
	return { waiting: waitingCount(sql), notSent: Number(row?.n ?? 0) };
}

// ── The press ──────────────────────────────────────────────────────

/** A message a send route hands the mailbox. The route has checked the request. */
export interface ToTake {
	id: string;
	/** Sent from its draft: the draft's row becomes the message, and its files stay its files. */
	fromDraft: boolean;
	fields: SentFields;
	/** When it leaves, in milliseconds. */
	sendAt: number;
	/** Sent later, at a time the person chose: the caps are asked when it leaves, not now. */
	later: boolean;
	/** The person whose right is asked again when it leaves. */
	by: string;
}

export type Taken =
	| { id: string; send_at: string; swept: string[] }
	| { refused: "not_found" | "scheduled" | "too_many" | CapFull };

/**
 * Takes a message: stores it in Scheduled with a `waiting` row, all or nothing. A draft that
 * is named becomes the message under the same id; a message that names a draft which waits
 * already is refused, so one draft is never sent twice. Nothing leaves here.
 */
export function take(storage: Storage, message: ToTake, now: number): Taken {
	const { sql } = storage;
	const { id, fields } = message;
	return storage.transactionSync((): Taken => {
		const place = placeOf(sql, id);
		if (message.fromDraft) {
			if (place === Folders.SCHEDULED) return { refused: "scheduled" };
			if (place !== Folders.DRAFT) return { refused: "not_found" };
		} else if (place !== null) return { refused: "not_found" };
		if (waitingCount(sql) >= SENDING.waiting) return { refused: "too_many" };
		if (!message.later) {
			// An ordinary send is refused at once when the caps are full (decision 15), counting
			// what waits to leave before it.
			const ahead = Number(
				[
					...sql.exec(
						`SELECT COUNT(*) AS n FROM submissions WHERE state = 'waiting' AND send_at <= ?1`,
						iso(message.sendAt),
					),
				][0]?.n ?? 0,
			);
			const full = capFull(sql, now, ahead);
			if (full !== null) return { refused: full };
		}

		let swept: string[] = [];
		if (message.fromDraft) {
			swept = dropUnfinished(sql, id);
			sql.exec(
				`UPDATE emails SET folder_id = ?1, subject = ?2, sender = ?3, recipient = ?4, cc = ?5, bcc = ?6,
					date = ?7, body = ?8, in_reply_to = ?9, email_references = ?10,
					thread_id = COALESCE(?11, thread_id, id), message_id = ?12, raw_headers = ?13, read = 1
				 WHERE id = ?14`,
				Folders.SCHEDULED,
				fields.subject,
				fields.sender,
				fields.recipient,
				fields.cc,
				fields.bcc,
				fields.date,
				fields.body,
				fields.in_reply_to ?? null,
				fields.email_references,
				fields.thread_id ?? null,
				fields.message_id,
				fields.raw_headers,
				id,
			);
		} else {
			sql.exec(
				`INSERT INTO emails (id, folder_id, subject, sender, recipient, cc, bcc, date, read, starred,
					body, in_reply_to, email_references, thread_id, message_id, raw_headers)
				 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1, 0, ?9, ?10, ?11, ?12, ?13, ?14)`,
				id,
				Folders.SCHEDULED,
				fields.subject,
				fields.sender,
				fields.recipient,
				fields.cc,
				fields.bcc,
				fields.date,
				fields.body,
				fields.in_reply_to ?? null,
				fields.email_references,
				fields.thread_id ?? fields.in_reply_to ?? id,
				fields.message_id,
				fields.raw_headers,
			);
		}
		const sendAt = iso(message.sendAt);
		// A draft that failed before has a row: this send replaces it.
		sql.exec(
			`INSERT OR REPLACE INTO submissions
				(email_id, state, send_at, retry_at, attempts, started_at, requested_at, requested_by, error, sent_at, service_id)
			 VALUES (?1, 'waiting', ?2, NULL, 0, NULL, ?3, ?4, NULL, NULL, NULL)`,
			id,
			sendAt,
			iso(now),
			message.by,
		);
		return { id, send_at: sendAt, swept };
	});
}

// ── Back to Drafts ─────────────────────────────────────────────────

/**
 * The message is a draft again, under the same id and with the same files. What only a
 * message on its way has is taken off: the id it would have carried and its header list. A
 * draft names what it answers by the id of that message, a message on its way by its
 * `Message-ID`, so the first is put back.
 */
function toDraft(sql: SqlStorage, id: string, now: number): void {
	sql.exec(
		`UPDATE emails SET folder_id = ?1, read = 0, date = ?2, message_id = NULL, raw_headers = NULL,
			email_references = NULL,
			in_reply_to = (
				SELECT o.id FROM emails o
				WHERE o.id != emails.id AND (o.message_id = emails.in_reply_to OR o.id = emails.in_reply_to)
				LIMIT 1
			)
		 WHERE id = ?3`,
		Folders.DRAFT,
		iso(now),
		id,
	);
}

export type TakenBack = "draft" | "started" | "not_found";

/**
 * Takes a message back (decision 10): a waiting one is a draft again, and a failed one loses
 * its mark. `started` when it was handed to the service already: too late.
 */
export function takeBack(storage: Storage, id: string, now: number): TakenBack {
	const { sql } = storage;
	return storage.transactionSync((): TakenBack => {
		const row = submissionOf(sql, id);
		if (row === null) return "not_found";
		if (row.state === "sending" || row.state === "sent") return "started";
		sql.exec(`DELETE FROM submissions WHERE email_id = ?1`, id);
		if (row.state === "waiting") toDraft(sql, id, now);
		return "draft";
	});
}

export type NewTime = { send_at: string } | "started" | "not_found";

/**
 * Gives a waiting message a new time (decision 13). Whoever does it becomes the person whose
 * right is asked when it leaves, and the tries start over.
 */
export function giveTime(
	storage: Storage,
	id: string,
	sendAt: number,
	by: string,
	now: number,
): NewTime {
	const { sql } = storage;
	return storage.transactionSync((): NewTime => {
		const changed = sql.exec(
			`UPDATE submissions SET send_at = ?1, retry_at = NULL, attempts = 0, error = NULL,
				requested_by = ?2, requested_at = ?3
			 WHERE email_id = ?4 AND state = 'waiting'`,
			iso(sendAt),
			by,
			iso(now),
			id,
		);
		if (changed.rowsWritten > 0) return { send_at: iso(sendAt) };
		const row = submissionOf(sql, id);
		return row?.state === "sending" || row?.state === "sent" ? "started" : "not_found";
	});
}

// ── Leaving ────────────────────────────────────────────────────────

/** The waiting messages whose time has come, in the order of their times. */
export function due(sql: SqlStorage, now: number, limit: number): SubmissionRow[] {
	return rows<SubmissionRow>(
		sql.exec(
			`SELECT * FROM submissions
			 WHERE state = 'waiting' AND COALESCE(retry_at, send_at) <= ?1
			 ORDER BY send_at ASC, email_id ASC LIMIT ?2`,
			iso(now),
			limit,
		),
	);
}

/**
 * The handover, written before the service is called (decision 5): `waiting` becomes
 * `sending` only if the row is still as `seen`, and only if the caps allow one more; the
 * message is counted against the caps in the same transaction. `held` when a cap is full,
 * `false` when the row changed or was handed over already. The caller waits until this is on
 * disk before it calls the service.
 */
export function handOver(
	storage: Storage,
	seen: SubmissionRow,
	now: number,
	kind: SendKind = "person",
): boolean | "held" {
	const { sql } = storage;
	return storage.transactionSync(() => {
		if (capFull(sql, now) !== null) return "held";
		const changed = sql.exec(
			`UPDATE submissions SET state = 'sending', started_at = ?1, attempts = attempts + 1, retry_at = NULL
			 WHERE email_id = ?2 AND state = 'waiting' AND send_at = ?3 AND COALESCE(retry_at, '') = ?4`,
			iso(now),
			seen.email_id,
			seen.send_at,
			seen.retry_at ?? "",
		);
		if (changed.rowsWritten === 0) return false;
		logSend(sql, now, kind);
		return true;
	});
}

/** The header list of a stored message, with the date it left in place of the one it was made. */
function leftAt(headers: unknown, at: string): string | null {
	if (typeof headers !== "string") return null;
	try {
		const list = JSON.parse(headers) as { key: string; value: string }[];
		return JSON.stringify(list.map((one) => (one.key === "date" ? { ...one, value: at } : one)));
	} catch {
		return headers;
	}
}

/**
 * The service took the message: it is `sent`, in Sent, and its date is the time it left
 * (decision 14). False when the row was not `sending`: nothing is changed then.
 */
export function markSent(storage: Storage, id: string, serviceId: string, now: number): boolean {
	const { sql } = storage;
	return storage.transactionSync(() => {
		const at = iso(now);
		const changed = sql.exec(
			`UPDATE submissions SET state = 'sent', sent_at = ?1, service_id = ?2, error = NULL, retry_at = NULL
			 WHERE email_id = ?3 AND state = 'sending'`,
			at,
			serviceId,
			id,
		);
		if (changed.rowsWritten === 0) return false;
		const row = [...sql.exec(`SELECT raw_headers FROM emails WHERE id = ?1`, id)][0];
		sql.exec(
			`UPDATE emails SET folder_id = ?1, date = ?2, raw_headers = ?3, read = 1 WHERE id = ?4`,
			Folders.SENT,
			at,
			leftAt(row?.raw_headers, at),
			id,
		);
		return true;
	});
}

/** Writes a failure; the caller holds the transaction and has read the row. */
function failRow(
	sql: SqlStorage,
	row: SubmissionRow,
	reason: string,
	now: number,
	counted: boolean,
) {
	sql.exec(
		`UPDATE submissions SET state = 'failed', error = ?1, retry_at = NULL WHERE email_id = ?2`,
		reason,
		row.email_id,
	);
	// The service did not take it: its place in the caps is free again.
	if (row.state === "sending" && !counted && row.started_at !== null) {
		unlogSend(sql, row.started_at);
	}
	toDraft(sql, row.email_id, now);
}

/**
 * The message did not leave and will not: it is `failed` with the reason, and in Drafts again
 * with its files (decision 9). `counted` says whether its place in the caps stays taken: it
 * does when nobody knows whether the message left.
 */
export function fail(
	storage: Storage,
	id: string,
	reason: string,
	now: number,
	counted = false,
): boolean {
	const { sql } = storage;
	return storage.transactionSync(() => {
		const row = submissionOf(sql, id);
		if (row === null || (row.state !== "waiting" && row.state !== "sending")) return false;
		failRow(sql, row, reason, now, counted);
		return true;
	});
}

/**
 * The service said "not now" (decision 8): the message waits for its next try, or has failed
 * with that code when the tries are used up. Says which.
 */
export function tryAgain(
	storage: Storage,
	id: string,
	code: string,
	now: number,
): "waiting" | "failed" | "skipped" {
	const { sql } = storage;
	return storage.transactionSync(() => {
		const row = submissionOf(sql, id);
		if (row === null || row.state !== "sending") return "skipped";
		const wait = retryAfterMs(row.attempts);
		if (wait === null) {
			failRow(sql, row, code, now, false);
			return "failed";
		}
		sql.exec(
			`UPDATE submissions SET state = 'waiting', retry_at = ?1, error = ?2 WHERE email_id = ?3`,
			iso(now + wait),
			code,
			id,
		);
		// The service did not take it: its place in the caps is free again.
		if (row.started_at !== null) unlogSend(sql, row.started_at);
		return "waiting";
	});
}

/**
 * Messages found handed over with no answer written, fifteen minutes after the attempt began
 * (decision 6): nobody knows whether they left. They are `failed` with `unknown`, and are
 * never handed over again. Returns their ids.
 */
export function failUnanswered(storage: Storage, now: number): string[] {
	const { sql } = storage;
	const stale = rows<{ email_id: string }>(
		sql.exec(
			`SELECT email_id FROM submissions WHERE state = 'sending' AND started_at <= ?1`,
			iso(now - SENDING.unansweredAfterMs),
		),
	).map((row) => row.email_id);
	return stale.filter((id) => fail(storage, id, "unknown", now, true));
}

/**
 * The times this mailbox waits for on account of outgoing mail (decision 17): for the waiting
 * messages their time or their next try, and not before the caps have room; for a message
 * that was handed over, the fifteenth minute of its attempt.
 */
export function leavingTimes(sql: SqlStorage, now: number): number[] {
	const times: number[] = [];
	const waiting = [
		...sql.exec(
			`SELECT MIN(COALESCE(retry_at, send_at)) AS at FROM submissions WHERE state = 'waiting'`,
		),
	][0]?.at;
	if (typeof waiting === "string") times.push(Math.max(Date.parse(waiting), capsFreeAt(sql, now)));
	const sending = [
		...sql.exec(`SELECT MIN(started_at) AS at FROM submissions WHERE state = 'sending'`),
	][0]?.at;
	if (typeof sending === "string") times.push(Date.parse(sending) + SENDING.unansweredAfterMs);
	return times.filter((time) => !Number.isNaN(time));
}

// ── Reading ────────────────────────────────────────────────────────

/** The same rows, each with `submission` when the message has a row in `submissions`. */
export function withSubmissions<T extends object>(
	sql: SqlStorage,
	list: readonly T[],
): (T & { submission?: Submission })[] {
	const ids = list.map((row) => String((row as { id?: unknown }).id));
	const found = new Map<string, Submission>();
	for (let start = 0; start < ids.length; start += CHUNK) {
		const chunk = ids.slice(start, start + CHUNK);
		const marks = chunk.map(() => "?").join(", ");
		for (const row of rows<SubmissionRow>(
			sql.exec(
				`SELECT email_id, state, send_at, error FROM submissions WHERE email_id IN (${marks})`,
				...chunk,
			),
		)) {
			found.set(row.email_id, { state: row.state, send_at: row.send_at, error: row.error });
		}
	}
	return list.map((row, index) => {
		const submission = found.get(ids[index] ?? "");
		return submission === undefined ? row : { ...row, submission };
	});
}

/**
 * What waits, soonest first (decision 2). Every message is a line of its own, whatever
 * conversation it belongs to: each has its own time.
 */
export function listScheduled(sql: SqlStorage, options: { page?: number; limit?: number }) {
	const limit = Math.min(Math.max(options.limit ?? 25, 1), 100);
	const offset = (Math.max(options.page ?? 1, 1) - 1) * limit;
	return [
		...sql.exec(
			`SELECT e.id, e.subject, e.sender, e.recipient, e.cc, e.bcc, e.date, e.read, e.starred,
				e.in_reply_to, e.email_references, e.thread_id, e.folder_id,
				SUBSTR(e.body, 1, 300) AS snippet
			 FROM emails e LEFT JOIN submissions s ON s.email_id = e.id
			 WHERE e.folder_id = ?1
			 ORDER BY COALESCE(s.send_at, e.date) ASC, e.id ASC LIMIT ?2 OFFSET ?3`,
			Folders.SCHEDULED,
			limit,
			offset,
		),
	].map((row) => ({
		...row,
		read: !!row.read,
		starred: !!row.starred,
		thread_count: 1,
		thread_unread_count: 0,
		participants: row.sender,
	}));
}
