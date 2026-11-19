// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * The run's shared session (#43). The tests share one sign-in instead of signing in each time,
 * which the sign-in rate limit would refuse. A session is fresh for `FRESH_SECONDS` after it was
 * made, and a route that needs fresh proof refuses a stale one; so the shared session is made
 * again once it is older than `RENEW_AFTER_SECONDS`, and no test depends on how long the run is.
 * `test/unit/e2e-session.test.ts` holds that a test started with the oldest session still ends
 * inside the fresh window.
 */
import { readFileSync, writeFileSync } from "node:fs";

/** A shared session is made again once it is this old. */
export const RENEW_AFTER_SECONDS = 300;
/** The longest a browser test may run (`test.setTimeout`), held by the unit test. */
export const LONGEST_TEST_SECONDS = 180;

export interface SharedSession {
	cookie: string;
	/** When it was made, in milliseconds. */
	at: number;
}

/** Signs in with a password and gives the session's cookie. */
export async function signInFor(base: string, email: string, password: string): Promise<string> {
	const answer = await fetch(`${base}/api/auth/sign-in/email`, {
		method: "POST",
		headers: { "content-type": "application/json", origin: base },
		body: JSON.stringify({ email, password }),
	});
	if (answer.status !== 200) throw new Error(`e2e: signing in answered ${answer.status}`);
	return answer.headers
		.getSetCookie()
		.map((line) => line.split(";")[0])
		.join("; ");
}

export const readShared = (path: string): SharedSession =>
	JSON.parse(readFileSync(path, "utf8")) as SharedSession;

export const writeShared = (path: string, shared: SharedSession): void =>
	writeFileSync(path, JSON.stringify(shared), { mode: 0o600 });

/** The shared session, made again first when it is too old to stay fresh through a test. */
export async function freshShared(
	path: string,
	base: string,
	account: { email: string; password: string },
	now = Date.now(),
): Promise<SharedSession> {
	const shared = readShared(path);
	if (now - shared.at <= RENEW_AFTER_SECONDS * 1000) return shared;
	const renewed = { cookie: await signInFor(base, account.email, account.password), at: now };
	writeShared(path, renewed);
	return renewed;
}
