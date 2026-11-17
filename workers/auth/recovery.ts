// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Recovery links (rule S10): the way back in for a person who lost their password, their
 * authenticator app or their passkey.
 *
 * - A link is issued by someone else: an owner for anyone, an administrator for members, the
 *   operator (with the setup token) for an owner. Nobody issues one for themselves.
 * - It works once, for a day, and only its digest is stored.
 * - Using it never shows or keeps an old credential. It sets a new password and takes the
 *   account back to that password alone: every session ends, the authenticator app and the
 *   passkeys are removed and the person's keys for programs are revoked, in one batch.
 */
import { type InstanceRole, isInstanceRole } from "./authorize";
import { newInvitationToken, tokenHash } from "./people";

export const RECOVERY_TTL_HOURS = 24;

export interface Person {
	readonly id: string;
	readonly email: string;
	readonly role: InstanceRole;
}

export type IssueDecision = "ok" | "self" | "forbidden";

/** Whether `actor` may issue a recovery link for `target`. */
export function mayIssueRecovery(
	actor: { readonly id: string; readonly role: InstanceRole },
	target: Person,
): IssueDecision {
	// A link for yourself would turn a stolen session into a new password.
	if (actor.id === target.id) return "self";
	if (actor.role === "owner") return "ok";
	// An administrator cannot take over an owner's or another administrator's account.
	if (actor.role === "admin" && target.role === "member") return "ok";
	return "forbidden";
}

async function person(
	db: D1Database,
	where: `u."id" = ?1` | `u."email" = ?1`,
	value: string,
): Promise<Person | null> {
	const row = await db
		.prepare(
			`select u."id", u."email", r."role" from "user" u
			 join "instance_roles" r on r."user_id" = u."id" where ${where}`,
		)
		.bind(value)
		.first<{ id: string; email: string; role: string }>();
	if (row === null || !isInstanceRole(row.role)) return null;
	return { id: row.id, email: row.email, role: row.role };
}

/** A person admitted to the instance, by id or by address. */
export const personById = (db: D1Database, id: string) => person(db, `u."id" = ?1`, id);
export const personByEmail = (db: D1Database, email: string) => person(db, `u."email" = ?1`, email);

/**
 * Issue a recovery link for a person and return its token. Earlier unused links of that person
 * stop working. `issuedBy` is null when the operator issues it.
 */
export async function createRecovery(
	db: D1Database,
	input: { readonly userId: string; readonly issuedBy: string | null },
): Promise<{ readonly token: string; readonly expiresAt: string }> {
	const token = newInvitationToken();
	const id = `rec_${crypto.randomUUID()}`;
	const now = new Date();
	const expiresAt = new Date(now.getTime() + RECOVERY_TTL_HOURS * 3_600_000).toISOString();
	await db.batch([
		db
			.prepare(
				`update "recoveries" set "revoked_at" = ?1
				 where "user_id" = ?2 and "used_at" is null and "revoked_at" is null`,
			)
			.bind(now.toISOString(), input.userId),
		db
			.prepare(
				`insert into "recoveries" ("id", "user_id", "token_hash", "created_at", "expires_at", "issued_by")
				 values (?1, ?2, ?3, ?4, ?5, ?6)`,
			)
			.bind(id, input.userId, await tokenHash(token), now.toISOString(), expiresAt, input.issuedBy),
		db
			.prepare(
				`insert into "audit" ("id", "at", "actor_user_id", "action", "target", "detail") values (?1, ?2, ?3, 'recovery.issued', ?4, ?5)`,
			)
			.bind(
				crypto.randomUUID(),
				now.toISOString(),
				input.issuedBy,
				input.userId,
				input.issuedBy === null ? "by: operator" : "by: person",
			),
	]);
	return { token, expiresAt };
}

/** The usable recovery link a token belongs to, or null. Says nothing about why there is none. */
export async function pendingRecovery(
	db: D1Database,
	token: string,
): Promise<{ readonly id: string; readonly userId: string; readonly email: string } | null> {
	const row = await db
		.prepare(
			`select c."id", c."user_id", u."email" from "recoveries" c
			 join "user" u on u."id" = c."user_id" join "instance_roles" r on r."user_id" = u."id"
			 where c."token_hash" = ?1 and c."used_at" is null and c."revoked_at" is null and c."expires_at" > ?2`,
		)
		.bind(await tokenHash(token), new Date().toISOString())
		.first<{ id: string; user_id: string; email: string }>();
	return row === null ? null : { id: row.id, userId: row.user_id, email: row.email };
}

/**
 * Use a recovery link: one batch. The first statement only matches a link that is still usable,
 * and every later statement only runs if that one matched, so a link cannot be used twice even
 * by two requests at once. Returns whether this call used the link.
 */
export async function redeemRecovery(
	db: D1Database,
	input: { readonly id: string; readonly userId: string; readonly passwordHash: string },
): Promise<boolean> {
	const now = new Date().toISOString();
	// True only inside the batch that marked this link used at this instant.
	const used = `exists (select 1 from "recoveries" where "id" = ?1 and "used_at" = ?2)`;
	const guarded = (sql: string, ...extra: string[]) =>
		db.prepare(`${sql} and ${used}`).bind(input.id, now, input.userId, ...extra);
	const [marked, password] = await db.batch([
		db
			.prepare(
				`update "recoveries" set "used_at" = ?2
				 where "id" = ?1 and "used_at" is null and "revoked_at" is null and "expires_at" > ?2`,
			)
			.bind(input.id, now),
		guarded(
			`update "account" set "password" = ?4, "updatedAt" = ?2 where "userId" = ?3 and "providerId" = 'credential'`,
			input.passwordHash,
		),
		guarded(`delete from "session" where "userId" = ?3`),
		guarded(`delete from "twoFactor" where "userId" = ?3`),
		guarded(`delete from "passkey" where "userId" = ?3`),
		guarded(`update "user" set "twoFactorEnabled" = 0, "updatedAt" = ?2 where "id" = ?3`),
		guarded(
			`update "api_keys" set "revoked_at" = ?2 where "user_id" = ?3 and "revoked_at" is null`,
		),
		db
			.prepare(
				`insert into "audit" ("id", "at", "actor_user_id", "action", "target")
				 select ?4, ?2, ?3, 'recovery.used', ?3 where ${used}`,
			)
			.bind(input.id, now, input.userId, crypto.randomUUID()),
	]);
	return (marked?.meta.changes ?? 0) === 1 && (password?.meta.changes ?? 0) === 1;
}
