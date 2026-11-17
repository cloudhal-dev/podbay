/**
 * Tier 3: how much a mailbox may send (rule S8).
 *
 * A mailbox sends at most 20 messages in an hour and 100 in a day. The window is counted in
 * time, not in calendar days: mail sent earlier the same day does not count against the hour,
 * and mail sent the day before yesterday does not count against the day.
 */
import { runInDurableObject } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Browser, createMailbox, migrate, setupOwner, testEnv } from "./helpers.ts";

const MAILBOX = "limits@example.com";
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const stub = () => testEnv.MAILBOX.get(testEnv.MAILBOX.idFromName(MAILBOX));

/** Puts `count` sent messages into the mailbox, each sent `ago` milliseconds before now. */
async function sent(count: number, ago: number): Promise<void> {
	await runInDurableObject(stub(), (_object, state) => {
		// The date is written as the Worker writes it when it sends.
		const date = new Date(Date.now() - ago).toISOString();
		for (let index = 0; index < count; index++) {
			state.storage.sql.exec(
				`INSERT INTO emails (id, folder_id, subject, sender, recipient, date) VALUES (?, 'sent', 'Sent', ?, 'to@example.net', ?)`,
				crypto.randomUUID(),
				MAILBOX,
				date,
			);
		}
	});
}

/** The mailbox object, as far as this test calls it. */
interface Limited {
	checkSendRateLimit(): Promise<string | null>;
}
const refusal = () =>
	runInDurableObject(stub(), (object) => (object as unknown as Limited).checkSendRateLimit());

beforeAll(async () => {
	await migrate();
	expect((await setupOwner()).status).toBe(201);
	const owner = new Browser();
	expect((await owner.signIn("owner@example.com")).status).toBe(200);
	expect((await createMailbox(owner.cookie, MAILBOX)).status).toBe(201);
});

beforeEach(async () => {
	await runInDurableObject(stub(), (_object, state) => {
		state.storage.sql.exec(`DELETE FROM emails WHERE folder_id = 'sent'`);
	});
});

describe("the sending limit", () => {
	it("lets a mailbox send when it has sent little", async () => {
		await sent(19, 5 * MINUTE);
		expect(await refusal()).toBeNull();
	});

	it("refuses the twenty-first message of an hour", async () => {
		await sent(20, 5 * MINUTE);
		expect(await refusal()).toMatch(/20 emails per hour/);
	});

	it("does not count what was sent more than an hour ago against the hour", async () => {
		// The dates are compared as times: a message of two hours ago is outside the hour even
		// though it was sent on the same day.
		await sent(20, 2 * HOUR);
		expect(await refusal()).toBeNull();
		await sent(20, 61 * MINUTE);
		expect(await refusal()).toBeNull();
	});

	it("refuses the hundred-and-first message of a day, and forgets the day before", async () => {
		await sent(60, 30 * HOUR);
		await sent(60, 47 * HOUR);
		expect(await refusal()).toBeNull();
		for (const hoursAgo of [3, 7, 11, 15, 19]) await sent(19, hoursAgo * HOUR);
		expect(await refusal()).toBeNull();
		await sent(5, 23 * HOUR);
		expect(await refusal()).toMatch(/100 emails per day/);
	});
});
