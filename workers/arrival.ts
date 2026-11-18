// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified by the Podbay contributors.

/**
 * A message arrives (ADR-0015, decision 5). The steps, in this order and no other:
 *
 *   a  the mailbox is picked by the envelope recipient; an unknown one is rejected;
 *   b  a declared size that is not between 1 byte and 25 MiB is refused; nothing is read;
 *   c  a row for the arrival is written in the mailbox: id, key, size, envelope sender, time;
 *   d  the bytes are stored under that key, all of them, exactly as they came;
 *   e  the message is parsed;
 *   f  one transaction writes the message's row and its attachment rows and removes the
 *      arrival's row; the mailbox's rules (ADR-0008) decide in that step where the row is
 *      filed and how it is marked, and after it whether the automatic reply is owed;
 *   g  the attachments' bytes are written to the bucket.
 *
 * Step d is the line. Before the original is stored a failure removes what was written and
 * the handler throws: Podbay has not taken the message. After it the handler neither throws
 * nor rejects: Podbay has the message and finishes by itself, and what it cannot finish now
 * is picked up by the next arrival. A message that cannot be parsed or filed is still a
 * message: it is in the Inbox with its original and says why it has nothing else.
 *
 * A row always comes before the object it names (c before d, f before g), so nothing is ever
 * in the bucket that no row of the mailbox names.
 */
import PostalMime, { type Email } from "postal-mime";
import { errorFields, log } from "../shared/log";
import { MAX_ORIGINAL_BYTES, type Unparsed } from "../shared/original";
import { mailboxExists } from "./auth/store";
import type { MailboxDO } from "./durableObject";
import { fileKey } from "./durableObject/drafts";
import { type Arrival, type Filed, MAX_ROW_BYTES, rowWeight } from "./durableObject/originals";
import { features } from "./lib/features";
import { storageFilename } from "./lib/filenames";
import { type InboundEnvelope, routeInbound } from "./lib/inbound";
import { mailboxQueries } from "./lib/mailbox-rpc";
import { newRawKey, platformStatement } from "./lib/original";
import { factsOfParsed } from "./lib/rule-facts";
import type { Env } from "./types";

type Stub = DurableObjectStub<MailboxDO>;

/** Arrivals that were left half done and are taken up after one message is stored. */
export const PICKED_UP_AT_ONCE = 3;

/** The envelope sender is the sender's text: it is kept as text, and not much of it. */
const MAX_ENVELOPE_FROM = 320;

/** What the assistant is told about a new message, when it is switched on. */
interface Wake {
	emailId: string;
	sender: string;
	subject: string;
	threadId: string;
}

/**
 * Reads a stream of a declared size into memory. A stream that gives more or fewer bytes has
 * failed: a part of a message is never kept as if it were the whole.
 */
async function readExactly(stream: ReadableStream, size: number): Promise<Uint8Array> {
	const result = new Uint8Array(size);
	let read = 0;
	const reader = stream.getReader();
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		const chunk = value as Uint8Array;
		if (read + chunk.length > size) {
			await reader.cancel().catch(() => undefined);
			throw new Error("The message is longer than its declared size");
		}
		result.set(chunk, read);
		read += chunk.length;
	}
	if (read !== size) throw new Error("The message is shorter than its declared size");
	return result;
}

const messageIdOf = (text: string): string => {
	const found = text.match(/<([^>]+)>/);
	return found?.[1] ?? text.trim().split(/\s+/)[0] ?? "";
};
const addresses = (list: Email["to"]): string =>
	(list ?? [])
		.map((one) => one.address?.toLowerCase())
		.filter(Boolean)
		.join(", ");

/** The row of a message that was read, with the conversation it joins. */
async function rowOf(stub: Stub, mailboxId: string, id: string, parsed: Email) {
	const inReplyTo = parsed.inReplyTo ? messageIdOf(parsed.inReplyTo) : null;
	const references = parsed.references
		? parsed.references.split(/\s+/).filter(Boolean).map(messageIdOf)
		: [];
	let threadId = references[0] || inReplyTo || id;
	if (inReplyTo || references.length > 0) {
		// The message joins the conversation of what it answers when that message is here; an
		// answer to something this mailbox never held keeps the id the sender's program gave it.
		const known = await mailboxQueries(stub).findThreadOfReferences(
			[...references, ...(inReplyTo ? [inReplyTo] : [])],
			parsed.subject || "",
		);
		if (known) threadId = known;
	} else {
		const bySubject = await mailboxQueries(stub).findThreadBySubject(
			parsed.subject || "",
			parsed.from?.address || undefined,
		);
		if (bySubject) threadId = bySubject;
	}
	return {
		subject: parsed.subject || "",
		sender: (parsed.from?.address || "").toLowerCase(),
		recipient: addresses(parsed.to) || mailboxId,
		cc: addresses(parsed.cc) || null,
		bcc: addresses(parsed.bcc) || null,
		body: parsed.html || parsed.text || "",
		in_reply_to: inReplyTo,
		email_references: references.length > 0 ? JSON.stringify(references) : null,
		thread_id: threadId,
		message_id: parsed.messageId ? messageIdOf(parsed.messageId) : null,
		raw_headers: JSON.stringify(parsed.headers),
	};
}

/**
 * Steps e to g for an arrival whose original is stored. Gives what the assistant is told about
 * the message, or `null` when the message was filed as one that could not be read, or was
 * filed by someone else meanwhile.
 */
async function finish(
	env: Env,
	stub: Stub,
	mailboxId: string,
	id: string,
	bytes: Uint8Array,
	authResults: string | null,
): Promise<Wake | null> {
	const unread = (why: Unparsed): Filed => ({
		kind: "unparsed",
		why,
		recipient: mailboxId,
		auth_results: authResults,
	});

	// e. The parser refuses a message that nests too deep, has too large a header or too many
	// parts. That message is not lost: it is filed with its original and says so.
	let parsed: Email;
	try {
		parsed = await new PostalMime().parse(bytes);
	} catch (error) {
		log.warn("inbound.unparsed", { emailId: id, ...errorFields(error) });
		await stub.fileArrival(id, unread("parser"));
		return null;
	}

	const email = await rowOf(stub, mailboxId, id, parsed);
	const files = (parsed.attachments ?? []).map((part) => ({
		row: {
			id: crypto.randomUUID(),
			filename: storageFilename(part.filename),
			mimetype: part.mimeType,
			size: typeof part.content === "string" ? part.content.length : part.content.byteLength,
			content_id: part.contentId || null,
			disposition: part.disposition || "attachment",
		},
		content: part.content,
	}));

	// f. A text larger than a row can hold is known here, before it is carried to the mailbox.
	const filed =
		rowWeight(email) > MAX_ROW_BYTES
			? "too_large"
			: await stub.fileArrival(id, {
					kind: "parsed",
					email,
					attachments: files.map((file) => file.row),
					auth_results: authResults,
					// What the mailbox's rules are told about the message (ADR-0008). They run in the
					// mailbox, with this call: after the message was parsed, before its row is written.
					facts: factsOfParsed(parsed),
				});
	if (filed === "too_large") {
		log.warn("inbound.unparsed", { emailId: id, error: "too_large" });
		await stub.fileArrival(id, unread("too_large"));
		return null;
	}
	if (filed === "gone") return null;

	// g. The rows are there; now the bytes. A failure leaves a row whose file cannot be
	// downloaded, never an object without a row, and the file is still inside the original.
	const stored: string[] = [];
	try {
		for (const file of files) {
			await env.BUCKET.put(fileKey({ ...file.row, email_id: id }), file.content);
			stored.push(file.row.id);
		}
	} catch (error) {
		log.error("inbound.files_unfinished", { emailId: id, ...errorFields(error) });
	}
	if (stored.length > 0) await stub.filesStored(id, stored);
	// Only mail filed in the Inbox is given to the assistant: what the rules filed elsewhere,
	// and mail from a blocked sender, is not (ADR-0008).
	if (filed !== "filed") return null;
	return { emailId: id, sender: email.sender, subject: email.subject, threadId: email.thread_id };
}

/** The auto-draft calls a model, so it runs only when the deployer turned the agent on. */
function wake(env: Env, ctx: ExecutionContext, mailboxId: string, message: Wake | null): void {
	if (message === null || !features(env).agent) return;
	const agent = env.EMAIL_AGENT.get(env.EMAIL_AGENT.idFromName(mailboxId));
	ctx.waitUntil(
		agent
			.fetch(
				new Request("https://agents/onNewEmail", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ mailboxId, ...message }),
				}),
			)
			.catch((e) => log.error("agent.autodraft_trigger_failed", errorFields(e))),
	);
}

/**
 * One arrival that was left half done (decision 9). When its original is not there, its row
 * is removed. When it is, the arrival goes on from step e; from its second attempt it is filed
 * as `interrupted` and not parsed again, so a message that stops the parser cannot do so for
 * ever. What the platform said about it is gone with the handler that was stopped.
 */
async function resume(
	env: Env,
	ctx: ExecutionContext,
	stub: Stub,
	mailboxId: string,
	arrival: Arrival,
): Promise<void> {
	if (arrival.attempts >= 2) {
		if ((await env.BUCKET.head(arrival.raw_key)) === null) await stub.dropArrival(arrival.id);
		else {
			await stub.fileArrival(arrival.id, {
				kind: "unparsed",
				why: "interrupted",
				recipient: mailboxId,
				auth_results: null,
			});
		}
		return;
	}
	const object = await env.BUCKET.get(arrival.raw_key);
	if (object === null) {
		await stub.dropArrival(arrival.id);
		return;
	}
	const bytes = new Uint8Array(await object.arrayBuffer());
	wake(env, ctx, mailboxId, await finish(env, stub, mailboxId, arrival.id, bytes, null));
}

/** Takes up to three arrivals that were left half done, each by a call that counts the attempt. */
async function pickUp(
	env: Env,
	ctx: ExecutionContext,
	stub: Stub,
	mailboxId: string,
	own: string,
): Promise<void> {
	const taken = [own];
	for (let n = 0; n < PICKED_UP_AT_ONCE; n++) {
		try {
			const arrival = await stub.claimArrival(taken);
			if (arrival === null) return;
			taken.push(arrival.id);
			await resume(env, ctx, stub, mailboxId, arrival);
		} catch (error) {
			log.error("inbound.pickup_failed", errorFields(error));
		}
	}
}

export async function receiveEmail(
	event: InboundEnvelope,
	env: Env,
	ctx: ExecutionContext,
): Promise<void> {
	// a. Route by the envelope recipient, before the body is read. The `To:` header is the
	// sender's text: it is missing for Bcc and names the list for list mail.
	const decision = await routeInbound(
		event.to,
		(env.EMAIL_ADDRESSES ?? []) as string[],
		(address) => mailboxExists(env.DB, address),
	);
	if (!decision.deliver) {
		event.setReject(decision.reason);
		return;
	}
	const mailboxId = decision.mailboxId;

	// b. The platform rejects mail above 25 MiB; one that arrives all the same is refused here.
	const size = event.rawSize;
	if (!Number.isInteger(size) || size < 1 || size > MAX_ORIGINAL_BYTES) {
		event.setReject("Message size is not accepted");
		return;
	}

	const stub = env.MAILBOX.get(env.MAILBOX.idFromName(mailboxId));
	const id = crypto.randomUUID();
	const rawKey = newRawKey();

	// c. The row first: the object below is never in the bucket without it.
	await stub.beginArrival({
		id,
		raw_key: rawKey,
		raw_size: size,
		envelope_from: String(event.from ?? "").slice(0, MAX_ENVELOPE_FROM),
	});

	// d. The bytes, exactly as they came: nothing added, removed or decoded, and no metadata.
	let bytes: Uint8Array;
	try {
		bytes = await readExactly(event.raw, size);
		const stored = await env.BUCKET.put(rawKey, bytes);
		if (stored === null || stored.size !== size) throw new Error("The original was not stored");
	} catch (error) {
		// Podbay has not taken the message. What was written goes, then the row that named it;
		// if that fails the row stays, and the next arrival removes it or finishes the message.
		try {
			await env.BUCKET.delete(rawKey);
			await stub.dropArrival(id);
		} catch (cleanup) {
			log.error("inbound.cleanup_failed", { emailId: id, ...errorFields(cleanup) });
		}
		throw error;
	}

	// From here Podbay has the message. Nothing below throws or rejects.
	try {
		wake(
			env,
			ctx,
			mailboxId,
			await finish(env, stub, mailboxId, id, bytes, platformStatement(event.headers)),
		);
	} catch (error) {
		log.error("inbound.unfinished", { emailId: id, ...errorFields(error) });
	}
	ctx.waitUntil(pickUp(env, ctx, stub, mailboxId, id));
}
