// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * A message between the press and the handover (ADR-0016, decisions 10 to 13).
 *
 * - `POST …/emails/:id/unsend` takes a waiting message back: it is a draft again, in Drafts,
 *   with the same id and the same files. On a message that failed it takes the mark off.
 *   When the message was handed to the sending service already, the answer is 409
 *   `SEND_STARTED`: it has gone, or is going.
 * - `POST …/emails/:id/reschedule` gives a waiting message a new time: `{ send_at }`, or
 *   nothing for "now". Whoever does it becomes the person whose right is asked when the
 *   message leaves.
 * - Neither route takes the automatic reply the mailbox made by itself (ADR-0008): it is
 *   nobody's draft and nobody's to send, and both answer 404 for it.
 *
 * The guard has already checked the right (`mailbox.send` for both) and picked the mailbox,
 * so an id here only ever looks a row up in the database of the mailbox in the address.
 * Neither route calls the sending service, and no tool of the assistant or MCP reaches them.
 */
import { Hono } from "hono";
import { SEND_CODES, whenToLeave } from "../../shared/sending";
import type { ApiContext } from "../auth/middleware";
import { RescheduleRequestSchema } from "../lib/schemas";

const M = "/api/v1/mailboxes/:mailboxId";

const STARTED = {
	error: "This message has been handed over for sending. It cannot be taken back.",
	code: SEND_CODES.started,
} as const;
const NOT_WAITING = { error: "No such waiting message.", code: "NOT_FOUND" } as const;

export const sending = new Hono<ApiContext>();

sending.post(`${M}/emails/:id/unsend`, async (c) => {
	const id = c.req.param("id");
	const back = await c.var.mailboxStub.unsend(id);
	if (back === "started") return c.json(STARTED, 409);
	if (back === "not_found") return c.json(NOT_WAITING, 404);
	return c.json({ id, status: "draft" });
});

sending.post(`${M}/emails/:id/reschedule`, async (c) => {
	const body = RescheduleRequestSchema.safeParse(await c.req.json().catch(() => ({})));
	if (!body.success) return c.json({ error: "Invalid request.", code: "INVALID" }, 400);
	const now = Date.now();
	let at = now;
	if (body.data.send_at !== undefined) {
		const leaves = whenToLeave({ send_at: body.data.send_at }, now);
		if ("refused" in leaves) {
			return leaves.refused === "too_far"
				? c.json(
						{
							error: "A message can be sent later by a year at most.",
							code: SEND_CODES.tooFar,
						},
						400,
					)
				: c.json({ error: "The time to send at is in the past.", code: "INVALID" }, 400);
		}
		// A new time is the time itself: a message sent later has no window on top.
		at = Date.parse(body.data.send_at);
	}
	const id = c.req.param("id");
	const given = await c.var.mailboxStub.reschedule(id, at, c.var.user.id);
	if (given === "started") return c.json(STARTED, 409);
	if (given === "not_found") return c.json(NOT_WAITING, 404);
	return c.json({ id, status: "waiting", send_at: given.send_at });
});
