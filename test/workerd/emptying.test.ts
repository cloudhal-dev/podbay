/**
 * Tier 3: emptying Trash and Spam (ADR-0009, rule S13).
 *
 * - only Trash and Spam can be emptied, by someone who may change mail; a reader is refused
 *   and someone without a membership is told nothing;
 * - a place is emptied in batches, and each answer says how many went and whether more remain;
 * - what goes is what was there when it was asked: mail stored afterwards stays;
 * - afterwards nothing of it is left: no message, no label row, no attachment row, no object.
 */
import { env, runInDurableObject } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { EMPTY_BATCH } from "../../modules/mail/worker/durableObject/emptying.ts";
import {
	Browser,
	createMailbox,
	json,
	migrate,
	seedMembership,
	seedUser,
	setupOwner,
	testEnv,
} from "./helpers.ts";

const MAILBOX = "bin@example.com";
const M = `/api/v1/mailboxes/${encodeURIComponent(MAILBOX)}`;
const bucket = (env as unknown as { BUCKET: R2Bucket }).BUCKET;

interface Answer {
	deleted: number;
	more: boolean;
	before: string;
}

const browsers: Record<string, Browser> = {};
const as = (who: string) => browsers[who] as Browser;
const empty = (who: string, place: string, body: Record<string, unknown> = {}) =>
	as(who).post(`${M}/folders/${place}/empty`, body);

function inMailbox<T>(run: (sql: SqlStorage) => T) {
	const stub = testEnv.MAILBOX.get(testEnv.MAILBOX.idFromName(MAILBOX));
	return runInDurableObject(stub, (_object, state) => run(state.storage.sql));
}

/** Puts `count` messages into a place, each with a label row and a file in the bucket. */
async function fill(place: string, count: number, minutesAgo: number, tag: string) {
	const date = new Date(Date.now() - minutesAgo * 60_000).toISOString();
	const ids = Array.from({ length: count }, (_value, n) => `${tag}-${n}`);
	await inMailbox((sql) => {
		sql.exec(
			`INSERT OR IGNORE INTO labels (id, name, color, created_at) VALUES ('lbl_000000000000000000000001', 'Kept', 0, ?)`,
			date,
		);
		for (const id of ids) {
			sql.exec(
				`INSERT INTO emails (id, folder_id, subject, sender, recipient, date, body) VALUES (?, ?, ?, 'ada@sender.test', ?, ?, 'x')`,
				id,
				place,
				`Subject ${id}`,
				MAILBOX,
				date,
			);
			sql.exec(
				`INSERT INTO email_labels (email_id, label_id) VALUES (?, 'lbl_000000000000000000000001')`,
				id,
			);
			sql.exec(
				`INSERT INTO attachments (id, email_id, filename, mimetype, size) VALUES (?, ?, 'a.txt', 'text/plain', 1)`,
				`att-${id}`,
				id,
			);
		}
	});
	for (const id of ids) await bucket.put(`attachments/${id}/att-${id}/a.txt`, "x");
	return ids;
}

const count = (table: string, where = "1 = 1") =>
	inMailbox((sql) =>
		Number([...sql.exec(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`)][0]?.n),
	);
const objects = async () => (await bucket.list({ prefix: "attachments/" })).objects.length;

beforeAll(async () => {
	await migrate();
	expect((await setupOwner()).status).toBe(201);
	browsers.owner = new Browser();
	expect((await as("owner").signIn("owner@example.com")).status).toBe(200);
	expect((await createMailbox(as("owner").cookie, MAILBOX)).status).toBe(201);
	const reader = await seedUser("reader@example.com", "member");
	await seedUser("outsider@example.com", "member");
	await seedMembership(MAILBOX, reader, "reader");
	for (const who of ["reader", "outsider"]) {
		browsers[who] = new Browser();
		expect((await as(who).signIn(`${who}@example.com`)).status).toBe(200);
	}
});

describe("emptying a place", () => {
	it("is for Trash and Spam only, and for someone who may change mail", async () => {
		await fill("inbox", 3, 60, "kept");
		await fill("trash", 2, 60, "guarded");

		for (const place of ["inbox", "sent", "draft", "archive", "nowhere"]) {
			const refused = await empty("owner", place);
			expect(refused.status, place).toBe(400);
			expect((await json<{ code: string }>(refused)).code, place).toBe("NOT_EMPTIABLE");
		}
		expect((await empty("reader", "trash")).status).toBe(403);
		expect((await empty("outsider", "trash")).status).toBe(404);
		expect((await empty("owner", "trash", { before: "yesterday" })).status).toBe(400);

		expect(await count("emails", "folder_id = 'inbox'")).toBe(3);
		expect(await count("emails", "folder_id = 'trash'")).toBe(2);
		expect(await objects()).toBe(5);
		expect((await json<Answer>(await empty("owner", "trash"))).deleted).toBe(2);
	});

	it("goes in batches, says what it did, and leaves what arrived after it was asked", async () => {
		const total = EMPTY_BATCH * 2 + 7;
		await fill("spam", total, 30, "unwanted");
		await fill("trash", 4, 30, "other-place");

		const first = await json<Answer>(await empty("owner", "spam"));
		expect(first).toMatchObject({ deleted: EMPTY_BATCH, more: true });
		expect(Date.parse(first.before)).toBeLessThanOrEqual(Date.now());

		// Mail that reaches Spam while it is being emptied stays.
		const late = await fill("spam", 2, -1, "arrived-later");

		let deleted = first.deleted;
		let answer = first;
		for (let calls = 0; answer.more && calls < 10; calls++) {
			answer = await json<Answer>(await empty("owner", "spam", { before: first.before }));
			expect(answer.before).toBe(first.before);
			deleted += answer.deleted;
		}
		expect(answer.more).toBe(false);
		expect(deleted).toBe(total);

		// Nothing of what was there is left, in the rows or in the bucket (S13).
		const left = await inMailbox((sql) =>
			[...sql.exec(`SELECT id FROM emails WHERE folder_id = 'spam' ORDER BY id`)].map(
				(row) => row.id,
			),
		);
		expect(left).toEqual([...late].sort());
		expect(await count("email_labels", "email_id LIKE 'unwanted-%'")).toBe(0);
		expect(await count("attachments", "email_id LIKE 'unwanted-%'")).toBe(0);
		const kept = (await bucket.list({ prefix: "attachments/" })).objects.map(
			(object) => object.key,
		);
		expect(kept.filter((key) => key.includes("unwanted-"))).toEqual([]);
		// The other place, the inbox and the label itself are untouched.
		expect(await count("emails", "folder_id = 'trash'")).toBe(4);
		expect(await count("emails", "folder_id = 'inbox'")).toBe(3);
		expect(await count("labels")).toBe(1);
		expect(kept.filter((key) => key.includes("other-place-"))).toHaveLength(4);

		// Asked again, with nothing left from then: nothing happens.
		expect(
			await json<Answer>(await empty("owner", "spam", { before: first.before })),
		).toMatchObject({
			deleted: 0,
			more: false,
		});
	});

	it("does not take a moment that has not come", async () => {
		const tomorrow = new Date(Date.now() + 24 * 3_600_000).toISOString();
		const answer = await json<Answer>(await empty("owner", "trash", { before: tomorrow }));
		expect(Date.parse(answer.before)).toBeLessThanOrEqual(Date.now());
		expect(answer.deleted).toBe(4);
	});
});
