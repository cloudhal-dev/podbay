// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * The one place that decides what a signed-in person may do (rule S1).
 *
 * Two things are looked at together: the instance role says what a person may MANAGE, and the
 * membership of a mailbox says which mail they may READ and SEND. They are separate on purpose:
 * managing is not reading. An owner or administrator without a membership cannot open a mailbox,
 * and is told it does not exist, like anyone else.
 */

export const INSTANCE_ROLES = ["owner", "admin", "member"] as const;
export type InstanceRole = (typeof INSTANCE_ROLES)[number];

export const MAILBOX_ROLES = ["owner", "sender", "reader"] as const;
export type MailboxRole = (typeof MAILBOX_ROLES)[number];

export const ACTIONS = [
	/** Any signed-in person: their own account, the instance configuration, their mailbox list. */
	"session",
	/** Create a mailbox, and later manage accounts and invitations. */
	"instance.manage",
	/** Read messages, threads, folders, attachments and search. */
	"mailbox.read",
	/** Change the state of mail: flags, folders, drafts, moving and deleting messages. */
	"mailbox.write",
	/** Send as the mailbox: new mail, replies and forwards. */
	"mailbox.send",
	/** Change the mailbox's settings and members, or delete it. */
	"mailbox.manage",
] as const;
export type Action = (typeof ACTIONS)[number];

export interface Actor {
	readonly userId: string;
	readonly instanceRole: InstanceRole;
	/** The actor's membership of the mailbox the request is about; null when there is none. */
	readonly mailboxRole: MailboxRole | null;
}

/**
 * `not_found` is the answer for a mailbox the actor is not a member of: the existence of a
 * mailbox is not revealed. `forbidden` is for a member who lacks the right.
 */
export type Decision = "allow" | "forbidden" | "not_found";

const MAILBOX_RIGHTS: Record<MailboxRole, ReadonlySet<Action>> = {
	owner: new Set(["mailbox.read", "mailbox.write", "mailbox.send", "mailbox.manage"]),
	sender: new Set(["mailbox.read", "mailbox.write", "mailbox.send"]),
	reader: new Set(["mailbox.read"]),
};

export function authorize(actor: Actor, action: Action): Decision {
	if (action === "session") return "allow";
	if (action === "instance.manage") {
		return actor.instanceRole === "owner" || actor.instanceRole === "admin" ? "allow" : "forbidden";
	}
	if (actor.mailboxRole === null) return "not_found";
	return MAILBOX_RIGHTS[actor.mailboxRole].has(action) ? "allow" : "forbidden";
}

export function isInstanceRole(value: unknown): value is InstanceRole {
	return INSTANCE_ROLES.some((role) => role === value);
}

export function isMailboxRole(value: unknown): value is MailboxRole {
	return MAILBOX_ROLES.some((role) => role === value);
}
