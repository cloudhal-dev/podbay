// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * The client for the sign-in endpoints that need more than one request: the passkey ceremonies
 * and the second step. It keeps no session in the browser; the session is a cookie that scripts
 * cannot read, and `useMe` asks the Worker who is signed in.
 */
import { passkeyClient } from "@better-auth/passkey/client";
import { NOT_FRESH_CODE } from "@podbay/contract/fresh-proof";
import { createAuthClient } from "better-auth/client";
import { twoFactorClient } from "better-auth/client/plugins";
import { ApiError } from "~/services/api";

export const authClient = createAuthClient({
	basePath: "/api/auth",
	plugins: [twoFactorClient(), passkeyClient()],
});

interface Answer<T> {
	data?: T | null;
	error?: { status?: number; code?: string; message?: string } | null;
}

/** The data of an answer, or an `ApiError` like the ones the app's own requests throw. */
export function unwrap<T>(answer: Answer<T>): T {
	if (answer.error) {
		throw new ApiError(answer.error.status ?? 400, {
			error: answer.error.message,
			code: answer.error.code,
		});
	}
	return answer.data as T;
}

/** True when the Worker refused a change because the person must sign in again first. */
export function needsFreshProof(error: unknown): boolean {
	return error instanceof ApiError && error.body.code === NOT_FRESH_CODE;
}

export function passkeysSupported(): boolean {
	return typeof window !== "undefined" && window.PublicKeyCredential !== undefined;
}
