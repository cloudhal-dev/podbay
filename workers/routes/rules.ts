// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * The rules of a mailbox for its incoming mail (ADR-0008, decisions 7, 8 and 12).
 *
 * - `GET …/rules` answers the filters in their order and the blocked senders.
 * - `PUT …/rules` replaces the filters with the list it is given, in that order.
 * - `POST …/blocked-senders` blocks an address, or everything at a domain; `DELETE` unblocks
 *   it. The sender is named in the body, never in the address of the request.
 * - `GET …/auto-reply` answers the automatic reply; `PUT` saves it.
 *
 * Seeing them needs `mailbox.read`. Changing them needs `mailbox.manage`: in a shared mailbox
 * a rule decides where everyone's mail goes. The automatic reply makes the mailbox send, so
 * saving it also needs fresh proof (`workers/auth/route-table.ts`). Every change is on the
 * record with who, which mailbox and how many, never with a word of a rule or an address.
 *
 * The guard has already checked the right and picked the mailbox, so what a request names
 * only ever reaches the database of the mailbox in the address. A body is held to the strict
 * schema of `shared/rules-schema.ts`: nothing is stored that the one function which runs the
 * rules does not know. No tool of the assistant or of MCP calls any of this.
 */
import { Hono } from "hono";
import { type AutoReplyAnswer, RULE_CODES, RULE_LIMITS } from "../../shared/rules";
import { parseAutoReply, parseRules, parseSender } from "../../shared/rules-schema";
import type { ApiContext } from "../auth/middleware";
import { AUTO_REPLY_RIGHT, standingOf } from "../auth/standing";
import { writeAudit } from "../auth/store";
import { bodyWithin } from "../lib/body";

const M = "/api/v1/mailboxes/:mailboxId";

/** A body is read up to this size and no further. */
const MAX_BODY_BYTES = 256 * 1024;

const INVALID = { error: "Invalid request.", code: RULE_CODES.invalid } as const;
const NO_SENDER = {
	error: "Give an address, or a domain such as example.com.",
	code: RULE_CODES.invalid,
} as const;

/**
 * The JSON of a request's body, or `null` when it is too large or is not JSON. Reading stops
 * at the limit: a larger body is never read to its end.
 */
async function bodyOf(request: Request): Promise<unknown> {
	try {
		const text = await bodyWithin(request, MAX_BODY_BYTES);
		return text === null ? null : (JSON.parse(text) as unknown);
	} catch {
		return null;
	}
}

export const rules = new Hono<ApiContext>();

rules.get(`${M}/rules`, async (c) => c.json(await c.var.mailboxStub.getRules()));

rules.put(`${M}/rules`, async (c) => {
	const parsed = parseRules(await bodyOf(c.req.raw));
	if ("refused" in parsed) {
		return parsed.refused === "too_many"
			? c.json(
					{
						error: `A mailbox has at most ${RULE_LIMITS.rules} filters.`,
						code: RULE_CODES.tooMany,
					},
					409,
				)
			: c.json(INVALID, 400);
	}
	const stub = c.var.mailboxStub;
	const saved = await stub.setRules(parsed.rules, c.var.user.id);
	if (saved === "limit") return c.json(INVALID, 400);
	// Who, which mailbox and how many. Never a condition: it may hold a correspondent's address.
	await writeAudit(c.env.DB, {
		actorUserId: c.var.user.id,
		action: "mailbox.rules_changed",
		target: c.var.mailbox.address,
		detail: JSON.stringify(saved),
	});
	return c.json(await stub.getRules());
});

rules.post(`${M}/blocked-senders`, async (c) => {
	const sender = parseSender(await bodyOf(c.req.raw));
	if (sender === null) return c.json(NO_SENDER, 400);
	const made = await c.var.mailboxStub.blockSender(sender, c.var.user.id);
	if (made === "limit") {
		return c.json(
			{
				error: `A mailbox blocks at most ${RULE_LIMITS.blocked} senders.`,
				code: RULE_CODES.blockedLimit,
			},
			409,
		);
	}
	if (made.made) {
		await writeAudit(c.env.DB, {
			actorUserId: c.var.user.id,
			action: "mailbox.sender_blocked",
			target: c.var.mailbox.address,
			detail: JSON.stringify({ kind: sender.startsWith("@") ? "domain" : "address" }),
		});
	}
	return c.json(made.blocked, made.made ? 201 : 200);
});

rules.delete(`${M}/blocked-senders`, async (c) => {
	const sender = parseSender(await bodyOf(c.req.raw));
	if (sender === null) return c.json(NO_SENDER, 400);
	if (!(await c.var.mailboxStub.unblockSender(sender))) {
		return c.json({ error: "This sender is not blocked.", code: RULE_CODES.notBlocked }, 404);
	}
	await writeAudit(c.env.DB, {
		actorUserId: c.var.user.id,
		action: "mailbox.sender_unblocked",
		target: c.var.mailbox.address,
		detail: JSON.stringify({ kind: sender.startsWith("@") ? "domain" : "address" }),
	});
	return c.body(null, 204);
});

rules.get(`${M}/auto-reply`, async (c) => {
	const held = await c.var.mailboxStub.getAutoReply();
	// A reply leaves on the standing of the person who saved it. When that person may no longer
	// send here nothing is answered, and the answer says so instead of showing a reply that is
	// on and does nothing.
	const stopped =
		held.reply.isEnabled && held.by !== null && held.at !== null
			? (await standingOf(c.env.DB, c.var.mailbox.address, held.by, held.at, AUTO_REPLY_RIGHT)) !==
				"ok"
			: false;
	const answer: AutoReplyAnswer = { ...held.reply, stopped };
	return c.json(answer);
});

rules.put(`${M}/auto-reply`, async (c) => {
	const parsed = parseAutoReply(await bodyOf(c.req.raw));
	if ("refused" in parsed) {
		return parsed.refused === "empty"
			? c.json(
					{
						error: "An automatic reply that is on needs a message.",
						code: RULE_CODES.noBody,
					},
					400,
				)
			: c.json(INVALID, 400);
	}
	const { was } = await c.var.mailboxStub.setAutoReply(parsed.reply, c.var.user.id);
	// Whether it is on and between which dates. Never its words.
	await writeAudit(c.env.DB, {
		actorUserId: c.var.user.id,
		action: "mailbox.auto_reply_changed",
		target: c.var.mailbox.address,
		detail: JSON.stringify({
			was,
			enabled: parsed.reply.isEnabled,
			from: parsed.reply.fromDate,
			until: parsed.reply.toDate,
		}),
	});
	const answer: AutoReplyAnswer = { ...parsed.reply, stopped: false };
	return c.json(answer);
});
