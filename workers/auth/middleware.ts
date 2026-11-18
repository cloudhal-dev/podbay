// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * The guard in front of every API route (rules S1, S2 and S11).
 *
 * 1. The route must be in the route table, or it is refused.
 * 2. A request that changes state must come from the app's own origin.
 * 3. Unless the route is public, there must be a session.
 * 4. A mailbox route resolves the mailbox through the index, with the caller's membership. A
 *    caller who is not a member gets 404, whatever their instance role.
 * 5. A route marked `fresh` needs a session that signed in a few minutes ago, read from the
 *    database and not from the cookie. It is checked last, so it never tells a caller anything
 *    about a route they may not use.
 * 6. A route marked `upgrade` opens a WebSocket (ADR-0013). Before a session is looked for,
 *    the request must be an upgrade (426) and name the app's own origin (403); then its
 *    session is read from the database, as for a route marked `fresh`.
 * 7. A route marked `sensitive` decides for itself whether a request needs fresh proof, so its
 *    session is read from the database too: the flag `fresh` it is given is never the cookie's.
 */
import { createMiddleware } from "hono/factory";
import { errorFields, log } from "../../shared/log";
import type { MailboxDO } from "../durableObject";
import { mailboxAddressFor } from "../lib/inbound";
import type { Env } from "../types";
import {
	type Action,
	type Actor,
	authorize,
	type Decision,
	type InstanceRole,
	type MailboxRole,
} from "./authorize";
import { isFresh, NOT_FRESH } from "./fresh";
import { AuthNotConfigured, authFor } from "./instance";
import { entryFor, rightFor } from "./route-table";
import {
	instanceRoleOf,
	type MailboxAccess,
	type MailboxRow,
	mailboxAccess,
	mailboxFor,
} from "./store";

export interface SessionUser {
	readonly id: string;
	readonly name: string;
	readonly email: string;
}

export type ApiContext = {
	Bindings: Env;
	Variables: {
		user: SessionUser;
		instanceRole: InstanceRole;
		/**
		 * Whether the session signed in recently enough for a sensitive change. For a route that is
		 * sensitive only for some requests, marked `sensitive` in the table so that this is read from
		 * the database; routes marked `fresh` never run without it.
		 */
		fresh: boolean;
		/**
		 * Set on mailbox routes: the mailbox from the index. On the member routes the caller may be
		 * someone who manages the instance and has no membership, so this carries no role.
		 */
		mailboxRow: MailboxRow;
		/** The caller's membership, or null (member routes only; every other route has one). */
		mailboxRole: MailboxRole | null;
		/** Set on mailbox routes when the caller is a member: the mailbox with their role. */
		mailbox: MailboxAccess;
		/** The mailbox's storage. Set only when the caller is a member (rule S2). */
		mailboxStub: DurableObjectStub<MailboxDO>;
	};
};

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** True when a state-changing request comes from the app's own origin. */
export function sameOrigin(request: Request): boolean {
	const origin = request.headers.get("origin");
	return origin !== null && origin === new URL(request.url).origin;
}

/**
 * Why a request may not open a WebSocket, or `null` when it may go on to the session check.
 *
 * A handshake is a GET, so nothing else asks where it comes from, and a browser sends the
 * session cookie with it from any page of the same site. The page must therefore be the app's
 * own: an `Origin` that is missing or is another's is refused, which also leaves a program,
 * which has none, no way in. A request that is not an upgrade has nothing to open.
 */
export function upgradeRefusal(request: Request): 426 | 403 | null {
	if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return 426;
	return sameOrigin(request) ? null : 403;
}

/** The route pattern that will handle this request, as registered (for example `/api/v1/me`). */
function matchedPattern(
	method: string,
	routes: readonly { method: string; path: string }[],
): string | undefined {
	// The handler is the last match; the entries before it are middleware.
	for (let i = routes.length - 1; i >= 0; i--) {
		const route = routes[i];
		if (route && (route.method === method || route.method === "ALL")) {
			if (rightFor(method, route.path) !== undefined) return route.path;
		}
	}
	return undefined;
}

/** The signed-in person and their instance role, or null. Never throws for a missing session. */
export async function sessionActor(
	env: Env,
	request: Request,
): Promise<{ user: SessionUser; instanceRole: InstanceRole } | null> {
	const session = await authFor(env, request).api.getSession({ headers: request.headers });
	if (session === null) return null;
	const instanceRole = await instanceRoleOf(env.DB, session.user.id);
	if (instanceRole === null) return null;
	return {
		user: { id: session.user.id, name: session.user.name, email: session.user.email },
		instanceRole,
	};
}

/**
 * The decision for a request about one mailbox that does not go through the API guard (the agent
 * connection). `unauthorized` means there is no session.
 */
export async function mailboxDecision(
	env: Env,
	request: Request,
	rawAddress: string,
	right: Action,
): Promise<Decision | "unauthorized"> {
	let actor: { user: SessionUser; instanceRole: InstanceRole } | null;
	try {
		actor = await sessionActor(env, request);
	} catch (error) {
		log.error("auth.session_failed", errorFields(error));
		return "unauthorized";
	}
	if (actor === null) return "unauthorized";
	const address = mailboxAddressFor(rawAddress);
	const access = address === null ? null : await mailboxAccess(env.DB, actor.user.id, address);
	return authorize(
		{ userId: actor.user.id, instanceRole: actor.instanceRole, mailboxRole: access?.role ?? null },
		right,
	);
}

/**
 * The value of `:name` in `pattern` for this path. The guard runs as middleware on `/api/*`,
 * where the router has not bound the parameters of the route that will handle the request.
 */
export function pathParam(pattern: string, pathname: string, name: string): string | undefined {
	const index = pattern.split("/").indexOf(`:${name}`);
	if (index === -1) return undefined;
	const segment = pathname.split("/")[index];
	if (segment === undefined) return undefined;
	try {
		return decodeURIComponent(segment);
	} catch {
		return undefined;
	}
}

export const guard = createMiddleware<ApiContext>(async (c, next) => {
	const method = c.req.method;
	const pattern = matchedPattern(method, c.req.matchedRoutes);
	const entry = pattern === undefined ? undefined : entryFor(method, pattern);
	const right = entry?.right;
	if (right === undefined) return c.json({ error: "Not found" }, 404);

	if (!SAFE_METHODS.has(method) && !pattern?.startsWith("/api/auth/") && !sameOrigin(c.req.raw)) {
		// Better Auth checks the origin of its own endpoints.
		return c.json({ error: "Cross-origin request refused" }, 403);
	}
	if (entry?.upgrade === true) {
		// Asked before a session is looked for: a foreign page learns nothing about one.
		const refused = upgradeRefusal(c.req.raw);
		if (refused === 426) {
			return c.json({ error: "This route opens a WebSocket" }, 426, { Upgrade: "websocket" });
		}
		if (refused === 403) return c.json({ error: "Cross-origin request refused" }, 403);
	}
	if (right === "public") return next();

	let session: { user: SessionUser; session: { createdAt: Date | string } } | null;
	try {
		session = await authFor(c.env, c.req.raw).api.getSession({
			headers: c.req.raw.headers,
			// A sensitive change is decided on the session in the database, never on the copy cached
			// in the cookie: a session revoked a moment ago must not pass. A connection that stays
			// open is opened on the same footing, and so is a route that decides by `fresh` itself.
			query: {
				disableCookieCache:
					entry?.fresh === true || entry?.upgrade === true || entry?.sensitive === true,
			},
		});
	} catch (error) {
		if (error instanceof AuthNotConfigured) {
			return c.json({ error: "Sign-in is not configured on this instance" }, 503);
		}
		log.error("auth.session_failed", errorFields(error));
		return c.json({ error: "Unauthorized" }, 401);
	}
	if (session === null) return c.json({ error: "Unauthorized" }, 401);

	const user = { id: session.user.id, name: session.user.name, email: session.user.email };
	// An account without an instance role was never admitted to this instance.
	const instanceRole = await instanceRoleOf(c.env.DB, user.id);
	if (instanceRole === null) return c.json({ error: "Unauthorized" }, 401);
	c.set("user", user);
	c.set("instanceRole", instanceRole);
	const fresh = isFresh(session.session.createdAt);
	c.set("fresh", fresh);

	let actor: Actor = { userId: user.id, instanceRole, mailboxRole: null };
	if (pattern?.includes(":mailboxId")) {
		// The address from the URL is only ever a lookup key in the index. The Durable Object is
		// named after the address stored there, never after the request.
		const rawMailbox = pathParam(pattern, new URL(c.req.url).pathname, "mailboxId");
		const address = rawMailbox === undefined ? null : mailboxAddressFor(rawMailbox);
		const found = address === null ? null : await mailboxFor(c.env.DB, user.id, address);
		if (found === null) return c.json({ error: "Not found" }, 404);
		actor = { ...actor, mailboxRole: found.role };
		c.set("mailboxRow", found.row);
		c.set("mailboxRole", found.role);
		// Without a membership there is no storage to reach, whatever the route.
		if (found.role !== null) {
			c.set("mailbox", { ...found.row, role: found.role });
			c.set("mailboxStub", c.env.MAILBOX.get(c.env.MAILBOX.idFromName(found.row.address)));
		}
	}

	const decision = authorize(actor, right);
	if (decision === "not_found") return c.json({ error: "Not found" }, 404);
	if (decision === "forbidden") return c.json({ error: "Forbidden" }, 403);
	if (entry?.fresh === true && !fresh) return c.json(NOT_FRESH, 403);
	return next();
});
