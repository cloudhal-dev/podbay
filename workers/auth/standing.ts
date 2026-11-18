// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Whether a message a person sent may still leave in their name (ADR-0016, decision 15). The
 * rules hold at the time of leaving, not of pressing: the mailbox is asked for again, and so
 * is the right of the person who sent it, by the same `authorize` every route is decided by.
 */
import { type Action, authorize } from "./authorize";
import { instanceRoleOf, mailboxAccess, mailboxExists } from "./store";

export type Standing =
	/** The mailbox is not in the index: it is going or gone, and nothing leaves. */
	| "gone"
	/** The person no longer may send here, or their account was recovered since. */
	| "right"
	| "ok";

/** Whether a person's account was recovered at or after `since`: who asked may not be them. */
async function recoveredSince(db: D1Database, userId: string, since: string): Promise<boolean> {
	const row = await db
		.prepare(
			`select 1 as "used" from "recoveries"
			 where "user_id" = ?1 and "used_at" is not null and "used_at" >= ?2 limit 1`,
		)
		.bind(userId, since)
		.first<{ used: number }>();
	return row !== null;
}

/**
 * The right the automatic reply leaves on (ADR-0008): the one saving it needs. It is a standing
 * instruction of the person who saved it; once they may no longer change it, it stops, so an
 * owner lowered to sender does not keep answering strangers in the mailbox's name.
 */
export const AUTO_REPLY_RIGHT: Action = "mailbox.manage";

/**
 * The standing of a waiting message: of the mailbox at `address`, and of the person who asked
 * for it to be sent, at `askedAt`, who must still have `right`: sending, or for the automatic
 * reply, `AUTO_REPLY_RIGHT`.
 */
export async function standingOf(
	db: D1Database,
	address: string,
	userId: string,
	askedAt: string,
	right: Action = "mailbox.send",
): Promise<Standing> {
	if (!(await mailboxExists(db, address))) return "gone";
	const instanceRole = await instanceRoleOf(db, userId);
	if (instanceRole === null) return "right";
	const access = await mailboxAccess(db, userId, address);
	const decision = authorize({ userId, instanceRole, mailboxRole: access?.role ?? null }, right);
	if (decision !== "allow") return "right";
	return (await recoveredSince(db, userId, askedAt)) ? "right" : "ok";
}
