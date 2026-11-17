// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Better Auth configuration. Better Auth answers one question only: who is this? What that
 * person may do is decided by Podbay's own code (workers/auth/authorize.ts).
 *
 * This module has no Cloudflare import, so `scripts/auth-ddl.ts` can load it in Node to generate
 * the tables. Changing anything here that affects the schema needs a new migration: run
 * `node scripts/auth-ddl.ts --check`.
 */
import { passkey } from "@better-auth/passkey";
import type { BetterAuthOptions } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { twoFactor } from "better-auth/plugins";
import {
	FRESH_AUTH_PATHS,
	FRESH_SECONDS,
	isFresh,
	NOT_FRESH,
	NOT_FRESH_CODE,
	REFUSED_AUTH_PATHS,
	SECOND_STEP_VERIFY_PATHS,
} from "./fresh.ts";

export interface AuthConfig {
	/** A D1 database in the Worker; an in-memory SQLite database when generating the tables. */
	readonly database: unknown;
	/** The origin the app is served from, for example `https://mail.example.org`. */
	readonly baseURL: string;
	/** Signs session cookies. At least 32 characters; a Worker secret, never a variable. */
	readonly secret: string;
}

export const AUTH_BASE_PATH = "/api/auth";
export const MIN_PASSWORD_LENGTH = 12;
export const MIN_SECRET_LENGTH = 32;
export const PRODUCT_NAME = "Podbay";

type HookContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

/** The rules Podbay adds in front of Better Auth's own endpoints. */
async function beforeAuthEndpoint(ctx: HookContext): Promise<void> {
	// Accounts are created by invitation and by the guarded first-owner call, both of which
	// create the account on the server. A sign-up request over HTTP is refused.
	if (ctx.path.startsWith("/sign-up") && ctx.request) {
		throw new APIError("FORBIDDEN", { message: "Accounts are created by invitation." });
	}
	if (!ctx.request) return;

	if (REFUSED_AUTH_PATHS.has(ctx.path)) {
		throw new APIError("NOT_FOUND", { message: "Codes by mail or text message are not used." });
	}
	const body = (ctx.body ?? {}) as Record<string, unknown>;
	if (ctx.path === "/two-factor/enable" && body.method !== undefined && body.method !== "totp") {
		throw new APIError("BAD_REQUEST", { message: "Only an authenticator app can be enabled." });
	}
	// No trusted devices: every sign-in of a person with a second step passes that step. This is
	// what lets a fresh session count as fresh proof.
	if (
		SECOND_STEP_VERIFY_PATHS.has(ctx.path) &&
		body.trustDevice !== undefined &&
		body.trustDevice !== false
	) {
		throw new APIError("BAD_REQUEST", { message: "Trusted devices are not supported." });
	}
	if (FRESH_AUTH_PATHS.has(ctx.path)) {
		// Read from the database, not from the cookie: a session revoked a moment ago proves nothing.
		const session = await getSessionFromCtx(ctx, { disableCookieCache: true });
		if (session === null) throw new APIError("UNAUTHORIZED", { message: "Unauthorized" });
		if (!isFresh(session.session.createdAt)) {
			throw new APIError("FORBIDDEN", { message: NOT_FRESH.error, code: NOT_FRESH_CODE });
		}
	}
}

/**
 * Signing in again replaces the session. The session the browser held before is deleted, so
 * confirming who you are never leaves a second, older session behind.
 */
async function afterAuthEndpoint(ctx: HookContext): Promise<void> {
	const created = ctx.context.newSession;
	if (!created || !ctx.request) return;
	const previous = await ctx.getSignedCookie(
		ctx.context.authCookies.sessionToken.name,
		ctx.context.secret,
	);
	if (previous && previous !== created.session.token) {
		await ctx.context.internalAdapter.deleteSession(previous);
	}
}

export function authOptions(config: AuthConfig): BetterAuthOptions {
	const site = new URL(config.baseURL);
	return {
		database: config.database as BetterAuthOptions["database"],
		baseURL: config.baseURL,
		basePath: AUTH_BASE_PATH,
		secret: config.secret,
		telemetry: { enabled: false },
		emailAndPassword: {
			enabled: true,
			minPasswordLength: MIN_PASSWORD_LENGTH,
			maxPasswordLength: 256,
			// Signing in is its own step, so creating an account never hands out a session.
			autoSignIn: false,
		},
		session: {
			expiresIn: 60 * 60 * 24 * 7,
			updateAge: 60 * 60 * 24,
			// Better Auth's own "fresh session" endpoints (registering a passkey among them) use the
			// same window as Podbay's sensitive routes.
			freshAge: FRESH_SECONDS,
			// The session is read on every API request. Signed into a cookie for a minute, it costs
			// no database round trip; a revoked session stops working within that minute.
			cookieCache: { enabled: true, maxAge: 60 },
		},
		advanced: {
			cookiePrefix: "podbay",
			// Cloudflare sets this header itself on every request, so a client cannot choose the
			// bucket its sign-in attempts are counted in.
			ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
		},
		plugins: [
			// The second step: an authenticator app, with recovery codes. Secrets and codes are
			// stored encrypted with the instance secret.
			twoFactor({ issuer: PRODUCT_NAME }),
			// A passkey is bound to this hostname and must verify the person (a PIN or biometrics),
			// so it is a complete sign-in by itself.
			passkey({
				rpID: site.hostname,
				rpName: PRODUCT_NAME,
				origin: site.origin,
				authenticatorSelection: { residentKey: "required", userVerification: "required" },
			}),
		],
		// Counted in the database, so the limit holds across isolates.
		rateLimit: {
			enabled: true,
			storage: "database",
			window: 60,
			max: 120,
			customRules: {
				"/sign-in/email": { window: 60, max: 10 },
				"/sign-up/email": { window: 60, max: 5 },
				"/passkey/verify-authentication": { window: 60, max: 10 },
			},
		},
		hooks: {
			before: createAuthMiddleware(beforeAuthEndpoint),
			after: createAuthMiddleware(afterAuthEndpoint),
		},
	};
}
