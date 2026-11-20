// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { closeLiveOf } from "@podbay/mail/worker";
import { errorFields, log } from "@podbay/platform/log";
/**
 * Invitations, the people on the instance, and the members of a mailbox.
 *
 * An invitation is the only way a second account comes to exist. The person who creates it gets
 * a link to pass on; Podbay does not need to be able to send mail for that. Accepting creates
 * the account on the server with the invited address.
 */
import { Hono } from "hono";
import { z } from "zod";
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
	type MemberActorKind,
	memberHistory,
	pendingInvitation,
	removeMember,
	revokeInvitation,
	setMember,
} from "../auth/people";
import { personByEmail } from "../auth/recovery";
import { listAllMailboxes } from "../auth/store";

const InviteBody = z.object({
	email: z.string().trim().toLowerCase().email().max(254),
	role: z.enum(["admin", "member"]),
});
const AcceptBody = z.object({
	name: z.string().trim().min(1).max(120),
	password: z.string().min(MIN_PASSWORD_LENGTH).max(256),
});
const MemberBody = z.object({ role: z.string() });
const AddMemberBody = z.object({
	email: z.string().trim().toLowerCase().email().max(254),
	role: z.string(),
});

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
//
// These routes are reached by a mailbox's owners and by whoever manages the instance, who may
// have no membership and so no way to read the mail. Every change says in which capacity it was
// made, and the history is what the mailbox's owners read afterwards.

/** In which capacity the caller changes members: as an owner of the mailbox, or not. */
function capacity(c: { var: { mailboxRole: string | null } }): MemberActorKind {
	return c.var.mailboxRole === "owner" ? "owner" : "manager";
}

people.get("/api/v1/registry/mailboxes", async (c) =>
	c.json(await listAllMailboxes(c.env.DB, c.var.user.id)),
);

people.get("/api/v1/mailboxes/:mailboxId/members", async (c) =>
	c.json(await listMembers(c.env.DB, c.var.mailboxRow.id)),
);

people.get("/api/v1/mailboxes/:mailboxId/members/history", async (c) =>
	c.json(await memberHistory(c.env.DB, c.var.mailboxRow.id)),
);

/** Add a person by their address. They must already have an account on this instance. */
people.post("/api/v1/mailboxes/:mailboxId/members", async (c) => {
	const parsed = AddMemberBody.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success || !isMailboxRole(parsed.data.role)) {
		return c.json({ error: "Invalid request" }, 400);
	}
	const person = await personByEmail(c.env.DB, parsed.data.email);
	if (person === null)
		return c.json({ error: "No person with that address on this instance" }, 400);
	const current = await listMembers(c.env.DB, c.var.mailboxRow.id);
	if (current.some((member) => member.userId === person.id)) {
		return c.json({ error: "That person is already a member" }, 409);
	}
	await setMember(c.env.DB, {
		mailboxId: c.var.mailboxRow.id,
		address: c.var.mailboxRow.address,
		userId: person.id,
		role: parsed.data.role,
		actorUserId: c.var.user.id,
		as: capacity(c),
	});
	return c.json(await listMembers(c.env.DB, c.var.mailboxRow.id), 201);
});

people.put("/api/v1/mailboxes/:mailboxId/members/:userId", async (c) => {
	const parsed = MemberBody.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success || !isMailboxRole(parsed.data.role)) {
		return c.json({ error: "Invalid request" }, 400);
	}
	const result = await setMember(c.env.DB, {
		mailboxId: c.var.mailboxRow.id,
		address: c.var.mailboxRow.address,
		userId: c.req.param("userId"),
		role: parsed.data.role,
		actorUserId: c.var.user.id,
		as: capacity(c),
	});
	if (result === "no_such_user") return c.json({ error: "No such person on this instance" }, 400);
	if (result === "last_owner") return c.json({ error: "A mailbox must keep an owner" }, 409);
	// A changed role is a changed right: the person's open app comes back through the guard.
	await closeLiveOf(c.env, c.var.mailboxRow.address, c.req.param("userId"));
	return c.json(await listMembers(c.env.DB, c.var.mailboxRow.id));
});

people.delete("/api/v1/mailboxes/:mailboxId/members/:userId", async (c) => {
	const result = await removeMember(c.env.DB, {
		mailboxId: c.var.mailboxRow.id,
		address: c.var.mailboxRow.address,
		userId: c.req.param("userId"),
		actorUserId: c.var.user.id,
		as: capacity(c),
	});
	if (result === "not_a_member") return c.json({ error: "Not found" }, 404);
	if (result === "last_owner") return c.json({ error: "A mailbox must keep an owner" }, 409);
	// The index is written; whatever the person had open on this mailbox is told nothing more.
	await closeLiveOf(c.env, c.var.mailboxRow.address, c.req.param("userId"));
	return c.body(null, 204);
});
