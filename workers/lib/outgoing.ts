// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * The one way a message a person sends is stored and handed to the sending service (rule S8).
 * Sending, answering and forwarding differ only in how the message is threaded; everything
 * else is here.
 *
 * A message with files is sent from its draft (ADR-0011): the request names the draft, the
 * files are the draft's stored files, read from the bucket here, and the draft's row becomes
 * the sent message under the same id. Nothing is uploaded twice and no draft is left behind.
 */
import type { Context } from "hono";
import type { z } from "zod";
import { Folders } from "../../shared/folders";
import { errorFields, log } from "../../shared/log";
import { MAX_ATTACHMENTS, MAX_MESSAGE_BYTES, messageBytes } from "../../shared/sending-limits";
import type { ApiContext } from "../auth/middleware";
import { type FileRow, fileKey } from "../durableObject/drafts";
import { sendEmail } from "../email-sender";
import { buildThreadingHeaders, SenderValidationError, validateSender } from "./email-helpers";
import { mailboxQueries } from "./mailbox-rpc";
import type { SendEmailRequestSchema } from "./schemas";

type C = Context<ApiContext>;

export interface Threading {
	/** The message this one answers, as its Message-ID without brackets. */
	inReplyTo: string | null;
	/** The chain of messages before it, each without brackets. */
	references: string[];
	/** The conversation it belongs to; `null` keeps the draft's, or starts one. */
	threadId: string | null;
	/** An answer reads the conversation it answers. */
	markThreadRead?: boolean;
}

/** The bytes of a stored file as the base64 the sending service takes. */
function base64(bytes: Uint8Array): string {
	let text = "";
	for (let from = 0; from < bytes.length; from += 0x8000) {
		text += String.fromCharCode(...bytes.subarray(from, from + 0x8000));
	}
	return btoa(text);
}

const joined = (field: string | string[] | undefined): string | null =>
	field === undefined ? null : (Array.isArray(field) ? field.join(", ") : field).toLowerCase();
const listed = (field: string | string[]): string =>
	Array.isArray(field) ? field.join(", ") : field;

export async function storeAndSend(
	c: C,
	body: z.infer<typeof SendEmailRequestSchema>,
	threading: Threading,
): Promise<Response> {
	const mailboxId = c.req.param("mailboxId") ?? "";
	const { to, cc, bcc, from, subject, html, text } = body;
	const stub = c.var.mailboxStub;

	let toStr: string, fromEmail: string, fromDomain: string;
	try {
		({ toStr, fromEmail, fromDomain } = validateSender(to, from, mailboxId));
	} catch (e) {
		if (e instanceof SenderValidationError) return c.json({ error: e.message }, 400);
		throw e;
	}
	const rateLimitError = await mailboxQueries(stub).checkSendRateLimit();
	if (rateLimitError) return c.json({ error: rateLimitError }, 429);

	// The files of the message are the stored files of its draft, and nothing else.
	const read = new Map<string, string>();
	const readFile = async (file: FileRow): Promise<boolean> => {
		if (read.has(file.id)) return true;
		const object = await c.env.BUCKET.get(fileKey(file));
		if (object === null) return false;
		read.set(file.id, base64(new Uint8Array(await object.arrayBuffer())));
		return true;
	};
	if (body.draft_id !== undefined) {
		const draft = (await stub.getEmail(body.draft_id)) as {
			folder_id: string;
			attachments: FileRow[];
		} | null;
		if (draft === null || draft.folder_id !== Folders.DRAFT) {
			return c.json({ error: "No such draft.", code: "NOT_FOUND" }, 404);
		}
		// The limits of a message are asked again at sending, with the text that goes with it.
		const files = draft.attachments.reduce((sum, file) => sum + Math.ceil((file.size * 4) / 3), 0);
		if (
			draft.attachments.length > MAX_ATTACHMENTS ||
			messageBytes({ html, text }) + files > MAX_MESSAGE_BYTES
		) {
			return c.json({ error: "The message is too large to send", code: "MESSAGE_TOO_LARGE" }, 413);
		}
		for (const file of draft.attachments) {
			if (!(await readFile(file))) {
				return c.json(
					{
						error: "A file of this draft cannot be read. Remove it and try again.",
						code: "FILE_MISSING",
					},
					409,
				);
			}
		}
	}

	const id = body.draft_id ?? crypto.randomUUID();
	const outgoingMessageId = `${id}@${fromDomain}`;
	const now = new Date().toISOString();
	const row = {
		subject,
		sender: fromEmail,
		recipient: toStr,
		cc: joined(cc),
		bcc: joined(bcc),
		date: now,
		body: html || text || "",
		in_reply_to: threading.inReplyTo,
		email_references: threading.references.length > 0 ? JSON.stringify(threading.references) : null,
		message_id: outgoingMessageId,
		raw_headers: JSON.stringify([
			{ key: "from", value: typeof from === "string" ? from : `${from.name} <${from.email}>` },
			{ key: "to", value: listed(to) },
			...(cc ? [{ key: "cc", value: listed(cc) }] : []),
			...(bcc ? [{ key: "bcc", value: listed(bcc) }] : []),
			{ key: "subject", value: subject },
			{ key: "date", value: now },
			{ key: "message-id", value: `<${outgoingMessageId}>` },
			...(threading.inReplyTo ? [{ key: "in-reply-to", value: `<${threading.inReplyTo}>` }] : []),
			...(threading.references.length > 0
				? [{ key: "references", value: threading.references.map((r) => `<${r}>`).join(" ") }]
				: []),
		]),
	};

	let sent: FileRow[] = [];
	if (body.draft_id === undefined) {
		await stub.createEmail(
			Folders.SENT,
			{ ...row, id, thread_id: threading.threadId ?? threading.inReplyTo ?? id },
			[],
		);
	} else {
		// The draft's row becomes the sent message: same id, so its files keep their keys.
		const became = await stub.sendDraft(id, { ...row, thread_id: threading.threadId });
		if ("refused" in became) return c.json({ error: "No such draft.", code: "NOT_FOUND" }, 404);
		if (became.swept.length > 0) await c.env.BUCKET.delete(became.swept);
		sent = became.files;
		// A file whose bytes arrived between the look and the handover goes with the message.
		for (const file of sent) await readFile(file);
	}
	if (threading.markThreadRead && threading.threadId !== null) {
		await stub.markThreadRead(threading.threadId);
	}

	const headers = threading.inReplyTo
		? buildThreadingHeaders(threading.inReplyTo, threading.references)
		: {};
	c.executionCtx.waitUntil(
		sendEmail(c.env.EMAIL, {
			to,
			cc,
			bcc,
			from,
			subject,
			html,
			text,
			attachments: sent
				.filter((file) => read.has(file.id))
				.map((file) => ({
					content: read.get(file.id) ?? "",
					filename: file.filename,
					type: file.mimetype,
					disposition:
						file.disposition === "inline" ? ("inline" as const) : ("attachment" as const),
					contentId: file.content_id ?? undefined,
				})),
			...(Object.keys(headers).length > 0 ? { headers } : {}),
		}).catch((e) => log.error("send.deferred_failed", errorFields(e))),
	);
	return c.json({ id, status: "sent" }, 202);
}
