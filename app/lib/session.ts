// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Sign-in, sign-out, setup and the signed-in person. Plain requests to the Worker: the session
 * lives in a cookie that scripts cannot read, so there is nothing to keep in the browser.
 */
import { useQuery } from "@tanstack/react-query";
import type { ChoicesAnswer, ChoicesChange } from "shared/choices";
import { closeLive } from "~/lib/live";
import { ApiError } from "~/services/api";

export interface Me {
	user: { id: string; name: string; email: string };
	role: "owner" | "admin" | "member";
	security: { authenticatorApp: boolean; passkeys: number };
	mailboxes: { address: string; name: string; role: "owner" | "sender" | "reader" }[];
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(path, {
		...init,
		headers: { "Content-Type": "application/json", ...init?.headers },
	});
	const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
	if (!res.ok) {
		// Better Auth answers with `message`; Podbay's own routes with `error`.
		const error = typeof body.error === "string" ? body.error : body.message;
		throw new ApiError(res.status, {
			...body,
			error: typeof error === "string" ? error : undefined,
		});
	}
	return body as T;
}

export const sessionKeys = {
	me: ["session", "me"] as const,
	setup: ["session", "setup"] as const,
};

/** The signed-in person, or null when there is no session. */
export function useMe() {
	return useQuery({
		queryKey: sessionKeys.me,
		queryFn: async (): Promise<Me | null> => {
			try {
				return await call<Me>("/api/v1/me");
			} catch (error) {
				if (error instanceof ApiError && error.status === 401) return null;
				throw error;
			}
		},
		staleTime: 60_000,
		retry: false,
	});
}

export function useSetupStatus() {
	return useQuery({
		queryKey: sessionKeys.setup,
		queryFn: () => call<{ needsSetup: boolean }>("/api/setup/status"),
		staleTime: 60_000,
	});
}

/** The signed-in person's choices as their account keeps them (ADR-0012). */
export function fetchChoices(): Promise<ChoicesAnswer> {
	return call<ChoicesAnswer>("/api/v1/me/choices");
}

/** Sends the choices that changed. The answer is the whole document, as the account has it now. */
export function saveChoices(change: ChoicesChange): Promise<ChoicesAnswer> {
	return call<ChoicesAnswer>("/api/v1/me/choices", {
		method: "PUT",
		body: JSON.stringify(change),
	});
}

export function signIn(email: string, password: string): Promise<unknown> {
	return call("/api/auth/sign-in/email", {
		method: "POST",
		body: JSON.stringify({ email, password }),
	});
}

export function signOut(): Promise<unknown> {
	// Nothing goes on listening for a person who left (ADR-0013, decision 13). The server does
	// not rely on this: a connection is told nothing five minutes after it was allowed.
	closeLive();
	return call("/api/auth/sign-out", { method: "POST", body: "{}" });
}

export function createFirstOwner(input: {
	token: string;
	name: string;
	email: string;
	password: string;
}): Promise<unknown> {
	return call("/api/setup/owner", { method: "POST", body: JSON.stringify(input) });
}

export interface CreatedInvitation {
	id: string;
	email: string;
	role: "admin" | "member";
	expiresAt: string;
	/** Shown once. The token in it is not stored anywhere. */
	link: string;
}

export function invite(email: string, role: "admin" | "member"): Promise<CreatedInvitation> {
	return call("/api/v1/invitations", { method: "POST", body: JSON.stringify({ email, role }) });
}

/** The address an invitation link is for, or null when the link is not valid any more. */
export async function invitationFor(token: string): Promise<{ email: string } | null> {
	try {
		return await call<{ email: string }>(`/api/invitations/${encodeURIComponent(token)}`);
	} catch (error) {
		if (error instanceof ApiError && error.status === 404) return null;
		throw error;
	}
}

export function acceptInvitation(token: string, name: string, password: string): Promise<unknown> {
	return call(`/api/invitations/${encodeURIComponent(token)}/accept`, {
		method: "POST",
		body: JSON.stringify({ name, password }),
	});
}

export interface Person {
	id: string;
	name: string;
	email: string;
	role: "owner" | "admin" | "member";
}

/** Everyone on the instance. For owners and administrators. */
export function listPeople(): Promise<Person[]> {
	return call("/api/v1/users");
}

export interface RecoveryLink {
	email: string;
	expiresAt: string;
	/** Shown once. The token in it is not stored anywhere. */
	link: string;
}

/** A recovery link for another person, to pass on by a channel you trust. */
export function issueRecovery(userId: string): Promise<RecoveryLink> {
	return call(`/api/v1/users/${encodeURIComponent(userId)}/recovery`, {
		method: "POST",
		body: "{}",
	});
}

/** A recovery link for an owner, by the person who holds the instance's setup token. */
export function issueOwnerRecovery(token: string, email: string): Promise<RecoveryLink> {
	return call("/api/setup/recovery", { method: "POST", body: JSON.stringify({ token, email }) });
}

/** The address a recovery link is for, or null when the link is not valid any more. */
export async function recoveryFor(token: string): Promise<{ email: string } | null> {
	try {
		return await call<{ email: string }>(`/api/recovery/${encodeURIComponent(token)}`);
	} catch (error) {
		if (error instanceof ApiError && error.status === 404) return null;
		throw error;
	}
}

export function redeemRecovery(token: string, password: string): Promise<unknown> {
	return call(`/api/recovery/${encodeURIComponent(token)}`, {
		method: "POST",
		body: JSON.stringify({ password }),
	});
}
