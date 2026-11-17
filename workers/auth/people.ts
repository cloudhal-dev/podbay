// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/** Invitations and memberships in D1. Same rules as store.ts: bound values, batches, no transactions. */
import { type InstanceRole, isInstanceRole, isMailboxRole, type MailboxRole } from "./authorize";

export const INVITATION_TTL_DAYS = 7;
export type InvitedRole = "admin" | "member";

export interface InvitationView {
	readonly id: string;
	readonly email: string;
	readonly role: InvitedRole;
	readonly expiresAt: string;
	readonly createdAt: string;
	readonly state: "pending" | "accepted" | "revoked" | "expired";
}

interface RawInvitation {
	id: string;
	email: string;
	role: string;
	expires_at: string;
	created_at: string;
	accepted_at: string | null;
	revoked_at: string | null;
}

function base64url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A fresh invitation token: 256 random bits. Shown once, never stored. */
export function newInvitationToken(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return base64url(bytes);
}

export async function tokenHash(token: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
	return base64url(new Uint8Array(digest));
}

function stateOf(raw: RawInvitation, now: string): InvitationView["state"] {
	if (raw.accepted_at !== null) return "accepted";
	if (raw.revoked_at !== null) return "revoked";
	return raw.expires_at <= now ? "expired" : "pending";
}

function toView(raw: RawInvitation, now: string): InvitationView {
	return {
		id: raw.id,
		email: raw.email,
		role: raw.role === "admin" ? "admin" : "member",
		expiresAt: raw.expires_at,
		createdAt: raw.created_at,
		state: stateOf(raw, now),
	};
}

const INVITATION_COLUMNS = `"id", "email", "role", "expires_at", "created_at", "accepted_at", "revoked_at"`;

export async function emailHasAccount(db: D1Database, email: string): Promise<boolean> {
	const row = await db
		.prepare(`select 1 as "present" from "user" where "email" = ?1`)
		.bind(email)
		.first<{ present: number }>();
	return row !== null;
}

/** Create an invitation and return its token. An earlier pending invitation for the address is revoked. */
export async function createInvitation(
	db: D1Database,
	input: { readonly email: string; readonly role: InvitedRole; readonly createdBy: string },
): Promise<{ readonly id: string; readonly token: string; readonly expiresAt: string }> {
	const token = newInvitationToken();
	const id = `inv_${crypto.randomUUID()}`;
	const now = new Date();
	const expiresAt = new Date(now.getTime() + INVITATION_TTL_DAYS * 86_400_000).toISOString();
	await db.batch([
		db
			.prepare(
				`update "invitations" set "revoked_at" = ?1
				 where "email" = ?2 and "accepted_at" is null and "revoked_at" is null`,
			)
			.bind(now.toISOString(), input.email),
		db
			.prepare(
				`insert into "invitations" ("id", "email", "role", "token_hash", "expires_at", "created_at", "created_by")
				 values (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
			)
			.bind(
				id,
				input.email,
				input.role,
				await tokenHash(token),
				expiresAt,
				now.toISOString(),
				input.createdBy,
			),
		db
			.prepare(
				`insert into "audit" ("id", "at", "actor_user_id", "action", "target", "detail") values (?1, ?2, ?3, 'invitation.created', ?4, ?5)`,
			)
			.bind(crypto.randomUUID(), now.toISOString(), input.createdBy, id, `role: ${input.role}`),
	]);
	return { id, token, expiresAt };
}

export async function listInvitations(db: D1Database): Promise<InvitationView[]> {
	const now = new Date().toISOString();
	const result = await db
		.prepare(`select ${INVITATION_COLUMNS} from "invitations" order by "created_at" desc limit 200`)
		.all<RawInvitation>();
	return result.results.map((raw) => toView(raw, now));
}

/** Revoke a pending invitation. Returns false when there is nothing pending with that id. */
export async function revokeInvitation(
	db: D1Database,
	id: string,
	actorUserId: string,
): Promise<boolean> {
	const now = new Date().toISOString();
	const [updated] = await db.batch([
		db
			.prepare(
				`update "invitations" set "revoked_at" = ?1 where "id" = ?2 and "accepted_at" is null and "revoked_at" is null`,
			)
			.bind(now, id),
	]);
	if ((updated?.meta.changes ?? 0) !== 1) return false;
	await db
		.prepare(
			`insert into "audit" ("id", "at", "actor_user_id", "action", "target") values (?1, ?2, ?3, 'invitation.revoked', ?4)`,
		)
		.bind(crypto.randomUUID(), now, actorUserId, id)
		.run();
	return true;
}

/** The pending invitation a token belongs to, or null. Says nothing about why there is none. */
export async function pendingInvitation(
	db: D1Database,
	token: string,
): Promise<{ readonly id: string; readonly email: string; readonly role: InvitedRole } | null> {
	const raw = await db
		.prepare(`select ${INVITATION_COLUMNS} from "invitations" where "token_hash" = ?1`)
		.bind(await tokenHash(token))
		.first<RawInvitation>();
	if (raw === null) return null;
	const view = toView(raw, new Date().toISOString());
	return view.state === "pending" ? { id: view.id, email: view.email, role: view.role } : null;
}

/**
 * Mark an invitation accepted and admit the account, in one batch. The update only matches a
 * pending invitation, and the role is inserted only if that update matched, so a token cannot be
 * used twice even by two requests at once. Returns whether this call admitted the account.
 */
export async function acceptInvitation(
	db: D1Database,
	invitationId: string,
	userId: string,
	role: InvitedRole,
): Promise<boolean> {
	const now = new Date().toISOString();
	const [updated] = await db.batch([
		db
			.prepare(
				`update "invitations" set "accepted_at" = ?1, "accepted_user_id" = ?2
				 where "id" = ?3 and "accepted_at" is null and "revoked_at" is null and "expires_at" > ?1`,
			)
			.bind(now, userId, invitationId),
		db
			.prepare(
				`insert into "instance_roles" ("user_id", "role", "created_at")
				 select ?1, ?2, ?3 where exists (select 1 from "invitations" where "id" = ?4 and "accepted_user_id" = ?1)`,
			)
			.bind(userId, role, now, invitationId),
		db
			.prepare(
				`insert into "audit" ("id", "at", "actor_user_id", "action", "target")
				 select ?1, ?2, ?3, 'invitation.accepted', ?4 where exists (select 1 from "invitations" where "id" = ?4 and "accepted_user_id" = ?3)`,
			)
			.bind(crypto.randomUUID(), now, userId, invitationId),
	]);
	return (updated?.meta.changes ?? 0) === 1;
}

export interface PersonView {
	readonly id: string;
	readonly name: string;
	readonly email: string;
	readonly role: InstanceRole;
}

/** Everyone admitted to the instance. For owners and administrators: names and roles, no mail. */
export async function listPeople(db: D1Database): Promise<PersonView[]> {
	const result = await db
		.prepare(
			`select u."id", u."name", u."email", r."role" from "user" u
			 join "instance_roles" r on r."user_id" = u."id" order by u."email" limit 500`,
		)
		.all<{ id: string; name: string; email: string; role: string }>();
	const out: PersonView[] = [];
	for (const row of result.results) {
		if (isInstanceRole(row.role))
			out.push({ id: row.id, name: row.name, email: row.email, role: row.role });
	}
	return out;
}

export interface MemberView {
	readonly userId: string;
	readonly name: string;
	readonly email: string;
	readonly role: MailboxRole;
}

export async function listMembers(db: D1Database, mailboxId: string): Promise<MemberView[]> {
	const result = await db
		.prepare(
			`select u."id", u."name", u."email", s."role" from "memberships" s
			 join "user" u on u."id" = s."user_id" where s."mailbox_id" = ?1 order by u."email"`,
		)
		.bind(mailboxId)
		.all<{ id: string; name: string; email: string; role: string }>();
	const out: MemberView[] = [];
	for (const row of result.results) {
		if (isMailboxRole(row.role))
			out.push({ userId: row.id, name: row.name, email: row.email, role: row.role });
	}
	return out;
}

export type MemberChange = "ok" | "no_such_user" | "last_owner";

async function ownerCount(
	db: D1Database,
	mailboxId: string,
	exceptUserId: string,
): Promise<number> {
	const row = await db
		.prepare(
			`select count(*) as "n" from "memberships" where "mailbox_id" = ?1 and "role" = 'owner' and "user_id" <> ?2`,
		)
		.bind(mailboxId, exceptUserId)
		.first<{ n: number }>();
	return row?.n ?? 0;
}

/** Give a person a membership, or change the one they have. A mailbox always keeps an owner. */
export async function setMember(
	db: D1Database,
	input: {
		readonly mailboxId: string;
		readonly address: string;
		readonly userId: string;
		readonly role: MailboxRole;
		readonly actorUserId: string;
	},
): Promise<MemberChange> {
	const admitted = await db
		.prepare(`select 1 as "present" from "instance_roles" where "user_id" = ?1`)
		.bind(input.userId)
		.first<{ present: number }>();
	if (admitted === null) return "no_such_user";
	if (input.role !== "owner" && (await ownerCount(db, input.mailboxId, input.userId)) === 0) {
		return "last_owner";
	}
	const now = new Date().toISOString();
	await db.batch([
		db
			.prepare(
				`insert into "memberships" ("mailbox_id", "user_id", "role", "created_at", "created_by")
				 values (?1, ?2, ?3, ?4, ?5)
				 on conflict ("mailbox_id", "user_id") do update set "role" = excluded."role"`,
			)
			.bind(input.mailboxId, input.userId, input.role, now, input.actorUserId),
		db
			.prepare(
				`insert into "audit" ("id", "at", "actor_user_id", "action", "target", "detail") values (?1, ?2, ?3, 'membership.set', ?4, ?5)`,
			)
			.bind(
				crypto.randomUUID(),
				now,
				input.actorUserId,
				input.address,
				`${input.userId === input.actorUserId ? "self" : "user"}: ${input.userId}, role: ${input.role}`,
			),
	]);
	return "ok";
}

export async function removeMember(
	db: D1Database,
	input: {
		readonly mailboxId: string;
		readonly address: string;
		readonly userId: string;
		readonly actorUserId: string;
	},
): Promise<MemberChange> {
	if ((await ownerCount(db, input.mailboxId, input.userId)) === 0) return "last_owner";
	const now = new Date().toISOString();
	await db.batch([
		db
			.prepare(`delete from "memberships" where "mailbox_id" = ?1 and "user_id" = ?2`)
			.bind(input.mailboxId, input.userId),
		db
			.prepare(
				`insert into "audit" ("id", "at", "actor_user_id", "action", "target", "detail") values (?1, ?2, ?3, 'membership.removed', ?4, ?5)`,
			)
			.bind(crypto.randomUUID(), now, input.actorUserId, input.address, `user: ${input.userId}`),
	]);
	return "ok";
}
