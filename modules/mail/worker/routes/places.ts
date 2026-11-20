// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Emptying a place (ADR-0009). Only Trash and Spam can be emptied, so a mistaken id can never
 * empty the inbox. The guard has already checked the right (`mailbox.write`) and picked the
 * mailbox.
 */
import { Hono } from "hono";
import { z } from "zod";
import type { ApiContext } from "../../../../workers/auth/middleware";
import { EMPTIABLE } from "../durableObject/emptying";
import { deleteObjects } from "../lib/messages";

const M = "/api/v1/mailboxes/:mailboxId";

/** `before` is what an earlier answer gave: the moment emptying was asked for. */
const EmptyBody = z.object({ before: z.string().datetime().optional() });

export const places = new Hono<ApiContext>();

places.post(`${M}/folders/:folderId/empty`, async (c) => {
	const place = c.req.param("folderId");
	if (!EMPTIABLE.includes(place)) {
		return c.json({ error: "Only Trash and Spam can be emptied.", code: "NOT_EMPTIABLE" }, 400);
	}
	const body = EmptyBody.safeParse(await c.req.json().catch(() => ({})));
	if (!body.success) return c.json({ error: "Invalid request" }, 400);

	// What was there when it was asked: a later call names the same moment, and a moment that
	// has not come yet is not taken.
	const now = new Date().toISOString();
	const before = body.data.before !== undefined && body.data.before < now ? body.data.before : now;

	// Objects before rows (ADR-0015, decision 22): the mailbox names a batch and what it has in
	// the bucket, the objects go, and only then the rows of exactly that batch.
	const batch = await c.var.mailboxStub.batchToEmpty(place, before);
	await deleteObjects(c.env.BUCKET, batch.keys);
	const emptied = await c.var.mailboxStub.emptyBatch(place, before, batch.ids);
	return c.json({ deleted: emptied.deleted, more: emptied.more, before });
});
