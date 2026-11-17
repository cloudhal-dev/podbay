// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * The addresses a mailbox has written to (ADR-0012, decisions 18 to 20).
 *
 * - `GET …/known-addresses?q=` completes what is typed: at most a handful, best first. It
 *   completes and does not list: no empty query, no paging, no total, no count and no date.
 * - `DELETE …/known-addresses/:knownId` forgets one address, from its suggestion.
 * - `DELETE …/known-addresses` forgets them all. It is the owner's, and it is on the record by
 *   the mailbox, never by an address.
 *
 * The guard has already checked the right and picked the mailbox, so a query or an id only
 * ever reaches the database of the mailbox in the address. No tool of the assistant or of MCP
 * calls any of this.
 */
import { Hono } from "hono";
import {
	isKnownId,
	KNOWN_LIMITS,
	type KnownAddressesAnswer,
	typedForCompletion,
} from "../../shared/known-addresses";
import type { ApiContext } from "../auth/middleware";
import { writeAudit } from "../auth/store";

const M = "/api/v1/mailboxes/:mailboxId";

export const knownAddresses = new Hono<ApiContext>();

knownAddresses.get(`${M}/known-addresses`, async (c) => {
	// What is typed: something, and no more than the completion takes. It is never a pattern.
	const q = c.req.query("q");
	const typed = q === undefined || q.length > KNOWN_LIMITS.typed * 8 ? null : typedForCompletion(q);
	if (typed === null) {
		return c.json(
			{
				error: `Give between 1 and ${KNOWN_LIMITS.typed} characters to complete.`,
				code: "INVALID",
			},
			400,
		);
	}
	const answer: KnownAddressesAnswer = {
		addresses: await c.var.mailboxStub.completeAddress(typed),
	};
	return c.json(answer);
});

knownAddresses.delete(`${M}/known-addresses/:knownId`, async (c) => {
	const id = c.req.param("knownId");
	if (!isKnownId(id) || !(await c.var.mailboxStub.forgetAddress(id))) {
		return c.json({ error: "Not found" }, 404);
	}
	return c.body(null, 204);
});

knownAddresses.delete(`${M}/known-addresses`, async (c) => {
	const forgotten = await c.var.mailboxStub.forgetAddresses();
	// Who, which mailbox and how many. Never an address of a correspondent.
	await writeAudit(c.env.DB, {
		actorUserId: c.var.user.id,
		action: "mailbox.known_addresses_forgotten",
		target: c.var.mailbox.address,
		detail: JSON.stringify({ forgotten }),
	});
	return c.body(null, 204);
});
