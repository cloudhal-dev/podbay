// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import type { Action } from "./authorize";

/**
 * Every API route and the right it needs (rule S1: deny by default).
 *
 * A route that is not in this table is refused, and a test fails when a registered route is
 * missing here or an entry here matches no route. `public` routes need no session; they are the
 * sign-in endpoints, the health and setup status, the guarded first-owner call (which checks its
 * own token) and the two invitation calls (where the token in the path is the proof).
 */
export type RouteRight = Action | "public";

export interface RouteEntry {
	readonly method: "GET" | "POST" | "PUT" | "DELETE" | "ALL";
	readonly path: string;
	readonly right: RouteRight;
}

const M = "/api/v1/mailboxes/:mailboxId";

export const ROUTE_TABLE: readonly RouteEntry[] = [
	// Sign-in (Better Auth), setup and health
	{ method: "ALL", path: "/api/auth/*", right: "public" },
	{ method: "GET", path: "/api/health", right: "public" },
	{ method: "GET", path: "/api/setup/status", right: "public" },
	{ method: "POST", path: "/api/setup/owner", right: "public" },
	// Accepting an invitation: the token in the path is the proof.
	{ method: "GET", path: "/api/invitations/:token", right: "public" },
	{ method: "POST", path: "/api/invitations/:token/accept", right: "public" },

	// The signed-in person
	{ method: "GET", path: "/api/v1/me", right: "session" },
	{ method: "GET", path: "/api/v1/config", right: "session" },
	{ method: "GET", path: "/api/v1/mailboxes", right: "session" },
	{ method: "POST", path: "/api/v1/mailboxes", right: "instance.manage" },

	// People: owners and administrators
	{ method: "GET", path: "/api/v1/users", right: "instance.manage" },
	{ method: "GET", path: "/api/v1/invitations", right: "instance.manage" },
	{ method: "POST", path: "/api/v1/invitations", right: "instance.manage" },
	{ method: "DELETE", path: "/api/v1/invitations/:invitationId", right: "instance.manage" },

	// One mailbox
	{ method: "GET", path: M, right: "mailbox.read" },
	{ method: "PUT", path: M, right: "mailbox.manage" },
	{ method: "DELETE", path: M, right: "mailbox.manage" },
	{ method: "GET", path: `${M}/members`, right: "mailbox.read" },
	{ method: "PUT", path: `${M}/members/:userId`, right: "mailbox.manage" },
	{ method: "DELETE", path: `${M}/members/:userId`, right: "mailbox.manage" },

	{ method: "GET", path: `${M}/emails`, right: "mailbox.read" },
	{ method: "POST", path: `${M}/emails`, right: "mailbox.send" },
	{ method: "POST", path: `${M}/drafts`, right: "mailbox.write" },
	{ method: "GET", path: `${M}/emails/:id`, right: "mailbox.read" },
	{ method: "PUT", path: `${M}/emails/:id`, right: "mailbox.write" },
	{ method: "DELETE", path: `${M}/emails/:id`, right: "mailbox.write" },
	{ method: "POST", path: `${M}/emails/:id/move`, right: "mailbox.write" },
	{ method: "POST", path: `${M}/emails/:id/reply`, right: "mailbox.send" },
	{ method: "POST", path: `${M}/emails/:id/forward`, right: "mailbox.send" },
	{ method: "GET", path: `${M}/emails/:emailId/attachments/:attachmentId`, right: "mailbox.read" },

	{ method: "GET", path: `${M}/threads/:threadId`, right: "mailbox.read" },
	{ method: "POST", path: `${M}/threads/:threadId/read`, right: "mailbox.write" },

	{ method: "GET", path: `${M}/folders`, right: "mailbox.read" },
	{ method: "POST", path: `${M}/folders`, right: "mailbox.write" },
	{ method: "PUT", path: `${M}/folders/:id`, right: "mailbox.write" },
	{ method: "DELETE", path: `${M}/folders/:id`, right: "mailbox.write" },

	{ method: "GET", path: `${M}/search`, right: "mailbox.read" },
];

/** The right a matched route needs, or undefined when the route is not in the table. */
export function rightFor(method: string, routePath: string): RouteRight | undefined {
	const exact = ROUTE_TABLE.find((r) => r.method === method && r.path === routePath);
	if (exact) return exact.right;
	return ROUTE_TABLE.find((r) => r.method === "ALL" && r.path === routePath)?.right;
}
