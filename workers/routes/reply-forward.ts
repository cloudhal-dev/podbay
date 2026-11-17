// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified by the Podbay contributors.

import type { Context } from "hono";
import type { ApiContext } from "../auth/middleware";
import { buildReferencesChain, resolveOriginalEmail } from "../lib/email-helpers";
import { storeAndSend } from "../lib/outgoing";
import type { EmailFull } from "../lib/schemas";
import { SendEmailRequestSchema } from "../lib/schemas";

type AppContext = Context<ApiContext>;

/** An answer joins the conversation of the message it answers. */
export async function handleReplyEmail(c: AppContext) {
	const body = SendEmailRequestSchema.parse(await c.req.json());
	const stub = c.var.mailboxStub;
	const rawOriginal = (await stub.getEmail(c.req.param("id") ?? "")) as EmailFull | null;
	if (!rawOriginal) return c.json({ error: "Original email not found" }, 404);

	const originalEmail = await resolveOriginalEmail(stub, rawOriginal);
	const { originalMsgId, references, threadId } = buildReferencesChain(originalEmail);
	return storeAndSend(c, body, {
		inReplyTo: originalMsgId,
		references,
		threadId,
		markThreadRead: true,
	});
}

/** A forward starts a conversation of its own. */
export async function handleForwardEmail(c: AppContext) {
	const body = SendEmailRequestSchema.parse(await c.req.json());
	const stub = c.var.mailboxStub;
	const rawOriginal = (await stub.getEmail(c.req.param("id") ?? "")) as EmailFull | null;
	if (!rawOriginal) return c.json({ error: "Original email not found" }, 404);
	await resolveOriginalEmail(stub, rawOriginal);
	return storeAndSend(c, body, { inReplyTo: null, references: [], threadId: null });
}
