// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * An authenticator code is used once (issue #12). Better Auth accepts a code for the step it
 * belongs to and the steps on either side of it, about ninety seconds, and remembers nothing:
 * someone who sees a code being typed could use it again in that time.
 *
 * Before a code reaches Better Auth it is claimed for the person it is typed for, by writing a
 * row of Better Auth's own `verification` table whose primary key is made from that person and
 * that code. The key is unique, so of two requests with the same code only one row is written,
 * whichever isolate each runs in; the other is answered as a wrong code is, and Better Auth
 * never sees it. A row is kept for longer than a code is accepted and is then replaced.
 *
 * A code is claimed whether it turns out right or wrong: a wrong one is no loss, and a right
 * one refused for another reason (a locked account) waits for the next step. Nothing of the
 * code is stored: the key is an HMAC under the instance secret.
 *
 * This module imports nothing of Cloudflare's; workers/auth/options.ts does.
 */
import { APIError, type createAuthMiddleware, getSessionFromCtx } from "better-auth/api";

type HookContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

/** The endpoint that takes a code from the authenticator app, to sign in or to turn it on. */
export const CODE_PATH = "/two-factor/verify-totp";

/** How long a code stays used. Longer than the ~90 seconds in which Better Auth accepts it. */
export const USED_CODE_SECONDS = 120;

/** The prefix of the rows this module writes; nothing else in the table starts with it. */
export const USED_CODE_PREFIX = "podbay-used-code-";

/** Better Auth's own name of the cookie that holds a sign-in between its two steps. */
const SIGN_IN_COOKIE = "two_factor";

/** What Better Auth answers for a wrong code. A used code is answered the same way. */
const WRONG_CODE = { message: "Invalid code", code: "INVALID_CODE" } as const;

async function keyOf(secret: string, userId: string, code: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${userId}\n${code}`));
	const hex = [...new Uint8Array(mac)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
	return `${USED_CODE_PREFIX}${hex}`;
}

/**
 * The person a code is typed for: the signed-in person while the app is turned on, or the one
 * whose password step the sign-in cookie names. Null when neither is there; Better Auth then
 * refuses the request by itself.
 */
async function personOf(ctx: HookContext): Promise<string | null> {
	const session = await getSessionFromCtx(ctx, { disableCookieCache: true }).catch(() => null);
	if (session) return session.user.id;
	const cookie = ctx.context.createAuthCookie(SIGN_IN_COOKIE).name;
	const pending = await ctx.getSignedCookie(cookie, ctx.context.secret);
	if (!pending) return null;
	const row = await ctx.context.internalAdapter.findVerificationValue(pending);
	return row?.value ?? null;
}

/**
 * Claims the code of this request for its person, or refuses it as a wrong code when it was
 * claimed already. A request without a code, or without a person, is left to Better Auth.
 */
export async function claimCode(ctx: HookContext): Promise<void> {
	const code = (ctx.body as { code?: unknown } | undefined)?.code;
	if (typeof code !== "string" || code === "") return;
	const userId = await personOf(ctx);
	if (userId === null) return;

	const id = await keyOf(ctx.context.secret, userId, code);
	const now = new Date();
	// A claim that has run out is replaced: the same six digits come round again some day.
	await ctx.context.adapter.deleteMany({
		model: "verification",
		where: [
			{ field: "id", value: id },
			{ field: "expiresAt", operator: "lt", value: now },
		],
	});
	try {
		await ctx.context.adapter.create({
			model: "verification",
			data: {
				id,
				identifier: id,
				value: userId,
				expiresAt: new Date(now.getTime() + USED_CODE_SECONDS * 1000),
				createdAt: now,
				updatedAt: now,
			},
			forceAllowId: true,
		});
	} catch {
		// The row is there: this code was used. Anything else that stops the write also
		// refuses the code, which is the safe side.
		throw new APIError("UNAUTHORIZED", WRONG_CODE);
	}
}
