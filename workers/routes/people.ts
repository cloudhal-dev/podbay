// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Invitations, the people on the instance, and the members of a mailbox.
 *
 * An invitation is the only way a second account comes to exist. The person who creates it gets
 * a link to pass on; Podbay does not need to be able to send mail for that. Accepting creates
 * the account on the server with the invited address.
 */
import { Hono } from "hono";
import { z } from "zod";
import { errorFields, log } from "../../shared/log";
import { isMailboxRole } from "../auth/authorize";
import { AuthNotConfigured, authFor } from "../auth/instance";
import type { ApiContext } from "../auth/middleware";
import { MIN_PASSWORD_LENGTH } from "../auth/options";
import {
	acceptInvitation,
	createInvitation,
	emailHasAccount,
	listInvitations,
	listMembers,
	listPeople,
	pendingInvitation,
	removeMember,
	revokeInvitation,
	setMember,
} from "../auth/people";

const InviteBody = z.object({
	email: z.string().trim().toLowerCase().email().max(254),
	role: z.enum(["admin", "member"]),
});
const AcceptBody = z.object({
	name: z.string().trim().min(1).max(120),
	password: z.string().min(MIN_PASSWORD_LENGTH).max(256),
});
const MemberBody = z.object({ role: z.string() });

/** The same answer for a token that is unknown, used, revoked or expired. */
const NO_INVITATION = { error: "This invitation is not valid any more" } as const;

export const people = new Hono<ApiContext>();

people.get("/api/v1/users", async (c) => c.json(await listPeople(c.env.DB)));

people.get("/api/v1/invitations", async (c) => c.json(await listInvitations(c.env.DB)));

people.post("/api/v1/invitations", async (c) => {
	const parsed = InviteBody.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: "Invalid request" }, 400);
	// Only an owner may invite another administrator.
	if (parsed.data.role === "admin" && c.var.instanceRole !== "owner") {
		return c.json({ error: "Only an owner can invite an administrator" }, 403);
	}
	if (await emailHasAccount(c.env.DB, parsed.data.email)) {
		return c.json({ error: "That address already has an account" }, 409);
	}
	const created = await createInvitation(c.env.DB, {
		email: parsed.data.email,
		role: parsed.data.role,
		createdBy: c.var.user.id,
	});
	// The token leaves the Worker once, here, and is not stored.
	return c.json(
		{
			id: created.id,
			email: parsed.data.email,
			role: parsed.data.role,
			expiresAt: created.expiresAt,
			link: `${new URL(c.req.url).origin}/accept/${created.token}`,
		},
		201,
	);
});

people.delete("/api/v1/invitations/:invitationId", async (c) => {
	const revoked = await revokeInvitation(c.env.DB, c.req.param("invitationId"), c.var.user.id);
	return revoked ? c.body(null, 204) : c.json({ error: "Not found" }, 404);
});

/** What the accept screen shows: the invited address, or that the link is no good. */
people.get("/api/invitations/:token", async (c) => {
	const invitation = await pendingInvitation(c.env.DB, c.req.param("token"));
	return invitation ? c.json({ email: invitation.email }) : c.json(NO_INVITATION, 404);
});

people.post("/api/invitations/:token/accept", async (c) => {
	const parsed = AcceptBody.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request", fields: parsed.error.issues.map((i) => i.path[0]) },
			400,
		);
	}
	const invitation = await pendingInvitation(c.env.DB, c.req.param("token"));
	if (invitation === null) return c.json(NO_INVITATION, 404);

	let userId: string;
	try {
		const created = await authFor(c.env, c.req.raw).api.signUpEmail({
			body: { name: parsed.data.name, email: invitation.email, password: parsed.data.password },
		});
		userId = created.user.id;
	} catch (error) {
		if (error instanceof AuthNotConfigured) {
			return c.json({ error: "Sign-in is not configured on this instance" }, 503);
		}
		log.error("invitation.accept_failed", errorFields(error));
		return c.json({ error: "The account could not be created" }, 400);
	}
	if (!(await acceptInvitation(c.env.DB, invitation.id, userId, invitation.role))) {
		// The invitation was used or revoked in the meantime. The account has no role and is useless.
		return c.json(NO_INVITATION, 404);
	}
	return c.json({ ok: true, email: invitation.email }, 201);
});

// -- Members of one mailbox ------------------------------------------

people.get("/api/v1/mailboxes/:mailboxId/members", async (c) =>
	c.json(await listMembers(c.env.DB, c.var.mailbox.id)),
);

people.put("/api/v1/mailboxes/:mailboxId/members/:userId", async (c) => {
	const parsed = MemberBody.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success || !isMailboxRole(parsed.data.role)) {
		return c.json({ error: "Invalid request" }, 400);
	}
	const result = await setMember(c.env.DB, {
		mailboxId: c.var.mailbox.id,
		address: c.var.mailbox.address,
		userId: c.req.param("userId"),
		role: parsed.data.role,
		actorUserId: c.var.user.id,
	});
	if (result === "no_such_user") return c.json({ error: "No such person on this instance" }, 400);
	if (result === "last_owner") return c.json({ error: "A mailbox must keep an owner" }, 409);
	return c.json(await listMembers(c.env.DB, c.var.mailbox.id));
});

people.delete("/api/v1/mailboxes/:mailboxId/members/:userId", async (c) => {
	const result = await removeMember(c.env.DB, {
		mailboxId: c.var.mailbox.id,
		address: c.var.mailbox.address,
		userId: c.req.param("userId"),
		actorUserId: c.var.user.id,
	});
	if (result === "last_owner") return c.json({ error: "A mailbox must keep an owner" }, 409);
	return c.body(null, 204);
});
