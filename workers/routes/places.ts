// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Emptying a place (ADR-0009). Only Trash and Spam can be emptied, so a mistaken id can never
 * empty the inbox. The guard has already checked the right (`mailbox.write`) and picked the
 * mailbox.
 */
import { Hono } from "hono";
import { z } from "zod";
import type { ApiContext } from "../auth/middleware";
import { EMPTIABLE } from "../durableObject/emptying";

const M = "/api/v1/mailboxes/:mailboxId";

/** `before` is what an earlier answer gave: the moment emptying was asked for. */
const EmptyBody = z.object({ before: z.string().datetime().optional() });

/** One call to the bucket deletes at most this many objects (docs/cloudflare/ledger.json). */
const DELETE_AT_ONCE = 1000;

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

	const batch = await c.var.mailboxStub.emptyBatch(place, before);
	// The objects of this batch are gone before the next batch is asked for.
	for (let from = 0; from < batch.keys.length; from += DELETE_AT_ONCE) {
		await c.env.BUCKET.delete(batch.keys.slice(from, from + DELETE_AT_ONCE));
	}
	return c.json({ deleted: batch.deleted, more: batch.more, before });
});
