// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/** Sign-in, the guarded first-owner call, health, and the signed-in person's own view. */
import { Hono } from "hono";
import { z } from "zod";
import { errorFields, log } from "../../shared/log";
import { AuthNotConfigured, authFor } from "../auth/instance";
import type { ApiContext } from "../auth/middleware";
import { MIN_PASSWORD_LENGTH } from "../auth/options";
import { claimFirstOwner, mailboxesOf, ownerExists } from "../auth/store";
import { secret } from "../lib/secrets";

const OwnerBody = z.object({
	token: z.string().min(1).max(512),
	name: z.string().trim().min(1).max(120),
	email: z.string().trim().toLowerCase().email().max(254),
	password: z.string().min(MIN_PASSWORD_LENGTH).max(256),
});

/** Compare two secrets without leaking where they differ: both are hashed, then compared in full. */
async function sameSecret(given: string, expected: string): Promise<boolean> {
	const encoder = new TextEncoder();
	const [a, b] = await Promise.all([
		crypto.subtle.digest("SHA-256", encoder.encode(given)),
		crypto.subtle.digest("SHA-256", encoder.encode(expected)),
	]);
	const left = new Uint8Array(a);
	const right = new Uint8Array(b);
	let difference = 0;
	for (let i = 0; i < left.length; i++) difference |= (left[i] ?? 0) ^ (right[i] ?? 0);
	return difference === 0;
}

export const account = new Hono<ApiContext>();

account.get("/api/health", (c) => c.json({ ok: true }));

account.all("/api/auth/*", async (c) => {
	try {
		return await authFor(c.env, c.req.raw).handler(c.req.raw);
	} catch (error) {
		if (error instanceof AuthNotConfigured) {
			return c.json({ error: "Sign-in is not configured on this instance" }, 503);
		}
		throw error;
	}
});

/** Whether the instance still waits for its first owner. Says nothing else. */
account.get("/api/setup/status", async (c) =>
	c.json({ needsSetup: !(await ownerExists(c.env.DB)) }),
);

/**
 * Create the first owner. A new instance is closed: this call needs the setup token the deployer
 * set as a secret, and it works once. The page that calls it never trusts the first visitor.
 */
account.post("/api/setup/owner", async (c) => {
	const expected = secret(c.env, "SETUP_TOKEN") ?? "";
	if (expected.length < 24) {
		return c.json({ error: "Setup is not enabled: SETUP_TOKEN is not set" }, 503);
	}
	const parsed = OwnerBody.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request", fields: parsed.error.issues.map((i) => i.path[0]) },
			400,
		);
	}
	if (!(await sameSecret(parsed.data.token, expected))) {
		return c.json({ error: "Invalid setup token" }, 403);
	}
	if (await ownerExists(c.env.DB))
		return c.json({ error: "This instance already has an owner" }, 409);

	let userId: string;
	try {
		const auth = authFor(c.env, c.req.raw);
		// A server-side call: the sign-up endpoint refuses requests that arrive over HTTP.
		const created = await auth.api.signUpEmail({
			body: { name: parsed.data.name, email: parsed.data.email, password: parsed.data.password },
		});
		userId = created.user.id;
	} catch (error) {
		if (error instanceof AuthNotConfigured) {
			return c.json({ error: "Sign-in is not configured on this instance" }, 503);
		}
		log.error("setup.owner_failed", errorFields(error));
		return c.json({ error: "The owner account could not be created" }, 400);
	}
	if (!(await claimFirstOwner(c.env.DB, userId))) {
		// Another setup call won the race. This account has no role, so it cannot sign in to anything.
		return c.json({ error: "This instance already has an owner" }, 409);
	}
	return c.json({ ok: true }, 201);
});

account.get("/api/v1/me", async (c) => {
	const mailboxes = await mailboxesOf(c.env.DB, c.var.user.id);
	return c.json({
		user: c.var.user,
		role: c.var.instanceRole,
		mailboxes: mailboxes.map((m) => ({ address: m.address, name: m.displayName, role: m.role })),
	});
});
