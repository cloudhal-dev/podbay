// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * How much a mailbox may send (rule S8; ADR-0016, decision 16). The caps count what left:
 * `send_log` has one row for each message handed to the sending service, with the time and
 * its kind and nothing of the message. Deleting or moving sent mail does not shorten it.
 *
 * A row is written with the handover itself (`./submissions`, `handOver`) and taken out again
 * when the service answers that it did not take the message. A handover that got no answer
 * keeps its row: the message may have left.
 */

/** How much a mailbox may send. */
export const SENDS_PER_HOUR = 20;
export const SENDS_PER_DAY = 100;

const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;

/** Who a message left for: a person's own, or mail the Worker sends by itself (ADR-0008). */
export type SendKind = "person" | "auto";
/** The cap that is full. */
export type CapFull = "hour" | "day";

const iso = (time: number) => new Date(time).toISOString();

function leftSince(sql: SqlStorage, from: number): number {
	const row = [...sql.exec(`SELECT COUNT(*) AS n FROM send_log WHERE at >= ?1`, iso(from))][0];
	return Number(row?.n ?? 0);
}

/**
 * Which cap is full at `now`, or `null` when one more message may leave. `ahead` is how many
 * messages will have left before the one that is asked about: the ones that wait to leave
 * before it.
 */
export function capFull(sql: SqlStorage, now: number, ahead = 0): CapFull | null {
	if (leftSince(sql, now - HOUR_MS) + ahead >= SENDS_PER_HOUR) return "hour";
	if (leftSince(sql, now - DAY_MS) + ahead >= SENDS_PER_DAY) return "day";
	return null;
}

/** What a send that a full cap refuses is told. */
export const CAP_WORDS: Record<CapFull, string> = {
	hour: `Rate limit exceeded: max ${SENDS_PER_HOUR} emails per hour per mailbox`,
	day: `Rate limit exceeded: max ${SENDS_PER_DAY} emails per day per mailbox`,
};

/** Why the mailbox may not send now, or `null` when it may. */
export function sendRefusal(sql: SqlStorage, now: number, ahead = 0): string | null {
	const full = capFull(sql, now, ahead);
	return full === null ? null : CAP_WORDS[full];
}

/** The moment a span that holds `cap` rows or more has room again. */
function roomAt(sql: SqlStorage, now: number, span: number, cap: number): number {
	const held = leftSince(sql, now - span);
	if (held < cap) return now;
	// When the oldest rows that are too many have aged out of the span.
	const row = [
		...sql.exec(
			`SELECT at FROM send_log WHERE at >= ?1 ORDER BY at ASC LIMIT 1 OFFSET ?2`,
			iso(now - span),
			held - cap,
		),
	][0];
	const at = Date.parse(String(row?.at ?? ""));
	return Number.isNaN(at) ? now + span : at + span + 1;
}

/** When the caps allow one more message: `now` when they do already. */
export function capsFreeAt(sql: SqlStorage, now: number): number {
	return Math.max(
		roomAt(sql, now, HOUR_MS, SENDS_PER_HOUR),
		roomAt(sql, now, DAY_MS, SENDS_PER_DAY),
	);
}

/** Records that a message is handed over at `at`, and forgets what is older than a day. */
export function logSend(sql: SqlStorage, at: number, kind: SendKind): void {
	sql.exec(`DELETE FROM send_log WHERE at < ?1`, iso(at - DAY_MS));
	sql.exec(`INSERT INTO send_log (at, kind) VALUES (?1, ?2)`, iso(at), kind);
}

/** Takes one record back: the service answered that it did not take the message. */
export function unlogSend(sql: SqlStorage, at: string): void {
	sql.exec(
		`DELETE FROM send_log WHERE rowid IN (SELECT rowid FROM send_log WHERE at = ?1 LIMIT 1)`,
		at,
	);
}
