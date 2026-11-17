// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified by the Podbay contributors.

import { type Context, Hono } from "hono";
import PostalMime from "postal-mime";
import { z } from "zod";
import {
	attachmentRisk,
	NEEDS_ACKNOWLEDGEMENT_CODE,
	servedContentType,
} from "../shared/attachment-risk";
import { Folders } from "../shared/folders";
import { isLabelId } from "../shared/labels";
import { errorFields, log } from "../shared/log";
import { type ApiContext, guard } from "./auth/middleware";
import { mailboxExists } from "./auth/store";
import { sendEmail } from "./email-sender";
import { type StoredAttachment, storeAttachments } from "./lib/attachments";
import {
	buildThreadingHeaders,
	generateMessageId,
	SenderValidationError,
	validateSender,
} from "./lib/email-helpers";
import { features } from "./lib/features";
import { headerFilename, storageFilename } from "./lib/filenames";
import { type InboundEnvelope, routeInbound } from "./lib/inbound";
import { parseSortColumn, parseSortDirection, type SearchFilterOptions } from "./lib/list-options";
import { mailboxQueries } from "./lib/mailbox-rpc";
import { SendEmailRequestSchema } from "./lib/schemas";
import { account } from "./routes/account";
import { keys } from "./routes/keys";
import { labels } from "./routes/labels";
import { mailboxes } from "./routes/mailboxes";
import { people } from "./routes/people";
import { places } from "./routes/places";
import { recovery } from "./routes/recovery";
import { handleForwardEmail, handleReplyEmail } from "./routes/reply-forward";
import type { Env } from "./types";

type AppContext = Context<ApiContext>;

// -- Request body schemas (kept for validation) ---------------------

const DraftBody = z.object({
	to: z.string().optional(),
	cc: z.string().optional(),
	bcc: z.string().optional(),
	subject: z.string().optional(),
	body: z.string(),
	in_reply_to: z.string().optional(),
	thread_id: z.string().optional(),
	draft_id: z.string().optional(),
});

// -- Helpers --------------------------------------------------------

function intQuery(c: AppContext, key: string): number | undefined {
	const v = c.req.query(key);
	if (!v) return undefined;
	const n = Number(v);
	return Number.isNaN(n) ? undefined : n;
}

function boolQuery(c: AppContext, key: string): boolean | undefined {
	const v = c.req.query(key);
	if (v === undefined || v === "") return undefined;
	return v === "true" || v === "1";
}

// -- App & middleware -----------------------------------------------

const app = new Hono<ApiContext>();

// Every API route goes through the guard: it must be in the route table, a request that changes
// state must come from the app's own origin, and unless the route is public there must be a
// session with the right the table names. Nothing below checks access again.
app.use("/api/*", guard);

app.route("/", account);
app.route("/", mailboxes);
app.route("/", people);
app.route("/", keys);
app.route("/", labels);
app.route("/", places);
app.route("/", recovery);

// -- Config ---------------------------------------------------------

app.get("/api/v1/config", (c) => {
	const domainsRaw = c.env.DOMAINS || "";
	const domains = domainsRaw
		.split(",")
		.map((d) => d.trim())
		.filter(Boolean);
	const emailAddresses = c.env.EMAIL_ADDRESSES ?? [];
	return c.json({ domains, emailAddresses, features: features(c.env) });
});

// -- Emails ---------------------------------------------------------

app.get("/api/v1/mailboxes/:mailboxId/emails", async (c: AppContext) => {
	const folder = c.req.query("folder");
	const thread_id = c.req.query("thread_id");
	const threaded = boolQuery(c, "threaded");
	const page = intQuery(c, "page");
	const limit = intQuery(c, "limit");
	const sortColumn = parseSortColumn(c.req.query("sortColumn"));
	const sortDirection = parseSortDirection(c.req.query("sortDirection"));
	const stub = c.var.mailboxStub;

	if (threaded && folder) {
		const emails = await mailboxQueries(stub).getThreadedEmails({ folder, page, limit });
		const totalCount = await mailboxQueries(stub).countThreadedEmails(folder);
		return c.json({ emails, totalCount });
	}
	const emails = await stub.getEmails({
		folder,
		thread_id,
		page,
		limit,
		sortColumn,
		sortDirection,
	});
	if (folder) {
		const totalCount = await stub.countEmails({ folder, thread_id });
		return c.json({ emails, totalCount });
	}
	return c.json(emails);
});

app.post("/api/v1/mailboxes/:mailboxId/emails", async (c: AppContext) => {
	const mailboxId = c.req.param("mailboxId")!;
	const body = SendEmailRequestSchema.parse(await c.req.json());
	const {
		to,
		cc,
		bcc,
		from,
		subject,
		html,
		text,
		attachments,
		in_reply_to,
		references,
		thread_id,
	} = body;

	let toStr: string, fromEmail: string, fromDomain: string;
	try {
		({ toStr, fromEmail, fromDomain } = validateSender(to, from, mailboxId));
	} catch (e) {
		if (e instanceof SenderValidationError) return c.json({ error: e.message }, 400);
		throw e;
	}

	const { messageId, outgoingMessageId } = generateMessageId(fromDomain);
	const stub = c.var.mailboxStub;
	const rateLimitError = await mailboxQueries(stub).checkSendRateLimit();
	if (rateLimitError) return c.json({ error: rateLimitError }, 429);
	const attachmentData = await storeAttachments(c.env.BUCKET, messageId, attachments);

	await stub.createEmail(
		Folders.SENT,
		{
			id: messageId,
			subject,
			sender: fromEmail,
			recipient: toStr,
			cc: cc ? (Array.isArray(cc) ? cc.join(", ") : cc).toLowerCase() : null,
			bcc: bcc ? (Array.isArray(bcc) ? bcc.join(", ") : bcc).toLowerCase() : null,
			date: new Date().toISOString(),
			body: html || text || "",
			in_reply_to: in_reply_to || null,
			email_references: references ? JSON.stringify(references) : null,
			thread_id: thread_id || in_reply_to || messageId,
			message_id: outgoingMessageId,
			raw_headers: JSON.stringify([
				{ key: "from", value: typeof from === "string" ? from : `${from.name} <${from.email}>` },
				{ key: "to", value: Array.isArray(to) ? to.join(", ") : to },
				...(cc ? [{ key: "cc", value: Array.isArray(cc) ? cc.join(", ") : cc }] : []),
				...(bcc ? [{ key: "bcc", value: Array.isArray(bcc) ? bcc.join(", ") : bcc }] : []),
				{ key: "subject", value: subject },
				{ key: "date", value: new Date().toISOString() },
				{ key: "message-id", value: `<${outgoingMessageId}>` },
			]),
		},
		attachmentData,
	);

	c.executionCtx.waitUntil(
		sendEmail(c.env.EMAIL, {
			to,
			cc,
			bcc,
			from,
			subject,
			html,
			text,
			attachments: attachments?.map((att) => ({
				content: att.content,
				filename: att.filename,
				type: att.type,
				disposition: att.disposition || "attachment",
				contentId: att.contentId,
			})),
			...(in_reply_to ? { headers: buildThreadingHeaders(in_reply_to, references || []) } : {}),
		}).catch((e) => log.error("send.deferred_failed", errorFields(e))),
	);
	return c.json({ id: messageId, status: "sent" }, 202);
});

app.post("/api/v1/mailboxes/:mailboxId/drafts", async (c: AppContext) => {
	const mailboxId = c.req.param("mailboxId")!;
	const { to, cc, bcc, subject, body, in_reply_to, thread_id, draft_id } = DraftBody.parse(
		await c.req.json(),
	);
	const stub = c.var.mailboxStub;
	// Saving again replaces the draft that was saved before. Only a draft is replaced: an id
	// of a message anywhere else is refused, or saving a draft could delete mail for good.
	if (draft_id) {
		const old = (await stub.getEmail(draft_id)) as { folder_id?: string } | null;
		if (old && old.folder_id !== Folders.DRAFT) {
			return c.json({ error: "Only a draft can be replaced by a draft" }, 409);
		}
		if (old) await stub.deleteEmail(draft_id); // not atomic — create-then-delete would be safer
	}
	const messageId = crypto.randomUUID();
	const now = new Date().toISOString();
	await stub.createEmail(
		Folders.DRAFT,
		{
			id: messageId,
			subject: subject || "",
			sender: mailboxId.toLowerCase(),
			recipient: (to || "").toLowerCase(),
			cc: cc?.toLowerCase() || null,
			bcc: bcc?.toLowerCase() || null,
			date: now,
			body,
			in_reply_to: in_reply_to || null,
			email_references: null,
			thread_id: thread_id || in_reply_to || messageId,
		},
		[],
	);
	return c.json(
		{ id: messageId, status: "draft", subject: subject || "", recipient: to || "", date: now },
		201,
	);
});

app.get("/api/v1/mailboxes/:mailboxId/emails/:id", async (c: AppContext) => {
	const email = await c.var.mailboxStub.getEmail(c.req.param("id")!);
	if (!email) return c.json({ error: "Email not found" }, 404);
	return new Response(JSON.stringify(email), {
		headers: { "Content-Type": "application/json" },
	});
});

app.put("/api/v1/mailboxes/:mailboxId/emails/:id", async (c: AppContext) => {
	const { read, starred } = (await c.req.json()) as { read?: boolean; starred?: boolean };
	const email = await c.var.mailboxStub.updateEmail(c.req.param("id")!, { read, starred });
	return email ? c.json(email) : c.json({ error: "Email not found" }, 404);
});

app.delete("/api/v1/mailboxes/:mailboxId/emails/:id", async (c: AppContext) => {
	const id = c.req.param("id")!;
	const attachments = await c.var.mailboxStub.deleteEmail(id);
	if (attachments === null) return c.json({ error: "Not found" }, 404);
	if (attachments.length > 0)
		await c.env.BUCKET.delete(
			attachments.map((att) => `attachments/${id}/${att.id}/${att.filename}`),
		);
	return c.body(null, 204);
});

app.post("/api/v1/mailboxes/:mailboxId/emails/:id/move", async (c: AppContext) => {
	const { folderId } = (await c.req.json()) as { folderId: string };
	const success = await c.var.mailboxStub.moveEmail(c.req.param("id")!, folderId);
	return success ? c.json({ status: "moved" }) : c.json({ error: "Folder not found" }, 400);
});

// -- Threads --------------------------------------------------------

app.get("/api/v1/mailboxes/:mailboxId/threads/:threadId", async (c: AppContext) => {
	return c.json(await mailboxQueries(c.var.mailboxStub).getThreadEmails(c.req.param("threadId")!));
});

app.post("/api/v1/mailboxes/:mailboxId/threads/:threadId/read", async (c: AppContext) => {
	await c.var.mailboxStub.markThreadRead(c.req.param("threadId")!);
	return c.json({ status: "marked_read" });
});

// -- Reply / Forward ------------------------------------------------

app.post("/api/v1/mailboxes/:mailboxId/emails/:id/reply", handleReplyEmail);
app.post("/api/v1/mailboxes/:mailboxId/emails/:id/forward", handleForwardEmail);

// -- Folders --------------------------------------------------------

app.get("/api/v1/mailboxes/:mailboxId/folders", async (c: AppContext) =>
	c.json(await c.var.mailboxStub.getFolders()),
);

// -- Search ---------------------------------------------------------

app.get("/api/v1/mailboxes/:mailboxId/search", async (c: AppContext) => {
	const searchOpts: SearchFilterOptions = {
		query: c.req.query("query") || "",
		folder: c.req.query("folder"),
		from: c.req.query("from"),
		to: c.req.query("to"),
		subject: c.req.query("subject"),
		date_start: c.req.query("date_start"),
		date_end: c.req.query("date_end"),
		is_read: boolQuery(c, "is_read"),
		is_starred: boolQuery(c, "is_starred"),
		has_attachment: boolQuery(c, "has_attachment"),
		label: isLabelId(c.req.query("label")) ? c.req.query("label") : undefined,
	};
	// A label that is asked for and is not one finds nothing, never everything.
	if (c.req.query("label") !== undefined && searchOpts.label === undefined) {
		return c.json({ emails: [], totalCount: 0 });
	}
	const stub = mailboxQueries(c.var.mailboxStub);
	const emails = await stub.searchEmails({
		...searchOpts,
		page: intQuery(c, "page"),
		limit: intQuery(c, "limit"),
	});
	const totalCount = await stub.countSearchResults(searchOpts);
	return c.json({ emails, totalCount });
});

// -- Attachments ----------------------------------------------------

// -- Attachments (rule S5) -------------------------------------------
//
// An attachment is a download, never a page: it leaves with `Content-Disposition: attachment`,
// a type the sender did not choose, `nosniff`, and the API's content policy, which sandboxes it
// and lets it load nothing. One that is dangerous by design is not handed over by a plain link:
// the reader has to ask for it, in a request only the app itself can make.

const DownloadBody = z.object({ acknowledged: z.literal(true) });

async function attachmentResponse(c: AppContext, acknowledged: boolean): Promise<Response> {
	const emailId = c.req.param("emailId") ?? "";
	const attachmentId = c.req.param("attachmentId") ?? "";
	const attachment = await c.var.mailboxStub.getAttachment(attachmentId);
	if (!attachment) return c.json({ error: "Attachment not found" }, 404);
	const risk = attachmentRisk(attachment);
	if (risk !== null && !acknowledged) {
		return c.json(
			{
				error:
					"This attachment can do harm when opened. It is downloaded only when you ask for it.",
				code: NEEDS_ACKNOWLEDGEMENT_CODE,
				risk,
			},
			409,
		);
	}
	const obj = await c.env.BUCKET.get(
		`attachments/${emailId}/${attachmentId}/${attachment.filename}`,
	);
	if (!obj) return c.json({ error: "Attachment file not found" }, 404);
	const headers = new Headers();
	// A risky file never leaves with a type a browser would show, whatever the sender called it.
	headers.set(
		"Content-Type",
		risk === null ? servedContentType(attachment.mimetype) : "application/octet-stream",
	);
	headers.set(
		"Content-Disposition",
		`attachment; filename="${headerFilename(attachment.filename)}"; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`,
	);
	return new Response(obj.body, { headers });
}

app.get("/api/v1/mailboxes/:mailboxId/emails/:emailId/attachments/:attachmentId", (c: AppContext) =>
	attachmentResponse(c, false),
);

// A POST is refused by the guard unless it comes from the app's own origin, so a link in a
// message, or on another site, can never be the acknowledgement.
app.post(
	"/api/v1/mailboxes/:mailboxId/emails/:emailId/attachments/:attachmentId/download",
	async (c: AppContext) => {
		const parsed = DownloadBody.safeParse(await c.req.json().catch(() => null));
		if (!parsed.success) return c.json({ error: "Invalid request" }, 400);
		return attachmentResponse(c, true);
	},
);

// -- Receive inbound email ------------------------------------------

const MAX_EMAIL_SIZE = 25 * 1024 * 1024;

async function streamToArrayBuffer(stream: ReadableStream, streamSize: number) {
	if (streamSize > MAX_EMAIL_SIZE)
		throw new Error(`Email too large: ${streamSize} bytes exceeds ${MAX_EMAIL_SIZE} byte limit`);
	if (streamSize <= 0) throw new Error(`Invalid stream size: ${streamSize}`);
	const result = new Uint8Array(streamSize);
	let bytesRead = 0;
	const reader = stream.getReader();
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		if (bytesRead + value.length > streamSize) {
			reader.cancel();
			throw new Error(`Stream exceeds declared size`);
		}
		result.set(value, bytesRead);
		bytesRead += value.length;
	}
	return result;
}

async function receiveEmail(event: InboundEnvelope, env: Env, ctx: ExecutionContext) {
	// Route by the envelope recipient, before the body is read. The `To:` header is the sender's
	// text: it is missing for Bcc and names the list for list mail.
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

	const rawEmail = await streamToArrayBuffer(event.raw, event.rawSize);
	const parsedEmail = await new PostalMime().parse(rawEmail);

	const allRecipients = (parsedEmail.to ?? [])
		.map((t) => t.address?.toLowerCase())
		.filter(Boolean) as string[];
	const ccRecipients = (parsedEmail.cc || [])
		.map((e) => e.address?.toLowerCase())
		.filter(Boolean) as string[];
	const bccRecipients = (parsedEmail.bcc || [])
		.map((e) => e.address?.toLowerCase())
		.filter(Boolean) as string[];

	const messageId = crypto.randomUUID();

	const stub = env.MAILBOX.get(env.MAILBOX.idFromName(mailboxId));

	const attachmentData: StoredAttachment[] = [];
	if (parsedEmail.attachments) {
		for (const att of parsedEmail.attachments) {
			const attId = crypto.randomUUID();
			const filename = storageFilename(att.filename);
			await env.BUCKET.put(`attachments/${messageId}/${attId}/${filename}`, att.content);
			attachmentData.push({
				id: attId,
				email_id: messageId,
				filename,
				mimetype: att.mimeType,
				size: typeof att.content === "string" ? att.content.length : att.content.byteLength,
				content_id: att.contentId || null,
				disposition: att.disposition || "attachment",
			});
		}
	}

	const extractMsgId = (s: string) => {
		const m = s.match(/<([^>]+)>/);
		return m ? m[1] : s.trim().split(/\s+/)[0];
	};
	const inReplyTo = parsedEmail.inReplyTo ? extractMsgId(parsedEmail.inReplyTo) : null;
	const emailReferences = parsedEmail.references
		? parsedEmail.references.split(/\s+/).filter(Boolean).map(extractMsgId)
		: [];
	let threadId = emailReferences[0] || inReplyTo || messageId;

	if (inReplyTo || emailReferences.length > 0) {
		// The message joins the conversation of what it answers when that message is here; an
		// answer to something this mailbox never held keeps the id the sender's program gave it.
		const known = await mailboxQueries(stub).findThreadOfReferences(
			[...emailReferences, ...(inReplyTo ? [inReplyTo] : [])],
			parsedEmail.subject || "",
		);
		if (known) threadId = known;
	} else {
		const subjectThread = await mailboxQueries(stub).findThreadBySubject(
			parsedEmail.subject || "",
			parsedEmail.from?.address || undefined,
		);
		if (subjectThread) threadId = subjectThread;
	}

	const originalMessageId = parsedEmail.messageId ? extractMsgId(parsedEmail.messageId) : null;

	await stub.createEmail(
		Folders.INBOX,
		{
			id: messageId,
			subject: parsedEmail.subject || "",
			sender: (parsedEmail.from?.address || "").toLowerCase(),
			recipient: allRecipients.join(", ") || mailboxId,
			cc: ccRecipients.join(", ") || null,
			bcc: bccRecipients.join(", ") || null,
			date: new Date().toISOString(), // uses receive time, not the email's Date header
			body: parsedEmail.html || parsedEmail.text || "",
			in_reply_to: inReplyTo,
			email_references: emailReferences.length > 0 ? JSON.stringify(emailReferences) : null,
			thread_id: threadId,
			message_id: originalMessageId,
			raw_headers: JSON.stringify(parsedEmail.headers),
		},
		attachmentData,
	);

	// The auto-draft calls a model, so it runs only when the deployer turned the agent on.
	if (!features(env).agent) return;
	const agentStub = env.EMAIL_AGENT.get(env.EMAIL_AGENT.idFromName(mailboxId));
	ctx.waitUntil(
		agentStub
			.fetch(
				new Request("https://agents/onNewEmail", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						mailboxId,
						emailId: messageId,
						sender: (parsedEmail.from?.address || "").toLowerCase(),
						subject: parsedEmail.subject || "",
						threadId,
					}),
				}),
			)
			.catch((e) => log.error("agent.autodraft_trigger_failed", errorFields(e))),
	);
}

export { app, receiveEmail };
