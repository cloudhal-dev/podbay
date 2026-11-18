// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * The automatic reply of a mailbox (ADR-0008, decisions 8 to 10): mail that leaves because
 * mail from a stranger arrived, with nobody at the screen.
 *
 * **One object.** It is the one row of `rules` whose kind is `auto_reply`, with the names
 * JMAP gives it, and with who saved it and when: it is that person's standing instruction,
 * and their right is asked again whenever a reply leaves (`./leaving`).
 *
 * **Whether a reply is owed** is decided by one pure function, `replyOwed` in
 * `shared/rules.ts`, from what is read here: never to a message that says a program sent it,
 * never unless the mailbox's address is in To or Cc, never to mail filed in Spam or Trash or
 * from a blocked sender, never to a list or a bounce, to the envelope sender only, and once
 * for a sender in seven days. `auto_reply_log` keeps the address that was answered and the
 * time, and nothing of any message.
 *
 * **It is still the mailbox sending** (rule S8). A reply that is owed is not sent here: it is
 * taken as a message that waits, like any other (`./submissions`), and leaves by the one
 * function that lets mail leave, which counts it against the mailbox's caps with the kind
 * `auto`. It has caps of its own below those, counted here, so a flood of incoming mail
 * cannot spend the day's sending. Nothing of the incoming message is in it: not its subject,
 * not its text, not its id.
 */
import {
	AUTO_REPLY,
	type AutoReply,
	answersAt,
	type MessageFacts,
	NO_AUTO_REPLY,
	type NoReply,
	type Outcome,
	replyOwed,
	replySender,
} from "../../shared/rules";
import { SENDING } from "../../shared/sending";
import { textToHtml } from "../lib/email-helpers";
import { headerList } from "../lib/outgoing-message";
import { capFull } from "./sending";
import { take, waitingCount } from "./submissions";

interface Storage {
	sql: SqlStorage;
	transactionSync: <T>(closure: () => T) => T;
}

const ID = "auto_reply";
const HOUR_MS = 60 * 60_000;
const iso = (time: number) => new Date(time).toISOString();

/** The object as it is stored, with who saved it and when. */
interface Stored {
	reply: AutoReply;
	by: string;
	at: string;
}

function stored(sql: SqlStorage): Stored | null {
	const row = [
		...sql.exec(`SELECT body, set_by, set_at FROM rules WHERE id = ?1 AND kind = 'auto_reply'`, ID),
	][0];
	if (row === undefined) return null;
	try {
		const body = JSON.parse(String(row.body)) as Partial<AutoReply>;
		const text = (value: unknown) => (typeof value === "string" ? value : null);
		return {
			reply: {
				isEnabled: body.isEnabled === true,
				fromDate: text(body.fromDate),
				toDate: text(body.toDate),
				subject: text(body.subject),
				textBody: text(body.textBody),
				htmlBody: text(body.htmlBody),
			},
			by: String(row.set_by),
			at: String(row.set_at),
		};
	} catch {
		// A row that cannot be read is a reply that is off.
		return null;
	}
}

/** The automatic reply of the mailbox, and who saved it and when. Off when none was saved. */
export function read(sql: SqlStorage): { reply: AutoReply; by: string | null; at: string | null } {
	const held = stored(sql);
	return held === null ? { reply: { ...NO_AUTO_REPLY }, by: null, at: null } : held;
}

/**
 * Saves the automatic reply (`PUT …/auto-reply`). The caller has parsed it with the strict
 * schema and has asked for fresh proof. Whoever saves it is the person whose right is asked
 * when a reply leaves. Says whether it was on before.
 */
export function save(sql: SqlStorage, reply: AutoReply, by: string, now: number): { was: boolean } {
	const was = stored(sql)?.reply.isEnabled === true;
	// The addresses that were answered are strangers' addresses, kept only for the once in
	// seven days. A reply that is off answers nobody, so it keeps none of them; one turned on
	// again is a new absence. Otherwise what is older than seven days goes now.
	if (reply.isEnabled) {
		sql.exec(`DELETE FROM auto_reply_log WHERE at < ?1`, iso(now - AUTO_REPLY.oncePerSenderMs));
	} else sql.exec(`DELETE FROM auto_reply_log`);
	sql.exec(
		`INSERT OR REPLACE INTO rules (id, kind, position, sender, body, set_at, set_by)
		 VALUES (?1, 'auto_reply', 0, NULL, ?2, ?3, ?4)`,
		ID,
		JSON.stringify(reply),
		iso(now),
		by,
	);
	return { was };
}

/**
 * Whether the reply, as it is stored now, answers at this time. A reply that waits is asked
 * this again when it leaves: turned off, or past its end date, it does not leave.
 */
export function answersNow(sql: SqlStorage, now: number): boolean {
	const held = stored(sql);
	return held !== null && answersAt(held.reply, now);
}

/** The record that a reply was made: the address it goes to, and when it was made. */
export interface Answered {
	sender: string;
	at: string;
}

/** The record of the reply that is this message, read before the message is removed. */
export function answeredBy(sql: SqlStorage, emailId: string): Answered | null {
	const row = [...sql.exec(`SELECT recipient, date FROM emails WHERE id = ?1`, emailId)][0];
	if (typeof row?.recipient !== "string" || typeof row.date !== "string") return null;
	return { sender: row.recipient, at: row.date };
}

/**
 * Takes back the record of a reply that did not leave because of the mailbox itself: it was
 * turned off, or the person who saved it may no longer send. Its sender was not answered, so
 * they are not held off for seven days and the reply's caps do not count them. A reply the
 * service refused keeps its record: it is not tried again for that sender.
 */
export function unanswered(sql: SqlStorage, record: Answered): void {
	sql.exec(`DELETE FROM auto_reply_log WHERE sender = ?1 AND at = ?2`, record.sender, record.at);
}

function answeredSince(sql: SqlStorage, from: number): number {
	const row = [
		...sql.exec(`SELECT COUNT(*) AS n FROM auto_reply_log WHERE at >= ?1`, iso(from)),
	][0];
	return Number(row?.n ?? 0);
}

function lastAnswered(sql: SqlStorage, sender: string): number | null {
	const row = [...sql.exec(`SELECT at FROM auto_reply_log WHERE sender = ?1`, sender)][0];
	const at = Date.parse(String(row?.at ?? ""));
	return Number.isNaN(at) ? null : at;
}

/** How many messages wait to leave by `now`: they leave before a reply made now. */
function dueBy(sql: SqlStorage, now: number): number {
	const row = [
		...sql.exec(
			`SELECT COUNT(*) AS n FROM submissions WHERE state = 'waiting' AND send_at <= ?1`,
			iso(now),
		),
	][0];
	return Number(row?.n ?? 0);
}

/** A message that arrived, as far as the reply is decided by it. */
export interface Arrived {
	/** The mailbox's own address: the name of its object in the index. */
	address: string;
	/** The envelope sender, from the arrival's own row. */
	envelopeFrom: string;
	facts: MessageFacts;
	outcome: Outcome;
	/** The mailbox's blocked senders, which the envelope sender is asked of too. */
	blocked: readonly string[];
}

/**
 * Decides whether the automatic reply is owed for a message that was just filed, and when it
 * is, takes the reply as a message that waits to leave. Returns `queued`, or why not. The
 * record of who was answered is written with the reply, in the same turn.
 */
export function consider(storage: Storage, arrived: Arrived, now: number): "queued" | NoReply {
	const { sql } = storage;
	const held = stored(sql);
	if (held === null) return "off";
	const envelopeFrom = replySender(arrived.envelopeFrom);
	const owed = replyOwed({
		reply: held.reply,
		now,
		mailbox: arrived.address,
		envelopeFrom,
		facts: arrived.facts,
		outcome: arrived.outcome,
		blocked: arrived.blocked,
		lastAnsweredAt: lastAnswered(sql, envelopeFrom),
		lastHour: answeredSince(sql, now - HOUR_MS),
		lastDay: answeredSince(sql, now - 24 * HOUR_MS),
		// One more message may wait, and the mailbox's own caps have room for it after what
		// is due to leave before it.
		room: waitingCount(sql) < SENDING.waiting && capFull(sql, now, dueBy(sql, now)) === null,
	});
	if ("no" in owed) return owed.no;

	const address = arrived.address.toLowerCase();
	const id = crypto.randomUUID();
	const date = iso(now);
	const subject = held.reply.subject ?? AUTO_REPLY.defaultSubject;
	const messageId = `${id}@${address.slice(address.indexOf("@") + 1)}`;
	// The record first: whatever happens next, this sender is not answered a second time.
	sql.exec(`DELETE FROM auto_reply_log WHERE at < ?1`, iso(now - AUTO_REPLY.oncePerSenderMs));
	sql.exec(`INSERT OR REPLACE INTO auto_reply_log (sender, at) VALUES (?1, ?2)`, owed.to, date);
	const taken = take(
		storage,
		{
			id,
			fromDraft: false,
			// It leaves at once, and the caps were asked above: `later` only says "not again here".
			sendAt: now,
			later: true,
			by: held.by,
			askedAt: Date.parse(held.at),
			fields: {
				subject,
				sender: address,
				recipient: owed.to,
				cc: null,
				bcc: null,
				date,
				// The reply is the person's own words. Nothing of the message that arrived is read here.
				body: held.reply.htmlBody ?? textToHtml(held.reply.textBody ?? ""),
				in_reply_to: null,
				email_references: null,
				thread_id: null,
				message_id: messageId,
				raw_headers: headerList({
					from: address,
					to: owed.to,
					subject,
					date,
					messageId,
					inReplyTo: null,
					references: [],
					automatic: true,
				}),
			},
		},
		now,
	);
	if ("refused" in taken) {
		// No message was made, so nobody was answered.
		sql.exec(`DELETE FROM auto_reply_log WHERE sender = ?1 AND at = ?2`, owed.to, date);
		return "cap";
	}
	return "queued";
}
