// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * The roles and rights of the instance, which belong to no module (ADR-0018, decision 2). A
 * module's own roles and rights are its own: mail's are in `workers/auth/authorize.ts`, which
 * decides with both.
 */

export const INSTANCE_ROLES = ["owner", "admin", "member"] as const;
export type InstanceRole = (typeof INSTANCE_ROLES)[number];

export const INSTANCE_ACTIONS = [
	/** Any signed-in person: their own account, the instance configuration, their mailbox list. */
	"session",
	/** Create a mailbox, and manage accounts, invitations and recovery links. */
	"instance.manage",
] as const;
