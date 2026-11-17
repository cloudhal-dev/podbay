// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Sign-in, sign-out, setup and the signed-in person. Plain requests to the Worker: the session
 * lives in a cookie that scripts cannot read, so there is nothing to keep in the browser.
 */
import { useQuery } from "@tanstack/react-query";
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

export function signIn(email: string, password: string): Promise<unknown> {
	return call("/api/auth/sign-in/email", {
		method: "POST",
		body: JSON.stringify({ email, password }),
	});
}

export function signOut(): Promise<unknown> {
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
