// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/** A person's own keys for programs: list, create (the token is shown once), revoke. */
import { Hono } from "hono";
import { z } from "zod";
import { createKey, KEY_ACCESS, listKeys, revokeKey } from "../auth/keys";
import type { ApiContext } from "../auth/middleware";
import { mailboxesOf } from "../auth/store";
import { mailboxAddressFor } from "../lib/inbound";

const CreateBody = z.object({
	name: z.string().trim().min(1).max(80),
	access: z.enum(KEY_ACCESS),
	mailboxes: z.array(z.string().max(254)).min(1).max(50),
	expiresInDays: z.number().int().min(1).max(366).optional(),
});

export const keys = new Hono<ApiContext>();

keys.get("/api/v1/keys", async (c) => c.json(await listKeys(c.env.DB, c.var.user.id)));

keys.post("/api/v1/keys", async (c) => {
	const parsed = CreateBody.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: "Invalid request" }, 400);

	// A key is made from the caller's own memberships and can never name another mailbox.
	const mine = await mailboxesOf(c.env.DB, c.var.user.id);
	const wanted = new Set<string>();
	for (const raw of parsed.data.mailboxes) {
		const address = mailboxAddressFor(raw);
		const mailbox = address === null ? undefined : mine.find((m) => m.address === address);
		if (mailbox === undefined)
			return c.json({ error: "You are not a member of every mailbox named" }, 400);
		wanted.add(mailbox.id);
	}
	const expiresAt = parsed.data.expiresInDays
		? new Date(Date.now() + parsed.data.expiresInDays * 86_400_000).toISOString()
		: null;
	const created = await createKey(c.env.DB, {
		userId: c.var.user.id,
		name: parsed.data.name,
		access: parsed.data.access,
		mailboxIds: [...wanted],
		expiresAt,
	});
	if (!created.ok) {
		return created.reason === "too_many"
			? c.json({ error: "Too many keys. Revoke one first." }, 409)
			: c.json({ error: "You are not a member of every mailbox named" }, 400);
	}
	// The token leaves the Worker once, here.
	return c.json(
		{
			id: created.id,
			token: created.token,
			endpoint: `${new URL(c.req.url).origin}/mcp`,
		},
		201,
	);
});

keys.delete("/api/v1/keys/:keyId", async (c) => {
	const revoked = await revokeKey(c.env.DB, c.var.user.id, c.req.param("keyId"));
	return revoked ? c.body(null, 204) : c.json({ error: "Not found" }, 404);
});
