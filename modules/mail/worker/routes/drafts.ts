// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * A draft and its files (ADR-0011).
 *
 * A draft keeps its id: it is made once and then saved in place. A file is uploaded once, into
 * its draft, in two steps: it is declared (the limits are checked before a byte travels, and
 * the row is written), then its bytes arrive and go to the bucket as a stream. The key of a
 * file is built from its stored row and from nothing in the request.
 *
 * The guard has already checked the right (`mailbox.write`) and picked the mailbox, so an id
 * here only ever looks a row up in the database of the mailbox in the address.
 */
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import type { ApiContext } from "../../../../workers/auth/middleware";
import { attachmentRisk } from "../../shared/attachment-risk";
import { Folders } from "../../shared/folders";
import {
	MAX_COPIED_AT_ONCE,
	MAX_FILE_TYPE_CHARS,
	MAX_FILENAME_BYTES,
} from "../../shared/sending-limits";
import { type Declared, type FileRow, fileKey } from "../durableObject/drafts";
import { storageFilename } from "../lib/filenames";

const M = "/api/v1/mailboxes/:mailboxId";
type C = Context<ApiContext>;

const DraftBody = z.object({
	to: z.string().optional(),
	cc: z.string().optional(),
	bcc: z.string().optional(),
	subject: z.string().optional(),
	body: z.string(),
	in_reply_to: z.string().optional(),
	thread_id: z.string().optional(),
});
const DeclareBody = z.object({
	filename: z.string().min(1),
	type: z.string().min(1).max(MAX_FILE_TYPE_CHARS),
	size: z.number().int().min(1),
});
const CopyBody = z.object({
	emailId: z.string().max(128),
	attachmentIds: z.array(z.string().max(128)).min(1).max(MAX_COPIED_AT_ONCE),
	acknowledged: z.boolean().optional(),
});

const NOT_A_DRAFT = { error: "No such draft.", code: "NOT_FOUND" } as const;
const REFUSED = {
	too_large: [
		{
			error: "The files of a draft are too large to send together.",
			code: "DRAFT_FILES_TOO_LARGE",
		},
		413,
	],
	too_many: [
		{ error: "A draft holds as many files as a message can carry.", code: "DRAFT_TOO_MANY_FILES" },
		409,
	],
} as const;

const bytes = (text: string): number => new TextEncoder().encode(text).length;
const shown = (file: FileRow) => ({
	id: file.id,
	filename: file.filename,
	type: file.mimetype,
	size: file.size,
});

export const drafts = new Hono<ApiContext>();

function fields(mailboxId: string, body: z.infer<typeof DraftBody>, now: string) {
	return {
		subject: body.subject || "",
		sender: mailboxId.toLowerCase(),
		recipient: (body.to || "").toLowerCase(),
		cc: body.cc?.toLowerCase() || null,
		bcc: body.bcc?.toLowerCase() || null,
		date: now,
		body: body.body,
		in_reply_to: body.in_reply_to || null,
	};
}

drafts.post(`${M}/drafts`, async (c) => {
	const body = DraftBody.parse(await c.req.json());
	const id = crypto.randomUUID();
	const now = new Date().toISOString();
	await c.var.mailboxStub.createEmail(
		Folders.DRAFT,
		{
			...fields(c.req.param("mailboxId"), body, now),
			id,
			email_references: null,
			thread_id: body.thread_id || body.in_reply_to || id,
		},
		[],
	);
	return c.json(
		{ id, status: "draft", subject: body.subject || "", recipient: body.to || "", date: now },
		201,
	);
});

// Saving again saves over the same draft. Only a draft is saved over: an id of a message
// anywhere else does not name one.
drafts.put(`${M}/drafts/:draftId`, async (c) => {
	const body = DraftBody.parse(await c.req.json());
	const id = c.req.param("draftId");
	const now = new Date().toISOString();
	const saved = await c.var.mailboxStub.saveDraft(id, {
		...fields(c.req.param("mailboxId"), body, now),
		thread_id: body.thread_id || null,
	});
	if (!saved) return c.json(NOT_A_DRAFT, 404);
	return c.json({
		id,
		status: "draft",
		subject: body.subject || "",
		recipient: body.to || "",
		date: now,
	});
});

/** What a refused declaration answers, or the declared file. */
async function declare(
	c: C,
	file: { filename: string; mimetype: string; size: number; stored?: boolean },
): Promise<Declared> {
	const declared = await c.var.mailboxStub.declareFile(c.req.param("draftId") ?? "", {
		id: crypto.randomUUID(),
		...file,
	});
	// Files that were declared long ago and never arrived went with this change.
	if ("swept" in declared && declared.swept.length > 0) await c.env.BUCKET.delete(declared.swept);
	return declared;
}

drafts.post(`${M}/drafts/:draftId/attachments`, async (c) => {
	const body = DeclareBody.safeParse(await c.req.json().catch(() => null));
	// A name is input like a sender's: it is held to a length and cleaned before it is stored.
	if (!body.success || bytes(body.data.filename) > MAX_FILENAME_BYTES) {
		return c.json({ error: "A file needs a name, a type and a size.", code: "BAD_FILE" }, 400);
	}
	const declared = await declare(c, {
		filename: storageFilename(body.data.filename),
		mimetype: body.data.type,
		size: body.data.size,
	});
	if ("refused" in declared) {
		if (declared.refused === "not_found") return c.json(NOT_A_DRAFT, 404);
		const [answer, status] = REFUSED[declared.refused];
		return c.json(answer, status);
	}
	return c.json(shown(declared.file), 201);
});

drafts.put(`${M}/drafts/:draftId/attachments/:attachmentId`, async (c) => {
	const draftId = c.req.param("draftId");
	const file = await c.var.mailboxStub.draftFile(draftId, c.req.param("attachmentId"));
	if (file === null) return c.json(NOT_A_DRAFT, 404);
	if (file.uploading_since === null) {
		return c.json({ error: "This file is already stored.", code: "FILE_STORED" }, 409);
	}
	const length = c.req.header("content-length");
	if (length === undefined) {
		return c.json({ error: "The length of the file must be given.", code: "LENGTH_REQUIRED" }, 411);
	}
	const body = c.req.raw.body;
	if (Number(length) !== file.size || body === null) {
		return c.json({ error: "The file is not the size that was declared.", code: "BAD_FILE" }, 400);
	}
	try {
		// The bytes pass through as a stream of exactly the declared length; more or fewer fail.
		await c.env.BUCKET.put(fileKey(file), body.pipeThrough(new FixedLengthStream(file.size)));
	} catch {
		await c.env.BUCKET.delete(fileKey(file));
		return c.json({ error: "The file is not the size that was declared.", code: "BAD_FILE" }, 400);
	}
	if (!(await c.var.mailboxStub.markStored(draftId, file.id))) {
		return c.json({ error: "This file is already stored.", code: "FILE_STORED" }, 409);
	}
	return c.json(shown(file));
});

drafts.delete(`${M}/drafts/:draftId/attachments/:attachmentId`, async (c) => {
	const key = await c.var.mailboxStub.removeFile(
		c.req.param("draftId"),
		c.req.param("attachmentId"),
	);
	if (key === null) return c.json(NOT_A_DRAFT, 404);
	await c.env.BUCKET.delete(key);
	return c.body(null, 204);
});

// A forward carries the files of the message it forwards: they are copied inside the account,
// and the bytes never reach the browser. A file that can do harm is copied only when the
// person agreed, as for a download.
drafts.post(`${M}/drafts/:draftId/attachments/copy`, async (c) => {
	const body = CopyBody.safeParse(await c.req.json().catch(() => null));
	if (!body.success) return c.json({ error: "Invalid request" }, 400);
	const { emailId, attachmentIds, acknowledged } = body.data;
	const stub = c.var.mailboxStub;

	const copied: ReturnType<typeof shown>[] = [];
	const left: { id: string; reason: "risk" | "size" | "count" | "missing" }[] = [];
	for (const id of [...new Set(attachmentIds)]) {
		const source = (await stub.getAttachment(id)) as FileRow | null;
		if (source === null || source.email_id !== emailId) {
			left.push({ id, reason: "missing" });
			continue;
		}
		if (attachmentRisk(source) !== null && acknowledged !== true) {
			left.push({ id, reason: "risk" });
			continue;
		}
		// Name and type come from the stored row, never from the request.
		const declared = await declare(c, {
			filename: source.filename,
			mimetype: source.mimetype,
			size: source.size,
		});
		if ("refused" in declared) {
			if (declared.refused === "not_found") return c.json(NOT_A_DRAFT, 404);
			left.push({ id, reason: declared.refused === "too_many" ? "count" : "size" });
			continue;
		}
		const object = await c.env.BUCKET.get(fileKey(source));
		if (object === null) {
			await stub.removeFile(declared.file.email_id, declared.file.id);
			left.push({ id, reason: "missing" });
			continue;
		}
		await c.env.BUCKET.put(fileKey(declared.file), object.body);
		await stub.markStored(declared.file.email_id, declared.file.id);
		copied.push(shown(declared.file));
	}
	return c.json({ copied, left });
});
