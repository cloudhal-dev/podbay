// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { log } from "@podbay/platform/log";
/**
 * One request acts on many conversations (ADR-0014).
 *
 * - `POST …/bulk` with `ids` acts on the ticked lines at once. With a `filter` it changes
 *   nothing: the mailbox counts and answers the count and an id for the deed.
 * - `POST …/bulk/:deedId/run` is one step of a counted deed; the app calls it while `more`.
 * - `POST …/bulk/:deedId/undo` is one step of taking a deed back, within the hour.
 *
 * The guard has already checked the right (`mailbox.write`) and picked the mailbox, so an id or
 * a label only ever reaches the database of the mailbox in the address. Nothing here deletes
 * for good, sends, or names Sent or Drafts as a target; no tool of the assistant or MCP calls
 * it (decision 22).
 */
import type { Context } from "hono";
import { Hono } from "hono";
import {
	BulkRequestSchema,
	changesSomething,
	isDeedId,
	labelsOf,
	namesSomething,
} from "../../shared/bulk";
import { isLabelId } from "../../shared/labels";
import type { ApiContext } from "../auth/middleware";
import { writeAudit } from "../auth/store";
import type { DeedNotice, DeedRefusal } from "../durableObject/deed-steps";
import { WAITS } from "../lib/outgoing";

const M = "/api/v1/mailboxes/:mailboxId";
type C = Context<ApiContext>;

const INVALID = { error: "Invalid request.", code: "INVALID" } as const;
const REFUSED = {
	not_found: [{ error: "No such deed or label.", code: "NOT_FOUND" }, 404],
	late: [
		{
			error: "This was asked more than ten minutes ago. Ask again.",
			code: "DEED_LATE",
		},
		409,
	],
	grew: [
		{
			error: "More conversations match now than when this was asked. Ask again.",
			code: "SCOPE_GREW",
		},
		409,
	],
	undone: [{ error: "This was taken back and does not run again.", code: "DEED_UNDONE" }, 409],
	expired: [{ error: "This can no longer be taken back.", code: "UNDO_EXPIRED" }, 409],
} as const;

function refuse(c: C, why: DeedRefusal) {
	const [body, status] = REFUSED[why];
	return c.json(body, status);
}

/**
 * A filter deed is on the record once when it starts and once if it is undone: who, which
 * mailbox, which change, how many. Never the words of the search (decision 23).
 */
async function recordDeed(c: C, action: string, deed: string, notice: DeedNotice) {
	await writeAudit(c.env.DB, {
		actorUserId: c.var.user.id,
		action,
		target: c.var.mailbox.address,
		detail: JSON.stringify({ deed, ...notice }),
	});
}

export const bulk = new Hono<ApiContext>();

bulk.post(`${M}/bulk`, async (c) => {
	const parsed = BulkRequestSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) {
		// Over a limit is said apart from a request that is not one: a client can send less.
		const over = parsed.error.issues.some(
			(issue) => issue.code === "too_big" || issue.code === "custom",
		);
		return c.json(
			over ? { error: "The request is over a limit.", code: "TOO_LARGE" } : INVALID,
			400,
		);
	}
	const { ids, filter, change } = parsed.data;
	if ((ids === undefined) === (filter === undefined)) return c.json(INVALID, 400);
	if (!changesSomething(change)) return c.json(INVALID, 400);
	if (filter !== undefined && !namesSomething(filter)) {
		return c.json(
			{
				error: "A filter must name something: a place, a label or a search.",
				code: "EMPTY_FILTER",
			},
			400,
		);
	}
	const { add, remove } = labelsOf(change);
	if (add.some((label) => remove.includes(label))) return c.json(INVALID, 400);
	if (![...add, ...remove].every(isLabelId)) return refuse(c, "not_found");

	const unit = parsed.data.unit ?? "conversation";
	const done = await c.var.mailboxStub.bulk({ ids, filter, unit, change });
	if (done === "not_found") return refuse(c, "not_found");
	// Mail that waits to leave is acted on by nothing but its own way out (ADR-0016).
	if (done === "scheduled") return c.json(WAITS, 409);
	log.info("bulk.begun", {
		deed: done.deed,
		counted: filter !== undefined,
		conversations: done.conversations,
		messages: done.messages,
	});
	return c.json(done);
});

bulk.post(`${M}/bulk/:deedId/run`, async (c) => {
	const deedId = c.req.param("deedId");
	if (!isDeedId(deedId)) return refuse(c, "not_found");
	const step = await c.var.mailboxStub.runDeed(deedId);
	if (typeof step === "string") return refuse(c, step);
	const { began, ...answer } = step;
	if (began) await recordDeed(c, "mailbox.bulk", deedId, began);
	log.info("bulk.step", {
		deed: deedId,
		conversations: answer.conversations,
		messages: answer.messages,
		more: answer.more,
	});
	return c.json(answer);
});

bulk.post(`${M}/bulk/:deedId/undo`, async (c) => {
	const deedId = c.req.param("deedId");
	if (!isDeedId(deedId)) return refuse(c, "not_found");
	const step = await c.var.mailboxStub.undoDeed(deedId);
	if (typeof step === "string") return refuse(c, step);
	const { began, ...answer } = step;
	if (began) await recordDeed(c, "mailbox.bulk_undone", deedId, began);
	log.info("bulk.undone", { deed: deedId, messages: answer.messages, more: answer.more });
	return c.json(answer);
});
