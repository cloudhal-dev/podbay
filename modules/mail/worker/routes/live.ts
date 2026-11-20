// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { errorFields, log } from "@podbay/platform/log";
/**
 * The connection on which a mailbox tells the open app that something changed (ADR-0013).
 *
 * The guard has decided before this runs: the route is marked `upgrade` in the route table, so
 * the request is a WebSocket handshake from the app's own origin, with a session read from the
 * database and a membership that may read the mailbox. The proof is the session cookie; there
 * is never a token in the address.
 *
 * The mailbox object is told who and when by a request built here. Nothing of the browser's
 * request travels on, and the object keeps neither a session nor a role.
 */
import { Hono } from "hono";
import type { ApiContext } from "../../../../workers/auth/middleware";
import type { MailboxDO } from "../durableObject/index";
import { liveRequest } from "../durableObject/live";
import type { MailEnv as Env } from "../env";

export const live = new Hono<ApiContext>();

live.get("/api/v1/mailboxes/:mailboxId/live", (c) =>
	c.var.mailboxStub.fetch(liveRequest(c.var.user.id, Date.now())),
);

/**
 * Closes the connections of a person whose right in a mailbox ended or changed, in the request
 * that ended it and after the index is written (decision 12). The app comes back through the
 * guard and gets its new answer. The caller may manage the instance without a membership: this
 * reaches the mailbox object for the one call that reads nothing.
 *
 * It never fails the change it follows: the index is written, the guard refuses the person
 * from now on, and a connection that could not be closed here is told nothing five minutes
 * after it was allowed.
 */
export async function closeLiveOf(env: Env, address: string, person: string): Promise<void> {
	try {
		const stub: DurableObjectStub<MailboxDO> = env.MAILBOX.get(env.MAILBOX.idFromName(address));
		await stub.closeLive(person);
	} catch (error) {
		log.error("live.close_failed", errorFields(error));
	}
}

/**
 * Says to the mailbox object that the mailbox's settings were saved: they are in the index, so
 * it is the one change the object cannot see (decision 6). A failure here does not undo the
 * save; the open app then learns of it when it next reads the mailbox.
 */
export async function settingsSaved(stub: DurableObjectStub<MailboxDO>): Promise<void> {
	try {
		await stub.settingsSaved();
	} catch (error) {
		log.error("live.settings_failed", errorFields(error));
	}
}
