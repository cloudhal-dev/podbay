// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { betterAuth } from "better-auth";
import { secret } from "../lib/secrets";
import { authOptions, MIN_SECRET_LENGTH } from "./options";

export type Auth = ReturnType<typeof betterAuth>;

export class AuthNotConfigured extends Error {
	constructor() {
		super("AUTH_SECRET is not set or is too short");
		this.name = "AuthNotConfigured";
	}
}

export interface AuthEnv {
	readonly DB: D1Database;
}

// One instance per origin for the life of the isolate. The origin comes from the request, so the
// same deployment works on any hostname the user gives it, with no configuration.
const instances = new Map<string, Auth>();

/** Better Auth for the origin of this request. Throws `AuthNotConfigured` without a real secret. */
export function authFor(env: AuthEnv, request: Request): Auth {
	const authSecret = secret(env, "AUTH_SECRET") ?? "";
	if (authSecret.length < MIN_SECRET_LENGTH) throw new AuthNotConfigured();
	const origin = new URL(request.url).origin;
	let auth = instances.get(origin);
	if (auth === undefined) {
		auth = betterAuth(authOptions({ database: env.DB, baseURL: origin, secret: authSecret }));
		instances.set(origin, auth);
	}
	return auth;
}
