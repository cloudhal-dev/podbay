// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import type { Context } from "hono";
/**
 * Labels of a mailbox (ADR-0007). A message is in one place and carries any number of labels.
 *
 * The guard has already checked the right in the route table and picked the mailbox, so a label
 * id only ever reaches the database of the mailbox in the address: a label of another mailbox
 * does not exist here.
 */
import { Hono } from "hono";
import { z } from "zod";
import type { ApiContext } from "../../../../workers/auth/middleware";
import { cleanLabelName, isLabelId, labelColor } from "../../shared/labels";
import { WAITS } from "../lib/outgoing";

const M = "/api/v1/mailboxes/:mailboxId";

const LabelBody = z.object({ name: z.string().max(512), color: z.number().optional() });
const ChangeBody = z.object({ name: z.string().max(512).optional(), color: z.number().optional() });
const labelIds = z.array(z.string().max(64)).max(50).default([]);
const ApplyBody = z.object({ add: labelIds, remove: labelIds });

const BAD_NAME = { error: "A label needs a name of at most 64 characters.", code: "LABEL_NAME" };
const REFUSALS = {
	exists: [{ error: "A label with this name already exists.", code: "LABEL_EXISTS" }, 409],
	limit: [
		{ error: "This mailbox or message has as many labels as it can hold.", code: "LABEL_LIMIT" },
		409,
	],
	not_found: [{ error: "No such label or message.", code: "NOT_FOUND" }, 404],
} as const;

function refuse(c: Context<ApiContext>, why: keyof typeof REFUSALS) {
	const [body, status] = REFUSALS[why];
	return c.json(body, status);
}

export const labels = new Hono<ApiContext>();

labels.get(`${M}/labels`, async (c) => c.json(await c.var.mailboxStub.getLabels()));

labels.post(`${M}/labels`, async (c) => {
	const body = LabelBody.safeParse(await c.req.json().catch(() => null));
	const name = body.success ? cleanLabelName(body.data.name) : null;
	if (!body.success || name === null) return c.json(BAD_NAME, 400);
	const made = await c.var.mailboxStub.createLabel(name, labelColor(body.data.color));
	return typeof made === "string" ? refuse(c, made) : c.json(made, 201);
});

labels.put(`${M}/labels/:labelId`, async (c) => {
	const id = c.req.param("labelId");
	const body = ChangeBody.safeParse(await c.req.json().catch(() => null));
	if (!isLabelId(id)) return refuse(c, "not_found");
	if (!body.success) return c.json(BAD_NAME, 400);
	const change: { name?: string; color?: number } = {};
	if (body.data.name !== undefined) {
		const name = cleanLabelName(body.data.name);
		if (name === null) return c.json(BAD_NAME, 400);
		change.name = name;
	}
	if (body.data.color !== undefined) change.color = labelColor(body.data.color);
	const changed = await c.var.mailboxStub.updateLabel(id, change);
	return typeof changed === "string" ? refuse(c, changed) : c.json(changed);
});

/** Deleting a label takes it off its messages. No message is deleted or moved. */
labels.delete(`${M}/labels/:labelId`, async (c) => {
	const id = c.req.param("labelId");
	const gone = isLabelId(id) && (await c.var.mailboxStub.deleteLabel(id));
	return gone ? c.body(null, 204) : refuse(c, "not_found");
});

/** Give labels to, and take labels from, the conversation this message belongs to. */
labels.put(`${M}/emails/:emailId/labels`, async (c) => {
	const body = ApplyBody.safeParse(await c.req.json().catch(() => null));
	if (!body.success) return c.json({ error: "Invalid request.", code: "INVALID" }, 400);
	const { add, remove } = body.data;
	if (![...add, ...remove].every(isLabelId)) return refuse(c, "not_found");
	const done = await c.var.mailboxStub.labelConversation(c.req.param("emailId"), add, remove);
	if (done === "scheduled") return c.json(WAITS, 409);
	return typeof done === "string" ? refuse(c, done) : c.json(done);
});
