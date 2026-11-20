// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * The one way a message a person sends is taken by the mailbox (rule S8; ADR-0016). Sending,
 * answering and forwarding differ only in how the message is threaded; everything else is
 * here.
 *
 * **Nothing leaves here.** A send route checks the request, stores the message in Scheduled
 * with the time it leaves, and answers. The message leaves later, from the mailbox's own
 * object (`workers/durableObject/leaving.ts`), which reads it from the stored rows: nothing
 * of the request reaches the sending service by any other way.
 *
 * A message with files is sent from its draft (ADR-0011): the request names the draft, whose
 * row becomes the message under the same id, so its files stay its files and a message taken
 * back is the same draft again. A message sent without a draft gets its row at the press all
 * the same.
 */
import type { Context } from "hono";
import type { z } from "zod";
import { Folders } from "../../shared/folders";
import { SEND_CODES, type SendAnswer, whenToLeave } from "../../shared/sending";
import type { ApiContext } from "../auth/middleware";
import { type FileRow, fileKey } from "../durableObject/drafts";
import { CAP_WORDS } from "../durableObject/sending";
import { SenderValidationError, textToHtml, validateSender } from "./email-helpers";
import { fits, headerList } from "./outgoing-message";
import { SendEmailRequestSchema } from "./schemas";

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

const joined = (field: string | string[] | undefined): string | null =>
	field === undefined ? null : (Array.isArray(field) ? field.join(", ") : field).toLowerCase();

/** What a route answers for a message that waits to leave: nothing else changes it. */
export const WAITS = {
	error: "This message is waiting to be sent. Take it back before changing it.",
	code: SEND_CODES.scheduled,
} as const;

const NO_DRAFT = { error: "No such draft.", code: "NOT_FOUND" } as const;

/**
 * The body of a send, held to the schema of the three send routes (rule D2). A body that is
 * not one is answered 400 with the first thing that is wrong with it.
 */
export async function sendRequest(
	c: C,
): Promise<z.infer<typeof SendEmailRequestSchema> | Response> {
	const parsed = SendEmailRequestSchema.safeParse(await c.req.json().catch(() => null));
	if (parsed.success) return parsed.data;
	return c.json(
		{ error: parsed.error.issues[0]?.message ?? "Invalid request.", code: "INVALID" },
		400,
	);
}

/**
 * The files of the draft a message is sent from, after the limits of a message were asked
 * again with the text that goes with it. Their bytes must be there: they are read when the
 * message leaves, not now.
 */
async function draftFiles(
	c: C,
	draftId: string,
	text: { html: string; text?: string },
): Promise<FileRow[] | Response> {
	const draft = (await c.var.mailboxStub.getEmail(draftId)) as {
		folder_id: string;
		attachments: FileRow[];
	} | null;
	// A send that names a draft is not made twice: the second finds the message waiting.
	if (draft?.folder_id === Folders.SCHEDULED) return c.json(WAITS, 409);
	if (draft === null || draft.folder_id !== Folders.DRAFT) return c.json(NO_DRAFT, 404);
	if (!fits({ to: "to", ...text }, draft.attachments)) {
		return c.json({ error: "The message is too large to send", code: "MESSAGE_TOO_LARGE" }, 413);
	}
	for (const file of draft.attachments) {
		if ((await c.env.BUCKET.head(fileKey(file))) === null) {
			return c.json(
				{
					error: "A file of this draft cannot be read. Remove it and try again.",
					code: "FILE_MISSING",
				},
				409,
			);
		}
	}
	return draft.attachments;
}

/**
 * Takes a message: checks it, stores it in Scheduled and gives it a time. The answer says
 * that the mailbox has it and when it leaves, never that it was sent.
 */
export async function takeMessage(
	c: C,
	body: z.infer<typeof SendEmailRequestSchema>,
	threading: Threading,
): Promise<Response> {
	const mailboxId = c.req.param("mailboxId") ?? "";
	const { to, cc, bcc, from, subject } = body;
	const stub = c.var.mailboxStub;

	let toStr: string, fromEmail: string, fromDomain: string;
	try {
		({ toStr, fromEmail, fromDomain } = validateSender(to, from, mailboxId));
	} catch (e) {
		if (e instanceof SenderValidationError) return c.json({ error: e.message }, 400);
		throw e;
	}
	const now = Date.now();
	const leaves = whenToLeave(body, now);
	if ("refused" in leaves) {
		return leaves.refused === "too_far"
			? c.json(
					{
						error: "A message can be sent later by a year at most.",
						code: SEND_CODES.tooFar,
					},
					400,
				)
			: c.json({ error: "The time to send at is in the past.", code: "INVALID" }, 400);
	}

	// A row keeps one body, the HTML. The text form is made from it again when it leaves.
	const html = body.html || textToHtml(body.text ?? "");
	if (body.draft_id !== undefined) {
		const files = await draftFiles(c, body.draft_id, { html, text: body.text });
		if (files instanceof Response) return files;
	}

	const id = body.draft_id ?? crypto.randomUUID();
	const outgoingMessageId = `${id}@${fromDomain}`;
	const date = new Date(now).toISOString();
	const taken = await stub.submit({
		id,
		fromDraft: body.draft_id !== undefined,
		sendAt: leaves.at,
		later: leaves.later,
		by: c.var.user.id,
		fields: {
			subject,
			sender: fromEmail,
			recipient: toStr,
			cc: joined(cc),
			bcc: joined(bcc),
			date,
			body: html,
			in_reply_to: threading.inReplyTo,
			email_references:
				threading.references.length > 0 ? JSON.stringify(threading.references) : null,
			thread_id: threading.threadId,
			message_id: outgoingMessageId,
			raw_headers: headerList({
				from,
				to,
				cc,
				bcc,
				subject,
				date,
				messageId: outgoingMessageId,
				inReplyTo: threading.inReplyTo,
				references: threading.references,
			}),
		},
	});
	if ("refused" in taken) {
		if (taken.refused === "not_found") return c.json(NO_DRAFT, 404);
		if (taken.refused === "scheduled") return c.json(WAITS, 409);
		if (taken.refused === "too_many") {
			return c.json(
				{
					error: "This mailbox holds as many waiting messages as it can.",
					code: SEND_CODES.tooMany,
				},
				409,
			);
		}
		return c.json({ error: CAP_WORDS[taken.refused] }, 429);
	}
	// Files that were declared and never arrived are not part of the message.
	if (taken.swept.length > 0) await c.env.BUCKET.delete(taken.swept);
	if (threading.markThreadRead && threading.threadId !== null) {
		await stub.markThreadRead(threading.threadId);
	}
	const answer: SendAnswer = { id, status: "waiting", send_at: taken.send_at };
	return c.json(answer, 202);
}
