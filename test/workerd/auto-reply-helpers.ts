// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * What the tests of the automatic reply share (ADR-0008): the reply they turn on, the routes
 * that save and read it, a delivery that lets what it causes leave, and a mailbox reset before
 * each test, with a send binding of the tests that counts every call.
 */
import { beforeAll, beforeEach, expect } from "vitest";
import type { AutoReplyAnswer } from "../../modules/mail/shared/rules.ts";
import { json, mime } from "./helpers.ts";
import {
	as,
	DESK,
	deliver,
	inMailbox,
	M,
	people,
	rows,
	signedInAgain,
	stored,
} from "./rules-helpers.ts";
import { type FakeSender, fakeSender, letLeave } from "./sending-helpers.ts";

export const DAY = 24 * 60 * 60_000;
export const REPLY = {
	isEnabled: true,
	fromDate: null,
	toDate: null,
	subject: "Away until Monday",
	textBody: "I am away and will answer when I am back.",
	htmlBody: null,
};

/** The send binding of the tests, made once for the file. */
export const sender: { fake: FakeSender } = { fake: undefined as unknown as FakeSender };

export const save = (reply: unknown, who = "owner") =>
	as(who).fetch(`${M}/auto-reply`, { method: "PUT", body: JSON.stringify(reply) });
export const read = async (who = "owner") =>
	json<AutoReplyAnswer>(await as(who).fetch(`${M}/auto-reply`));

/** Turns the reply on as the owner does, with a session that is fresh. */
export async function on(reply: unknown = REPLY): Promise<void> {
	await signedInAgain("owner");
	expect((await save(reply)).status).toBe(200);
}

/** Delivers a message addressed to the mailbox; `from` is the envelope sender. */
export async function arrives(
	subject: string,
	headers: Record<string, string> = {},
	from = "ada@sender.test",
) {
	const result = await deliver(
		mime({ From: "Ada <ada@sender.test>", To: DESK, Subject: subject, ...headers }),
		{ from },
	);
	expect(result, `delivering "${subject}"`).toEqual({ rejections: [], threw: null });
	await letLeave(DESK);
	return stored(subject);
}

/** Everyone the send binding was asked to send to since the last reset. */
export const answered = () => sender.fake.calls.flatMap((call) => call.to ?? []);
export const waiting = () => rows(`SELECT 1 FROM emails WHERE folder_id IN ('scheduled', 'draft')`);
/** What the mailbox holds of its own replies, in whatever place a reply can be. */
export const kept = () =>
	rows(`SELECT 1 FROM emails WHERE folder_id IN ('scheduled', 'draft', 'sent')`);

/** The mailbox and its people once for the file, and a mailbox without replies before each test. */
export function aMailboxThatAnswers(): void {
	beforeAll(async () => {
		await people([]);
		sender.fake = await fakeSender(DESK);
	});
	beforeEach(async () => {
		await inMailbox((sql) => {
			sql.exec(`DELETE FROM auto_reply_log`);
			sql.exec(`DELETE FROM send_log`);
			sql.exec(`DELETE FROM submissions`);
			sql.exec(`DELETE FROM emails WHERE folder_id IN ('sent', 'scheduled', 'draft')`);
			sql.exec(`DELETE FROM rules WHERE kind IN ('block', 'filter', 'auto_reply_stopped')`);
			sql.exec(`DELETE FROM known_addresses`);
		});
		const fake = sender.fake;
		fake.calls.length = 0;
		fake.next = [];
		fake.otherwise = { messageId: "<taken@service.test>" };
	});
}
