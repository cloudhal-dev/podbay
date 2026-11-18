// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * The one function that lets mail leave (rule S8; ADR-0016, decisions 4 to 8 and 15).
 *
 * `leaveOne` is the only caller of the send binding in Podbay, for one message at a time. It
 * reads the message from the stored rows and its files from the bucket: nothing of a request
 * reaches it. It runs in the mailbox object, from the alarm, with nobody at the screen.
 *
 * **At most once.** The handover is `handOver` (`./submissions`): `waiting` becomes `sending`
 * only if the row is still as it was read, and that write is on disk before the service is
 * called. A row that is `sending` is never handed over again: an alarm that fires twice, or a
 * handler that starts over, finds `sending` or `sent` and does nothing. When the service gives
 * no answer, nobody knows whether the message left; it is `failed` with `unknown` and comes
 * back to Drafts for a person to decide. It is never sent again by itself.
 *
 * **The rules hold when it leaves** (decision 15), asked in this order: is the mailbox still
 * in the index; may the person who sent it still send here, and is the account still theirs;
 * for a reply the mailbox makes by itself, is that reply still on; is `From` still this
 * mailbox's address; does the message still fit what the service takes; do the caps allow
 * one more. A message 24 hours past its time does not leave.
 *
 * A log line carries opaque ids, the state and a code: never the service's own words, which
 * may hold an address.
 */
import { errorFields, log } from "../../shared/log";
import { type Outcome, outcomeOfRefusal, SENDING } from "../../shared/sending";
import { AUTO_REPLY_RIGHT, type Standing, standingOf } from "../auth/standing";
import { type SendEmailParams, sendEmail } from "../email-sender";
import { SenderValidationError, validateSender } from "../lib/email-helpers";
import { fits, fromStored, isAutomatic, type StoredMessage } from "../lib/outgoing-message";
import type { Env } from "../types";
import * as autoReply from "./auto-reply";
import { type FileRow, fileKey, storedFiles } from "./drafts";
import * as known from "./known";
import {
	due,
	fail,
	failUnanswered,
	forgetFailed,
	handOver,
	markSent,
	type SubmissionRow,
	tryAgain,
} from "./submissions";

/** What the handover needs of the mailbox object. */
export interface Leaver {
	ctx: DurableObjectState;
	env: Env;
	/** How long the service is waited for; `SENDING.answerWithinMs` outside tests. */
	answerWithinMs: number;
}

/** How soon the mailbox looks again after something other than the service failed. */
const LOOK_AGAIN_MS = 60_000;
/** How soon it looks again while its mailbox is not in the index: it is going or gone. */
const GONE_AGAIN_MS = 15 * 60_000;

const NO_ANSWER = Symbol("no answer");

/** The promise, or `NO_ANSWER` when it has not settled in time. Its late answer is dropped. */
function within<T>(promise: Promise<T>, ms: number): Promise<T | typeof NO_ANSWER> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const late = new Promise<typeof NO_ANSWER>((resolve) => {
		timer = setTimeout(() => resolve(NO_ANSWER), ms);
	});
	return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

/** The bytes of a stored file as the base64 the sending service takes. */
function base64(bytes: Uint8Array): string {
	let text = "";
	for (let from = 0; from < bytes.length; from += 0x8000) {
		text += String.fromCharCode(...bytes.subarray(from, from + 0x8000));
	}
	return btoa(text);
}

function storedMessage(sql: SqlStorage, id: string): StoredMessage | null {
	const row = [
		...sql.exec(
			`SELECT subject, sender, recipient, cc, bcc, body, in_reply_to, email_references, raw_headers
			 FROM emails WHERE id = ?1`,
			id,
		),
	][0];
	return row === undefined ? null : (row as unknown as StoredMessage);
}

type Attachments = NonNullable<SendEmailParams["attachments"]>;

/** The files of a message as they travel, or `null` when the bytes of one are not there. */
async function carried(bucket: Env["BUCKET"], files: readonly FileRow[]) {
	const attachments: Attachments = [];
	for (const file of files) {
		const object = await bucket.get(fileKey(file));
		if (object === null) return null;
		attachments.push({
			content: base64(new Uint8Array(await object.arrayBuffer())),
			filename: file.filename,
			type: file.mimetype,
			disposition: file.disposition === "inline" ? "inline" : "attachment",
			contentId: file.content_id ?? undefined,
		});
	}
	return attachments;
}

type Left = "sent" | "waiting" | "failed" | "held" | "skipped" | "gone";

/**
 * Lets one waiting message leave, or says why it did not. `held` when a cap is full: the
 * message stays `waiting`, and so does what follows it in time.
 */
async function leaveOne(
	leaver: Leaver,
	address: string,
	seen: SubmissionRow,
	clock: () => number,
): Promise<Left> {
	const { ctx, env } = leaver;
	const storage = ctx.storage;
	const id = seen.email_id;
	const mailbox = ctx.id.toString();
	// Mail the mailbox sends by itself (ADR-0008) is known by its own stored header list. It
	// is counted as `auto`, teaches the mailbox no address, and is nobody's draft when it does
	// not leave: it is removed, and never made again for the same message.
	const stored = storedMessage(storage.sql, id);
	const automatic = stored !== null && isAutomatic(stored);
	const notLeft = (reason: string, counted = false): boolean => {
		if (!fail(storage, id, reason, clock(), counted)) return false;
		if (automatic) forgetFailed(storage, id);
		return true;
	};
	const failed = (reason: string): Left => {
		// A reply that does not leave for a reason of the mailbox answered nobody (ADR-0008).
		const record = automatic ? autoReply.answeredBy(storage.sql, id) : null;
		if (!notLeft(reason)) return "skipped";
		if (record !== null) autoReply.unanswered(storage.sql, record);
		log.info("send.failed", { mailbox, message: id, reason });
		return "failed";
	};

	const standing: Standing = await standingOf(
		env.DB,
		address,
		seen.requested_by,
		seen.requested_at,
		automatic ? AUTO_REPLY_RIGHT : "mailbox.send",
	);
	if (standing === "gone") return "gone";
	if (clock() - Date.parse(seen.send_at) > SENDING.lateAfterMs) return failed("late");
	if (standing === "right") return failed("right");
	// The automatic reply is asked again when it leaves: turned off, or past its end date
	// since it was made, it does not leave.
	if (automatic && !autoReply.answersNow(storage.sql, clock())) return failed("off");

	if (stored === null) return "skipped";
	const message = fromStored(stored);
	try {
		validateSender(message.to, message.from, address);
	} catch (error) {
		if (error instanceof SenderValidationError) return failed("sender");
		throw error;
	}
	const files = storedFiles(storage.sql, id);
	if (!fits(message, files)) return failed("limits");
	const attachments = await carried(env.BUCKET, files);
	// A file whose bytes are gone: the message cannot leave as the person saw it.
	if (attachments === null) return failed("limits");

	// The handover. From here the row is `sending`, and nothing hands it over again.
	const began = handOver(storage, seen, clock(), automatic ? "auto" : "person");
	if (began === "held") return "held";
	if (!began) return "skipped";
	await storage.sync();

	let outcome: Outcome;
	try {
		const answer = await within(
			sendEmail(env.EMAIL, { ...message, ...(attachments.length > 0 ? { attachments } : {}) }),
			leaver.answerWithinMs,
		);
		outcome =
			answer !== NO_ANSWER && typeof answer.messageId === "string" && answer.messageId !== ""
				? { is: "sent", serviceId: answer.messageId }
				: outcomeOfRefusal(null);
	} catch (error) {
		outcome = outcomeOfRefusal(error);
	}

	if (outcome.is === "sent") {
		if (!markSent(storage, id, outcome.serviceId, clock())) return "skipped";
		// The mailbox learns whom it wrote to when a message a person sent has left, once
		// (ADR-0012). An automatic reply goes to an address a stranger gave: it teaches nothing.
		if (!automatic) {
			const { skipped } = known.learn(
				storage.sql,
				{
					sender: stored.sender ?? "",
					recipient: stored.recipient ?? "",
					cc: stored.cc,
					bcc: stored.bcc,
				},
				clock(),
			);
			if (skipped > 0) log.warn("known_addresses.skipped", { skipped });
		}
		log.info("send.left", { mailbox, message: id, attempt: seen.attempts + 1 });
		return "sent";
	}
	if (outcome.is === "again") {
		const now = tryAgain(storage, id, outcome.code, clock());
		if (now === "failed" && automatic) forgetFailed(storage, id);
		log.info("send.refused", { mailbox, message: id, code: outcome.code, state: now });
		return now;
	}
	// `unknown` keeps its place in the caps: the message may have left.
	if (!notLeft(outcome.error, outcome.error === "unknown")) return "skipped";
	log.warn("send.failed", { mailbox, message: id, reason: outcome.error });
	return "failed";
}

/**
 * One run for outgoing mail: what was handed over and never answered is given up, then the
 * messages whose time has come leave, at most ten, in the order of their times. Returns a
 * time before which the mailbox need not look again, when something stood in the way that is
 * not the message's own.
 */
export async function leave(leaver: Leaver, clock: () => number): Promise<number | undefined> {
	const { ctx } = leaver;
	const mailbox = ctx.id.toString();
	// Which of the messages that were handed over are the mailbox's own: asked before they are
	// given up, because a message that comes back to Drafts loses its header list.
	const own = new Set(
		[...ctx.storage.sql.exec(`SELECT email_id FROM submissions WHERE state = 'sending'`)]
			.map((row) => String(row.email_id))
			.filter((id) => {
				const stored = storedMessage(ctx.storage.sql, id);
				return stored !== null && isAutomatic(stored);
			}),
	);
	for (const id of failUnanswered(ctx.storage, clock())) {
		if (own.has(id)) forgetFailed(ctx.storage, id);
		log.warn("send.failed", { mailbox, message: id, reason: "unknown" });
	}
	const waiting = due(ctx.storage.sql, clock(), SENDING.perRun);
	if (waiting.length === 0) return undefined;
	// The object is named after the mailbox's address in the index, and by nothing else.
	const address = ctx.id.name;
	if (address === undefined) {
		log.error("send.unnamed", { mailbox });
		return clock() + GONE_AGAIN_MS;
	}
	let again: number | undefined;
	for (const seen of waiting) {
		try {
			const left = await leaveOne(leaver, address, seen, clock);
			if (left === "held") break;
			if (left === "gone") {
				log.warn("send.mailbox_gone", { mailbox });
				return clock() + GONE_AGAIN_MS;
			}
		} catch (error) {
			// Not the service's answer: the index or the bucket failed before the handover, or a
			// write after it. The message stays as it is and is looked at again.
			log.error("send.not_tried", { mailbox, message: seen.email_id, ...errorFields(error) });
			again = clock() + LOOK_AGAIN_MS;
		}
	}
	return again;
}
