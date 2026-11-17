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
import type { BetterAuthOptions } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";

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

export function authOptions(config: AuthConfig): BetterAuthOptions {
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
			// The session is read on every API request. Signed into a cookie for a minute, it costs
			// no database round trip; a revoked session stops working within that minute.
			cookieCache: { enabled: true, maxAge: 60 },
		},
		advanced: { cookiePrefix: "podbay" },
		// Counted in the database, so the limit holds across isolates.
		rateLimit: {
			enabled: true,
			storage: "database",
			window: 60,
			max: 120,
			customRules: {
				"/sign-in/email": { window: 60, max: 10 },
				"/sign-up/email": { window: 60, max: 5 },
			},
		},
		hooks: {
			before: createAuthMiddleware(async (ctx) => {
				// Accounts are created by invitation and by the guarded first-owner call, both of
				// which create the account on the server. A sign-up request over HTTP is refused.
				if (ctx.path.startsWith("/sign-up") && ctx.request) {
					throw new APIError("FORBIDDEN", { message: "Accounts are created by invitation." });
				}
			}),
		},
	};
}
