// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Fresh proof for sensitive changes (rule S10, "step-up").
 *
 * Podbay has one definition of fresh proof: the person signed in again a short while ago. A
 * session is fresh for `FRESH_SECONDS` after it was created, and signing in again, with a
 * passkey or with the password and the second step, replaces the session with a new one. There
 * is no separate, weaker proof to get wrong: what is good enough to sign in is what is asked
 * again, and nothing less.
 *
 * This module has no Cloudflare import: the Better Auth configuration loads it in Node too.
 */

import { NOT_FRESH_CODE } from "@podbay/contract/fresh-proof";

export { NOT_FRESH_CODE };

/** How long after signing in a session may make sensitive changes. */
export const FRESH_SECONDS = 600;

/** The answer of a Podbay route that needs fresh proof. Better Auth's own routes use the same code. */
export const NOT_FRESH = {
	error: "Confirm it is you to continue.",
	code: NOT_FRESH_CODE,
} as const;

export function isFresh(createdAt: Date | string | number, now: number = Date.now()): boolean {
	const created = new Date(createdAt).getTime();
	// A date that cannot be read, or one in the future, is not proof of anything.
	if (!Number.isFinite(created) || created > now + 60_000) return false;
	return now - created < FRESH_SECONDS * 1000;
}

/**
 * Better Auth endpoints that change how a person signs in and that Better Auth itself does not
 * hold to a fresh session. Registering a passkey is not here: the passkey plugin already needs
 * one, with the same `freshAge`.
 */
export const FRESH_AUTH_PATHS: ReadonlySet<string> = new Set([
	"/two-factor/enable",
	"/two-factor/disable",
	"/two-factor/generate-backup-codes",
	"/two-factor/get-totp-uri",
	"/passkey/delete-passkey",
	"/change-password",
	"/change-email",
	"/delete-user",
	"/revoke-session",
	"/revoke-sessions",
	"/revoke-other-sessions",
]);

/** Where a second step is checked during sign-in. */
export const SECOND_STEP_VERIFY_PATHS: ReadonlySet<string> = new Set([
	"/two-factor/verify-totp",
	"/two-factor/verify-backup-code",
]);

/**
 * Codes sent by mail or text message are not a second step in Podbay: a mail product cannot
 * mail a code to the mailbox the person is trying to open. These endpoints of the plugin are
 * refused, and so is enabling that method.
 */
export const REFUSED_AUTH_PATHS: ReadonlySet<string> = new Set([
	"/two-factor/send-otp",
	"/two-factor/verify-otp",
]);
