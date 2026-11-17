// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Keys for programs. A key is a bearer credential for the MCP endpoint. It belongs to one
 * person and is narrower than that person: only the mailboxes chosen when it was made, and
 * either reading or also organising and drafting. Every use is checked against the person's
 * membership at that moment, so a key never outlives the access it was made from. No key can
 * send mail.
 */
import { isMailboxRole, type MailboxRole } from "./authorize";
import { tokenHash } from "./people";

export const KEY_PREFIX = "pbk_";
export const MAX_KEYS_PER_PERSON = 20;
export const KEY_ACCESS = ["read", "write"] as const;
export type KeyAccess = (typeof KEY_ACCESS)[number];
/** What a tool needs: to read mail, or to change it (flags, folders, drafts). */
export type KeyNeed = "read" | "write";

export interface KeyView {
	readonly id: string;
	readonly name: string;
	readonly hint: string;
	readonly access: KeyAccess;
	readonly mailboxes: string[];
	readonly createdAt: string;
	readonly expiresAt: string | null;
	readonly lastUsedAt: string | null;
	readonly state: "active" | "revoked" | "expired";
}

export interface KeyCaller {
	readonly keyId: string;
	readonly userId: string;
	readonly access: KeyAccess;
}

function base64url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function newKeyToken(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return `${KEY_PREFIX}${base64url(bytes)}`;
}

/**
 * Whether a key may do what a tool needs in a mailbox, given the membership its owner has now.
 * A read-only key never changes anything; a key of a reader never changes anything either.
 */
export function keyAllows(access: KeyAccess, membership: MailboxRole, need: KeyNeed): boolean {
	if (need === "read") return true;
	return access === "write" && (membership === "owner" || membership === "sender");
}

export type CreateKeyResult =
	| { readonly ok: true; readonly id: string; readonly token: string }
	| { readonly ok: false; readonly reason: "too_many" | "not_a_member" };

/** Create a key for mailboxes its owner is a member of. Returns the token once. */
export async function createKey(
	db: D1Database,
	input: {
		readonly userId: string;
		readonly name: string;
		readonly access: KeyAccess;
		readonly mailboxIds: readonly string[];
		readonly expiresAt: string | null;
	},
): Promise<CreateKeyResult> {
	const count = await db
		.prepare(`select count(*) as "n" from "api_keys" where "user_id" = ?1 and "revoked_at" is null`)
		.bind(input.userId)
		.first<{ n: number }>();
	if ((count?.n ?? 0) >= MAX_KEYS_PER_PERSON) return { ok: false, reason: "too_many" };

	const id = `key_${crypto.randomUUID()}`;
	const token = newKeyToken();
	const now = new Date().toISOString();
	const statements = [
		db
			.prepare(
				`insert into "api_keys" ("id", "user_id", "name", "token_hash", "hint", "access", "created_at", "expires_at")
				 values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
			)
			.bind(
				id,
				input.userId,
				input.name,
				await tokenHash(token),
				token.slice(-4),
				input.access,
				now,
				input.expiresAt,
			),
		// A mailbox is attached only if its owner is a member of it right now.
		...input.mailboxIds.map((mailboxId) =>
			db
				.prepare(
					`insert into "api_key_mailboxes" ("key_id", "mailbox_id")
					 select ?1, ?2 where exists (select 1 from "memberships" where "mailbox_id" = ?2 and "user_id" = ?3)`,
				)
				.bind(id, mailboxId, input.userId),
		),
		db
			.prepare(
				`insert into "audit" ("id", "at", "actor_user_id", "action", "target", "detail") values (?1, ?2, ?3, 'key.created', ?4, ?5)`,
			)
			.bind(
				crypto.randomUUID(),
				now,
				input.userId,
				id,
				`access: ${input.access}, mailboxes: ${input.mailboxIds.length}`,
			),
	];
	const results = await db.batch(statements);
	const attached = results
		.slice(1, 1 + input.mailboxIds.length)
		.filter((r) => r.meta.changes === 1).length;
	if (attached !== input.mailboxIds.length) {
		await db.prepare(`delete from "api_keys" where "id" = ?1`).bind(id).run();
		return { ok: false, reason: "not_a_member" };
	}
	return { ok: true, id, token };
}

interface RawKey {
	id: string;
	name: string;
	hint: string;
	access: string;
	created_at: string;
	expires_at: string | null;
	revoked_at: string | null;
	last_used_at: string | null;
}

export async function listKeys(db: D1Database, userId: string): Promise<KeyView[]> {
	const now = new Date().toISOString();
	const keys = await db
		.prepare(
			`select "id", "name", "hint", "access", "created_at", "expires_at", "revoked_at", "last_used_at"
			 from "api_keys" where "user_id" = ?1 order by "created_at" desc`,
		)
		.bind(userId)
		.all<RawKey>();
	const scopes = await db
		.prepare(
			`select k."key_id", m."address" from "api_key_mailboxes" k
			 join "api_keys" a on a."id" = k."key_id" join "mailboxes" m on m."id" = k."mailbox_id"
			 where a."user_id" = ?1 order by m."address"`,
		)
		.bind(userId)
		.all<{ key_id: string; address: string }>();
	return keys.results.map((raw) => ({
		id: raw.id,
		name: raw.name,
		hint: raw.hint,
		access: raw.access === "write" ? "write" : "read",
		mailboxes: scopes.results.filter((s) => s.key_id === raw.id).map((s) => s.address),
		createdAt: raw.created_at,
		expiresAt: raw.expires_at,
		lastUsedAt: raw.last_used_at,
		state:
			raw.revoked_at !== null
				? "revoked"
				: raw.expires_at !== null && raw.expires_at <= now
					? "expired"
					: "active",
	}));
}

/** Revoke one of the person's own keys. Returns false when there is no such active key. */
export async function revokeKey(db: D1Database, userId: string, keyId: string): Promise<boolean> {
	const now = new Date().toISOString();
	const [updated] = await db.batch([
		db
			.prepare(
				`update "api_keys" set "revoked_at" = ?1 where "id" = ?2 and "user_id" = ?3 and "revoked_at" is null`,
			)
			.bind(now, keyId, userId),
	]);
	if ((updated?.meta.changes ?? 0) !== 1) return false;
	await db
		.prepare(
			`insert into "audit" ("id", "at", "actor_user_id", "action", "target") values (?1, ?2, ?3, 'key.revoked', ?4)`,
		)
		.bind(crypto.randomUUID(), now, userId, keyId)
		.run();
	return true;
}

/**
 * The caller a bearer token stands for, or null. A token is good only while its key is neither
 * revoked nor expired and its owner is still admitted to the instance.
 */
export async function callerForToken(db: D1Database, token: string): Promise<KeyCaller | null> {
	if (!token.startsWith(KEY_PREFIX) || token.length > 128) return null;
	const now = new Date().toISOString();
	const row = await db
		.prepare(
			`select k."id", k."user_id", k."access" from "api_keys" k
			 join "instance_roles" r on r."user_id" = k."user_id"
			 where k."token_hash" = ?1 and k."revoked_at" is null and (k."expires_at" is null or k."expires_at" > ?2)`,
		)
		.bind(await tokenHash(token), now)
		.first<{ id: string; user_id: string; access: string }>();
	if (row === null) return null;
	return { keyId: row.id, userId: row.user_id, access: row.access === "write" ? "write" : "read" };
}

/** Record that a key was used. Written at most once a minute, so a busy client costs no writes. */
export async function touchKey(db: D1Database, keyId: string): Promise<void> {
	const now = Date.now();
	await db
		.prepare(
			`update "api_keys" set "last_used_at" = ?1
			 where "id" = ?2 and ("last_used_at" is null or "last_used_at" < ?3)`,
		)
		.bind(new Date(now).toISOString(), keyId, new Date(now - 60_000).toISOString())
		.run();
}

export interface KeyMailbox {
	readonly address: string;
	readonly membership: MailboxRole;
}

/**
 * The mailboxes a key reaches now: in its scope AND its owner is still a member. Read from the
 * index on every use, so removing a membership or the key's scope takes effect at once.
 */
export async function keyMailboxes(db: D1Database, caller: KeyCaller): Promise<KeyMailbox[]> {
	const result = await db
		.prepare(
			`select m."address", s."role" from "api_key_mailboxes" k
			 join "api_keys" a on a."id" = k."key_id" and a."revoked_at" is null
			 join "mailboxes" m on m."id" = k."mailbox_id"
			 join "memberships" s on s."mailbox_id" = k."mailbox_id" and s."user_id" = ?2
			 where k."key_id" = ?1 order by m."address"`,
		)
		.bind(caller.keyId, caller.userId)
		.all<{ address: string; role: string }>();
	const out: KeyMailbox[] = [];
	for (const row of result.results) {
		if (isMailboxRole(row.role)) out.push({ address: row.address, membership: row.role });
	}
	return out;
}
