// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { errorFields, log } from "@podbay/platform/log";
/**
 * Recovery links: issued by an owner or an administrator for another person, or by the operator
 * for an owner; used by the person who lost access. The link is shown once to whoever issued it,
 * to pass on by a channel they trust; Podbay does not have to be able to send mail for this.
 */
import { Hono } from "hono";
import { z } from "zod";
import { AuthNotConfigured, authFor } from "../auth/instance";
import type { ApiContext } from "../auth/middleware";
import { MIN_PASSWORD_LENGTH } from "../auth/options";
import {
	createRecovery,
	mayIssueRecovery,
	pendingRecovery,
	personByEmail,
	personById,
	redeemRecovery,
} from "../auth/recovery";
import { sameSecret, secret } from "../lib/secrets";

const UseBody = z.object({ password: z.string().min(MIN_PASSWORD_LENGTH).max(256) });
const OperatorBody = z.object({
	token: z.string().min(1).max(512),
	email: z.string().trim().toLowerCase().email().max(254),
});

/** The same answer for a token that is unknown, used, replaced or expired. */
const NO_RECOVERY = { error: "This recovery link is not valid any more" } as const;

export const recovery = new Hono<ApiContext>();

function linkFor(requestUrl: string, token: string): string {
	return `${new URL(requestUrl).origin}/recover/${token}`;
}

recovery.post("/api/v1/users/:userId/recovery", async (c) => {
	const target = await personById(c.env.DB, c.req.param("userId"));
	if (target === null) return c.json({ error: "Not found" }, 404);
	const decision = mayIssueRecovery({ id: c.var.user.id, role: c.var.instanceRole }, target);
	if (decision === "self") {
		return c.json(
			{ error: "You cannot issue a recovery link for yourself. Ask another owner." },
			403,
		);
	}
	if (decision !== "ok") {
		return c.json({ error: "Only an owner can recover an owner or an administrator" }, 403);
	}
	const created = await createRecovery(c.env.DB, { userId: target.id, issuedBy: c.var.user.id });
	// The token leaves the Worker once, here, and is not stored.
	return c.json(
		{ email: target.email, expiresAt: created.expiresAt, link: linkFor(c.req.url, created.token) },
		201,
	);
});

/**
 * The operator path: a recovery link for an owner, for the person who controls the deployment
 * and so can set the setup token. It is how the last owner gets back in.
 */
recovery.post("/api/setup/recovery", async (c) => {
	const expected = secret(c.env, "SETUP_TOKEN") ?? "";
	if (expected.length < 24) {
		return c.json(
			{ error: "Recovery by the operator is not enabled: SETUP_TOKEN is not set" },
			503,
		);
	}
	const parsed = OperatorBody.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: "Invalid request" }, 400);
	if (!(await sameSecret(parsed.data.token, expected))) {
		return c.json({ error: "Invalid setup token" }, 403);
	}
	const target = await personByEmail(c.env.DB, parsed.data.email);
	// Owners only: everyone else is recovered by an owner or an administrator, in the app.
	if (target === null || target.role !== "owner") {
		return c.json({ error: "No owner has that address" }, 404);
	}
	const created = await createRecovery(c.env.DB, { userId: target.id, issuedBy: null });
	log.info("recovery.issued_by_operator", {});
	return c.json(
		{ email: target.email, expiresAt: created.expiresAt, link: linkFor(c.req.url, created.token) },
		201,
	);
});

/** What the recovery screen shows: whose account the link is for, or that it is no good. */
recovery.get("/api/recovery/:token", async (c) => {
	const pending = await pendingRecovery(c.env.DB, c.req.param("token"));
	return pending ? c.json({ email: pending.email }) : c.json(NO_RECOVERY, 404);
});

recovery.post("/api/recovery/:token", async (c) => {
	const parsed = UseBody.safeParse(await c.req.json().catch(() => null));
	// A password that is too short does not use the link up.
	if (!parsed.success) return c.json({ error: "Invalid request", fields: ["password"] }, 400);
	const pending = await pendingRecovery(c.env.DB, c.req.param("token"));
	if (pending === null) return c.json(NO_RECOVERY, 404);

	let passwordHash: string;
	try {
		const context = await authFor(c.env, c.req.raw).$context;
		passwordHash = await context.password.hash(parsed.data.password);
	} catch (error) {
		if (error instanceof AuthNotConfigured) {
			return c.json({ error: "Sign-in is not configured on this instance" }, 503);
		}
		log.error("recovery.hash_failed", errorFields(error));
		return c.json({ error: "The password could not be set" }, 500);
	}
	const used = await redeemRecovery(c.env.DB, {
		id: pending.id,
		userId: pending.userId,
		passwordHash,
	});
	if (!used) return c.json(NO_RECOVERY, 404);
	return c.json({ ok: true, email: pending.email });
});
