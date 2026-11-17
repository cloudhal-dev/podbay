// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Podbay's index in D1: instance roles, mailboxes, memberships and the audit log. Every query is
 * a prepared statement with bound values; writes that belong together go in one batch. D1 has no
 * interactive transactions.
 */
import { type InstanceRole, isInstanceRole, isMailboxRole, type MailboxRole } from "./authorize";

export interface MailboxRow {
	readonly id: string;
	/** Canonical, lower-case. The Durable Object of the mailbox is named after it. */
	readonly address: string;
	readonly displayName: string;
	readonly settings: Record<string, unknown>;
}

export interface MailboxAccess extends MailboxRow {
	readonly role: MailboxRole;
}

export interface AuditEntry {
	readonly actorUserId: string | null;
	readonly action: string;
	/** An opaque id or a mailbox address the instance itself owns. Never a correspondent. */
	readonly target?: string;
	readonly detail?: string;
}

interface RawMailbox {
	id: string;
	address: string;
	display_name: string;
	settings: string;
	role?: string;
}

function parseSettings(text: string): Record<string, unknown> {
	try {
		const value: unknown = JSON.parse(text);
		return value !== null && typeof value === "object" && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
}

function toRow(raw: RawMailbox): MailboxRow {
	return {
		id: raw.id,
		address: raw.address,
		displayName: raw.display_name,
		settings: parseSettings(raw.settings),
	};
}

function auditStatement(db: D1Database, entry: AuditEntry, now: string): D1PreparedStatement {
	return db
		.prepare(
			`insert into "audit" ("id", "at", "actor_user_id", "action", "target", "detail") values (?1, ?2, ?3, ?4, ?5, ?6)`,
		)
		.bind(
			crypto.randomUUID(),
			now,
			entry.actorUserId,
			entry.action,
			entry.target ?? null,
			entry.detail ?? null,
		);
}

export async function writeAudit(db: D1Database, entry: AuditEntry): Promise<void> {
	await auditStatement(db, entry, new Date().toISOString()).run();
}

export async function instanceRoleOf(db: D1Database, userId: string): Promise<InstanceRole | null> {
	const row = await db
		.prepare(`select "role" from "instance_roles" where "user_id" = ?1`)
		.bind(userId)
		.first<{ role: string }>();
	return row && isInstanceRole(row.role) ? row.role : null;
}

export async function ownerExists(db: D1Database): Promise<boolean> {
	const row = await db
		.prepare(`select 1 as "present" from "instance_roles" where "role" = 'owner' limit 1`)
		.first<{ present: number }>();
	return row !== null;
}

/**
 * Make `userId` the first owner. The insert only happens while no owner exists, so two setup
 * calls that race cannot both succeed. Returns whether this call created the owner.
 */
export async function claimFirstOwner(db: D1Database, userId: string): Promise<boolean> {
	const now = new Date().toISOString();
	const [inserted] = await db.batch([
		db
			.prepare(
				`insert into "instance_roles" ("user_id", "role", "created_at")
				 select ?1, 'owner', ?2 where not exists (select 1 from "instance_roles" where "role" = 'owner')`,
			)
			.bind(userId, now),
	]);
	const created = (inserted?.meta.changes ?? 0) === 1;
	if (created) {
		await writeAudit(db, { actorUserId: userId, action: "setup.owner_created", target: userId });
	}
	return created;
}

/** Whether any mailbox is registered for an address. Used by inbound routing only. */
export async function mailboxExists(db: D1Database, address: string): Promise<boolean> {
	const row = await db
		.prepare(`select 1 as "present" from "mailboxes" where "address" = ?1`)
		.bind(address)
		.first<{ present: number }>();
	return row !== null;
}

/**
 * The settings of the mailbox at `address`, or null. For code that already acts for a member of
 * that mailbox (the assistant); it is not an access check.
 */
export async function mailboxSettings(
	db: D1Database,
	address: string,
): Promise<Record<string, unknown> | null> {
	const row = await db
		.prepare(`select "settings" from "mailboxes" where "address" = ?1`)
		.bind(address)
		.first<{ settings: string }>();
	return row ? parseSettings(row.settings) : null;
}

/** The mailbox at `address` together with the user's membership, or null when there is none. */
export async function mailboxAccess(
	db: D1Database,
	userId: string,
	address: string,
): Promise<MailboxAccess | null> {
	const raw = await db
		.prepare(
			`select m."id", m."address", m."display_name", m."settings", s."role"
			 from "mailboxes" m join "memberships" s on s."mailbox_id" = m."id"
			 where m."address" = ?1 and s."user_id" = ?2`,
		)
		.bind(address, userId)
		.first<RawMailbox>();
	if (!raw || !isMailboxRole(raw.role)) return null;
	return { ...toRow(raw), role: raw.role };
}

/** The mailboxes the user is a member of. Nobody gets a list of all mailboxes from here. */
export async function mailboxesOf(db: D1Database, userId: string): Promise<MailboxAccess[]> {
	const result = await db
		.prepare(
			`select m."id", m."address", m."display_name", m."settings", s."role"
			 from "mailboxes" m join "memberships" s on s."mailbox_id" = m."id"
			 where s."user_id" = ?1 order by m."address"`,
		)
		.bind(userId)
		.all<RawMailbox>();
	const out: MailboxAccess[] = [];
	for (const raw of result.results) {
		if (isMailboxRole(raw.role)) out.push({ ...toRow(raw), role: raw.role });
	}
	return out;
}

export type CreateMailboxResult =
	| { readonly ok: true; readonly mailbox: MailboxRow }
	| { readonly ok: false; readonly reason: "exists" | "no_such_user" };

/**
 * Register a mailbox and its first owner in one batch. `ownerUserId` gets the membership; the
 * creator gets none unless they are that person.
 */
export async function createMailbox(
	db: D1Database,
	input: {
		readonly address: string;
		readonly displayName: string;
		readonly settings: Record<string, unknown>;
		readonly ownerUserId: string;
		readonly createdBy: string;
	},
): Promise<CreateMailboxResult> {
	if (await mailboxExists(db, input.address)) return { ok: false, reason: "exists" };
	const owner = await db
		.prepare(`select 1 as "present" from "user" where "id" = ?1`)
		.bind(input.ownerUserId)
		.first<{ present: number }>();
	if (owner === null) return { ok: false, reason: "no_such_user" };

	const id = `mbx_${crypto.randomUUID()}`;
	const now = new Date().toISOString();
	const settings = JSON.stringify(input.settings);
	try {
		await db.batch([
			db
				.prepare(
					`insert into "mailboxes" ("id", "address", "display_name", "settings", "created_at", "created_by")
					 values (?1, ?2, ?3, ?4, ?5, ?6)`,
				)
				.bind(id, input.address, input.displayName, settings, now, input.createdBy),
			db
				.prepare(
					`insert into "memberships" ("mailbox_id", "user_id", "role", "created_at", "created_by")
					 values (?1, ?2, 'owner', ?3, ?4)`,
				)
				.bind(id, input.ownerUserId, now, input.createdBy),
			auditStatement(
				db,
				{
					actorUserId: input.createdBy,
					action: "mailbox.created",
					target: input.address,
					detail: input.ownerUserId === input.createdBy ? "owner: creator" : "owner: another user",
				},
				now,
			),
		]);
	} catch (error) {
		// Two creations of the same address raced; the unique index refused the second.
		if (await mailboxExists(db, input.address)) return { ok: false, reason: "exists" };
		throw error;
	}
	return {
		ok: true,
		mailbox: {
			id,
			address: input.address,
			displayName: input.displayName,
			settings: input.settings,
		},
	};
}

export async function updateMailboxSettings(
	db: D1Database,
	mailboxId: string,
	settings: Record<string, unknown>,
	actorUserId: string,
	address: string,
): Promise<void> {
	await db.batch([
		db
			.prepare(`update "mailboxes" set "settings" = ?1, "rev" = "rev" + 1 where "id" = ?2`)
			.bind(JSON.stringify(settings), mailboxId),
		auditStatement(
			db,
			{ actorUserId, action: "mailbox.settings_updated", target: address },
			new Date().toISOString(),
		),
	]);
}

/** Remove the mailbox row; its memberships go with it (foreign key). */
export async function deleteMailbox(
	db: D1Database,
	mailboxId: string,
	actorUserId: string,
	address: string,
): Promise<void> {
	await db.batch([
		db.prepare(`delete from "mailboxes" where "id" = ?1`).bind(mailboxId),
		auditStatement(
			db,
			{ actorUserId, action: "mailbox.deleted", target: address },
			new Date().toISOString(),
		),
	]);
}
