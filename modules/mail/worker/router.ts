// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified by the Podbay contributors.

import { type Context, Hono } from "hono";
import { z } from "zod";
import type { ApiContext } from "../../../workers/auth/middleware";
import {
	attachmentRisk,
	NEEDS_ACKNOWLEDGEMENT_CODE,
	servedContentType,
} from "../shared/attachment-risk";
import { isLabelId } from "../shared/labels";
import { fileKey } from "./durableObject/drafts";
import { features } from "./lib/features";
import { headerFilename } from "./lib/filenames";
import { parseListOrder, type SearchFilterOptions } from "./lib/list-options";
import { mailboxQueries } from "./lib/mailbox-rpc";
import { deleteMessage } from "./lib/messages";
import { sendRequest, takeMessage, WAITS } from "./lib/outgoing";
import { bulk } from "./routes/bulk";
import { drafts } from "./routes/drafts";
import { keys } from "./routes/keys";
import { knownAddresses } from "./routes/known-addresses";
import { labels } from "./routes/labels";
import { live } from "./routes/live";
import { mailboxes } from "./routes/mailboxes";
import { original } from "./routes/original";
import { places } from "./routes/places";
import { handleForwardEmail, handleReplyEmail } from "./routes/reply-forward";
import { rules } from "./routes/rules";
import { sending } from "./routes/sending";

type AppContext = Context<ApiContext>;

// -- Request body schemas (kept for validation) ---------------------

// -- Helpers --------------------------------------------------------

function intQuery(c: AppContext, key: string): number | undefined {
	const v = c.req.query(key);
	if (!v) return undefined;
	const n = Number(v);
	return Number.isNaN(n) ? undefined : n;
}

const BAD_ORDER = { error: "A list is ordered newest, unread or starred.", code: "INVALID" };

/** The order asked for, `undefined` for none, or `null` for a value that names none. */
function orderQuery(c: AppContext) {
	const value = c.req.query("order");
	if (value === undefined || value === "") return undefined;
	return parseListOrder(value) ?? null;
}

function boolQuery(c: AppContext, key: string): boolean | undefined {
	const v = c.req.query(key);
	if (v === undefined || v === "") return undefined;
	return v === "true" || v === "1";
}

// -- App & middleware -----------------------------------------------

const app = new Hono<ApiContext>();

// Mail's routes. The shell mounts them behind its guard (workers/index.ts), which decides access
// for every one of them; nothing here checks access again.
app.route("/", mailboxes);
app.route("/", keys);
app.route("/", drafts);
app.route("/", labels);
app.route("/", places);
app.route("/", original);
app.route("/", bulk);
app.route("/", knownAddresses);
app.route("/", live);
app.route("/", sending);
app.route("/", rules);

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
	// Newest first unless the request says otherwise (ADR-0014, decision 25).
	const order = orderQuery(c);
	if (order === null) return c.json(BAD_ORDER, 400);
	const stub = c.var.mailboxStub;

	if (threaded && folder) {
		const emails = await mailboxQueries(stub).getThreadedEmails({ folder, page, limit, order });
		const totalCount = await mailboxQueries(stub).countThreadedEmails(folder);
		return c.json({ emails, totalCount });
	}
	const emails = await stub.getEmails({
		folder,
		thread_id,
		page,
		limit,
		order,
	});
	if (folder) {
		const totalCount = await stub.countEmails({ folder, thread_id });
		return c.json({ emails, totalCount });
	}
	return c.json(emails);
});

app.post("/api/v1/mailboxes/:mailboxId/emails", async (c: AppContext) => {
	const body = await sendRequest(c);
	if (body instanceof Response) return body;
	return takeMessage(c, body, {
		inReplyTo: body.in_reply_to || null,
		references: body.references || [],
		threadId: body.thread_id || null,
	});
});

app.get("/api/v1/mailboxes/:mailboxId/emails/:id", async (c: AppContext) => {
	const email = await c.var.mailboxStub.getEmail(c.req.param("id") ?? "");
	if (!email) return c.json({ error: "Email not found" }, 404);
	return new Response(JSON.stringify(email), {
		headers: { "Content-Type": "application/json" },
	});
});

app.put("/api/v1/mailboxes/:mailboxId/emails/:id", async (c: AppContext) => {
	const { read, starred } = (await c.req.json()) as { read?: boolean; starred?: boolean };
	const email = await c.var.mailboxStub.updateEmail(c.req.param("id") ?? "", { read, starred });
	if (email === "scheduled") return c.json(WAITS, 409);
	return email ? c.json(email) : c.json({ error: "Email not found" }, 404);
});

app.delete("/api/v1/mailboxes/:mailboxId/emails/:id", async (c: AppContext) => {
	const deleted = await deleteMessage(c.env.BUCKET, c.var.mailboxStub, c.req.param("id") ?? "");
	// A message that waits to leave is taken back first: it is not deleted from under its send.
	if (deleted === "scheduled") return c.json(WAITS, 409);
	return deleted ? c.body(null, 204) : c.json({ error: "Not found" }, 404);
});

app.post("/api/v1/mailboxes/:mailboxId/emails/:id/move", async (c: AppContext) => {
	const body = (await c.req.json().catch(() => null)) as { folderId?: unknown } | null;
	const folderId = body?.folderId;
	if (typeof folderId !== "string") return c.json({ error: "Invalid request" }, 400);
	const moved = await c.var.mailboxStub.moveEmail(c.req.param("id") ?? "", folderId);
	// Scheduled is neither a source nor a target: only a send fills it (ADR-0016, decision 2).
	if (moved === "scheduled") return c.json(WAITS, 409);
	// Sent is filled by sending, and Drafts takes back only a draft (issue #31).
	if (moved === "not_a_target") {
		return c.json({ error: "This place cannot take that message", code: "NOT_A_TARGET" }, 400);
	}
	return moved ? c.json({ status: "moved" }) : c.json({ error: "Folder not found" }, 400);
});

// -- Threads --------------------------------------------------------

app.get("/api/v1/mailboxes/:mailboxId/threads/:threadId", async (c: AppContext) => {
	return c.json(
		await mailboxQueries(c.var.mailboxStub).getThreadEmails(c.req.param("threadId") ?? ""),
	);
});

app.post("/api/v1/mailboxes/:mailboxId/threads/:threadId/read", async (c: AppContext) => {
	await c.var.mailboxStub.markThreadRead(c.req.param("threadId") ?? "");
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
	const order = orderQuery(c);
	if (order === null) return c.json(BAD_ORDER, 400);
	const stub = mailboxQueries(c.var.mailboxStub);
	const emails = await stub.searchEmails({
		...searchOpts,
		page: intQuery(c, "page"),
		limit: intQuery(c, "limit"),
		order,
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
	// The file must be one of the message in the address; the key below comes from its row.
	if (!attachment || attachment.email_id !== emailId) {
		return c.json({ error: "Attachment not found" }, 404);
	}
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
	const obj = await c.env.BUCKET.get(fileKey(attachment));
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

export { app };
