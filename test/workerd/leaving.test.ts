/**
 * Tier 3: the rules hold when a message leaves, not when Send is pressed (ADR-0016, decisions
 * 15 to 18; rules S8 and S13; boundaries B3, B4 and B6).
 *
 * - before the handover the mailbox asks again, in this order: is it still in the index; may
 *   the person who sent the message still send here, and is the account still theirs; is
 *   `From` still its address; does the message still fit; do the caps allow one more. A
 *   message 24 hours past its time does not leave;
 * - the caps count what left, in `send_log`: deleting or moving sent mail frees no place, a
 *   full cap holds a message and lets it go later, in the order of the times;
 * - one alarm is set to the earliest of all times, is set again after every run, catches its
 *   own errors, and is set again when the object wakes and none is set.
 */
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { SENDING } from "../../shared/sending.ts";
import { SENDS_PER_HOUR } from "../../workers/durableObject/sending.ts";
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
import {
	age,
	alarmOf,
	fakeSender,
	HOUR,
	inMailbox,
	letLeave,
	MINUTE,
	objectOf,
	placeOf,
	rowsOf,
	SECOND,
	submissionOf,
	wake,
	wakeNow,
} from "./sending-helpers.ts";

const browsers: Record<string, Browser> = {};
const as = (who: string) => browsers[who] as Browser;
const ids: Record<string, string> = {};

interface Taken {
	id: string;
	status: string;
	send_at: string;
}

const base = (address: string) => `/api/v1/mailboxes/${encodeURIComponent(address)}`;

let made = 0;
/** A mailbox of its own for a test, with a member who may send. */
async function mailbox(name: string): Promise<string> {
	made += 1;
	const address = `${name}-${made}@example.com`;
	expect((await createMailbox(as("owner").cookie, address)).status).toBe(201);
	await seedMembership(address, ids.sender ?? "", "sender");
	return address;
}

const message = (address: string, more: Record<string, unknown> = {}) => ({
	to: "to@elsewhere.test",
	from: address,
	subject: "Hello",
	html: "<p>Hello</p>",
	...more,
});
const post = (who: string, address: string, more: Record<string, unknown> = {}) =>
	as(who).post(`${base(address)}/emails`, message(address, more));
async function send(who: string, address: string, more: Record<string, unknown> = {}) {
	const res = await post(who, address, more);
	expect(res.status, "the send").toBe(202);
	return json<Taken>(res);
}
const later = (ms: number) => ({ send_at: new Date(Date.now() + ms).toISOString() });
const logged = async (address: string) => (await rowsOf(address, `SELECT at FROM send_log`)).length;
/** Puts `count` messages that left `ago` milliseconds before now into the mailbox's record. */
const left = (address: string, count: number, ago: number) =>
	inMailbox(address, (sql) => {
		for (let index = 0; index < count; index++) {
			sql.exec(
				`INSERT INTO send_log (at, kind) VALUES (?1, 'person')`,
				new Date(Date.now() - ago - index).toISOString(),
			);
		}
	});
const indexRun = (query: string, ...values: unknown[]) =>
	testEnv.DB.prepare(query)
		.bind(...values)
		.run();

beforeAll(async () => {
	await migrate();
	expect((await setupOwner()).status).toBe(201);
	ids.sender = await seedUser("sender@example.com", "member");
	for (const who of ["owner", "sender"]) {
		browsers[who] = new Browser();
		expect((await as(who).signIn(`${who}@example.com`)).status).toBe(200);
	}
});

describe("the rules hold at the time of leaving", () => {
	it("nothing leaves a mailbox that is no longer in the index", async () => {
		const address = await mailbox("gone");
		const fake = await fakeSender(address);
		const taken = await send("owner", address);
		await indexRun(`delete from "mailboxes" where "address" = ?1`, address);
		await age(address, MINUTE);
		expect(await wake(address)).toBe(true);
		expect(fake.calls).toHaveLength(0);
		// It is neither sent nor failed: the mailbox is going or gone, and is looked at later.
		expect((await submissionOf(address, taken.id))?.state).toBe("waiting");
		expect((await alarmOf(address)) ?? 0).toBeGreaterThan(Date.now() + MINUTE);
	});

	it("a message does not leave after its sender lost the right to send", async () => {
		const address = await mailbox("right");
		const fake = await fakeSender(address);
		// A membership removed, and a role lowered to reader.
		const removed = await send("sender", address);
		await indexRun(
			`delete from "memberships" where "user_id" = ?1 and "mailbox_id" in (select "id" from "mailboxes" where "address" = ?2)`,
			ids.sender,
			address,
		);
		await letLeave(address);
		expect(await submissionOf(address, removed.id)).toMatchObject({
			state: "failed",
			error: "right",
			attempts: 0,
		});
		expect(await placeOf(address, removed.id)).toBe("draft");

		await seedMembership(address, ids.sender ?? "", "sender");
		const lowered = await send("sender", address);
		await indexRun(
			`update "memberships" set "role" = 'reader' where "user_id" = ?1 and "mailbox_id" in (select "id" from "mailboxes" where "address" = ?2)`,
			ids.sender,
			address,
		);
		// The owner's own message, taken at the same time, leaves.
		const owners = await send("owner", address);
		await letLeave(address);
		expect((await submissionOf(address, lowered.id))?.error).toBe("right");
		expect(await placeOf(address, owners.id)).toBe("sent");
		expect(fake.calls).toHaveLength(1);
		// Nothing was handed over for the two, so neither has a place in the caps.
		expect(await logged(address)).toBe(1);
	});

	it("a message does not leave after its sender's account was recovered", async () => {
		const address = await mailbox("recovered");
		const fake = await fakeSender(address);
		// A recovery used before the press does not count: the person who pressed is the one
		// who holds the account now.
		const use = (at: number) =>
			indexRun(
				`insert into "recoveries" ("id", "user_id", "token_hash", "created_at", "expires_at", "used_at") values (?1, ?2, ?1, ?3, ?3, ?3)`,
				crypto.randomUUID(),
				ids.sender,
				new Date(at).toISOString(),
			);
		await use(Date.now() - HOUR);
		const before = await send("sender", address);
		await letLeave(address);
		expect(await placeOf(address, before.id)).toBe("sent");

		await indexRun(`delete from "recoveries" where "user_id" = ?1`, ids.sender);
		const taken = await send("sender", address, later(HOUR));
		// The account is recovered while the message waits: whoever pressed Send may not be
		// the person who holds the account now.
		await use(Date.now());
		await age(address, HOUR + SECOND);
		expect(await wake(address)).toBe(true);
		expect(await submissionOf(address, taken.id)).toMatchObject({
			state: "failed",
			error: "right",
		});
		expect(fake.calls).toHaveLength(1);
		await indexRun(`delete from "recoveries" where "user_id" = ?1`, ids.sender);
	});

	it("a message does not leave when From is no longer the mailbox's address", async () => {
		const address = await mailbox("from");
		const fake = await fakeSender(address);
		const taken = await send("owner", address);
		await inMailbox(address, (sql) =>
			sql.exec(`UPDATE emails SET sender = 'other@example.com' WHERE id = ?1`, taken.id),
		);
		await letLeave(address);
		expect(await submissionOf(address, taken.id)).toMatchObject({
			state: "failed",
			error: "sender",
		});
		expect(fake.calls).toHaveLength(0);
	});

	it("a message does not leave when it no longer fits what the service takes", async () => {
		const address = await mailbox("fits");
		const fake = await fakeSender(address);
		const many = await send("owner", address);
		const none = await send("owner", address);
		const fileless = await send("owner", address);
		await inMailbox(address, (sql) => {
			const fifty = Array.from({ length: 51 }, (_one, index) => `to-${index}@elsewhere.test`);
			sql.exec(`UPDATE emails SET recipient = ?1 WHERE id = ?2`, fifty.join(", "), many.id);
			sql.exec(`UPDATE emails SET recipient = '' WHERE id = ?1`, none.id);
			// A file whose bytes are not in the bucket: the message cannot leave as it was seen.
			sql.exec(
				`INSERT INTO attachments (id, email_id, filename, mimetype, size) VALUES ('lost', ?1, 'lost.txt', 'text/plain', 4)`,
				fileless.id,
			);
		});
		await letLeave(address);
		for (const taken of [many, none, fileless]) {
			expect(await submissionOf(address, taken.id)).toMatchObject({
				state: "failed",
				error: "limits",
				attempts: 0,
			});
		}
		expect(fake.calls).toHaveLength(0);
	});

	it("a message 24 hours past its time does not leave", async () => {
		const address = await mailbox("late");
		const fake = await fakeSender(address);
		const taken = await send("owner", address);
		const inTime = await send("owner", address, later(2 * HOUR));
		await age(address, SENDING.lateAfterMs + MINUTE);
		expect(await wake(address)).toBe(true);
		expect(await submissionOf(address, taken.id)).toMatchObject({ state: "failed", error: "late" });
		expect(await placeOf(address, taken.id)).toBe("draft");
		// One that is less than a day late still leaves.
		expect(await placeOf(address, inTime.id)).toBe("sent");
		expect(fake.calls).toHaveLength(1);
	});
});

describe("the caps count what left", () => {
	it("refuses an ordinary send at once when a cap is full, and asks nothing of a later one", async () => {
		const address = await mailbox("caps");
		await left(address, SENDS_PER_HOUR - 1, 5 * MINUTE);
		await send("owner", address);
		// The one that waits to leave before it is counted too.
		const refused = await post("owner", address);
		expect(refused.status).toBe(429);
		expect((await json<{ error: string }>(refused)).error).toMatch(/20 emails per hour/);
		expect(await rowsOf(address, `SELECT id FROM emails`)).toHaveLength(1);
		// A time later on is not asked about the caps now.
		expect((await post("owner", address, later(3 * HOUR))).status).toBe(202);
	});

	it("is not freed by deleting or moving sent mail", async () => {
		const address = await mailbox("kept");
		await fakeSender(address);
		await left(address, SENDS_PER_HOUR - 1, 5 * MINUTE);
		const taken = await send("owner", address);
		await letLeave(address);
		expect(await placeOf(address, taken.id)).toBe("sent");
		expect((await post("owner", address)).status).toBe(429);

		// Moved to Trash and deleted for good: the message is gone, its place is not free.
		const moved = await as("owner").post(`${base(address)}/emails/${taken.id}/move`, {
			folderId: "trash",
		});
		expect(moved.status).toBe(200);
		expect((await post("owner", address)).status).toBe(429);
		const gone = await as("owner").fetch(`${base(address)}/emails/${taken.id}`, {
			method: "DELETE",
		});
		expect(gone.status).toBe(204);
		expect(await rowsOf(address, `SELECT email_id FROM submissions`)).toEqual([]);
		expect(await logged(address)).toBe(SENDS_PER_HOUR);
		expect((await post("owner", address)).status).toBe(429);
		// The record holds a time and a kind, and nothing of any message.
		const row = (await rowsOf(address, `SELECT * FROM send_log LIMIT 1`))[0] ?? {};
		expect(Object.keys(row).sort()).toEqual(["at", "kind"]);
	});

	it("holds a message while a cap is full and lets it go later, in the order of the times", async () => {
		const address = await mailbox("held");
		const fake = await fakeSender(address);
		const second = await send("owner", address, later(2 * HOUR));
		const first = await send("owner", address, later(HOUR));
		await age(address, 2 * HOUR + MINUTE);
		// One place is left in the hour: the message whose time came first takes it.
		await left(address, SENDS_PER_HOUR - 1, 50 * MINUTE);
		expect(await wake(address)).toBe(true);
		expect(await placeOf(address, first.id)).toBe("sent");
		expect(await submissionOf(address, second.id)).toMatchObject({
			state: "waiting",
			attempts: 0,
			error: null,
		});
		expect(fake.calls).toHaveLength(1);
		// The alarm waits for the cap, not for the message's own time, which is past.
		const set = (await alarmOf(address)) ?? 0;
		expect(set - Date.now()).toBeGreaterThan(5 * MINUTE);
		expect(set - Date.now()).toBeLessThan(15 * MINUTE);
		await wakeNow(address);
		expect(fake.calls).toHaveLength(1);

		await age(address, 15 * MINUTE);
		expect(await wake(address)).toBe(true);
		expect(await placeOf(address, second.id)).toBe("sent");
		expect(fake.calls).toHaveLength(2);
	});

	it("two messages cannot take the last place", async () => {
		const address = await mailbox("last");
		const fake = await fakeSender(address);
		await send("owner", address, later(HOUR));
		await send("owner", address, later(HOUR));
		await age(address, HOUR + MINUTE);
		await left(address, SENDS_PER_HOUR - 1, 10 * MINUTE);
		await runInDurableObject(objectOf(address), async (instance) => {
			const object = instance as unknown as { alarm(): Promise<void> };
			await Promise.all([object.alarm(), object.alarm()]);
		});
		expect(fake.calls).toHaveLength(1);
		expect(await logged(address)).toBe(SENDS_PER_HOUR);
	});
});

describe("the alarm", () => {
	it("is set to the earliest of all times, and again by every change and every run", async () => {
		const address = await mailbox("earliest");
		await fakeSender(address);
		expect(await alarmOf(address)).toBeNull();
		const far = await send("owner", address, later(3 * HOUR));
		expect(await alarmOf(address)).toBe(Date.parse(far.send_at));
		const near = await send("owner", address, later(HOUR));
		expect(await alarmOf(address)).toBe(Date.parse(near.send_at));
		// A new time for the far one, before the near one.
		const sooner = later(30 * MINUTE);
		const res = await as("owner").post(`${base(address)}/emails/${far.id}/reschedule`, sooner);
		expect(res.status).toBe(200);
		expect(await alarmOf(address)).toBe(Date.parse(sooner.send_at));
		// After a run it is set to what waits next.
		await age(address, 31 * MINUTE);
		expect(await wake(address)).toBe(true);
		expect(await placeOf(address, far.id)).toBe("sent");
		const next = (await submissionOf(address, near.id))?.send_at ?? "";
		expect(await alarmOf(address)).toBe(Date.parse(next));
		// Taken back, nothing waits: no alarm.
		expect((await as("owner").post(`${base(address)}/emails/${near.id}/unsend`)).status).toBe(200);
		expect(await alarmOf(address)).toBeNull();
	});

	it("lets at most ten messages leave in a run, and comes back for the rest", async () => {
		const address = await mailbox("run");
		const fake = await fakeSender(address);
		// What each run of the alarm handed over, whoever started it: a run that leaves mail
		// due sets the alarm to a time that has come, and the runtime runs it by itself.
		const runs: number[] = [];
		await runInDurableObject(objectOf(address), (instance) => {
			const object = instance as unknown as { alarm(): Promise<void> };
			const run = object.alarm.bind(object);
			object.alarm = async () => {
				const before = fake.calls.length;
				await run();
				runs.push(fake.calls.length - before);
			};
		});
		for (let index = 0; index < SENDING.perRun + 2; index++) {
			await send("owner", address, later(HOUR));
		}
		await age(address, HOUR + MINUTE);
		await letLeave(address);
		expect(fake.calls).toHaveLength(SENDING.perRun + 2);
		expect(runs.filter((handed) => handed > 0)).toEqual([SENDING.perRun, 2]);
		expect(await alarmOf(address)).toBeNull();
	});

	it("catches its own errors, hands nothing over twice and sets the next alarm", async () => {
		const address = await mailbox("errors");
		const fake = await fakeSender(address);
		const taken = await send("owner", address);
		await age(address, MINUTE);
		// The record of what left is gone: the handover cannot be written.
		await inMailbox(address, (sql) => sql.exec(`ALTER TABLE send_log RENAME TO send_log_away`));
		await runInDurableObject(objectOf(address), async (instance) => {
			// It does not throw: a handler that throws is tried six times and then never again.
			await (instance as unknown as { alarm(): Promise<void> }).alarm();
		});
		expect(fake.calls).toHaveLength(0);
		expect((await submissionOf(address, taken.id))?.state).toBe("waiting");
		const set = (await alarmOf(address)) ?? 0;
		expect(set - Date.now()).toBeGreaterThan(30 * SECOND);
		expect(set - Date.now()).toBeLessThan(2 * MINUTE);

		await inMailbox(address, (sql) => sql.exec(`ALTER TABLE send_log_away RENAME TO send_log`));
		await wakeNow(address);
		expect(fake.calls).toHaveLength(1);
		expect(await placeOf(address, taken.id)).toBe("sent");
	});

	it("is set again when the object wakes, something waits and none is set", async () => {
		const address = await mailbox("lost");
		const taken = await send("owner", address, later(HOUR));
		await inMailbox(address, (_sql, state) => state.storage.deleteAlarm());
		expect(await alarmOf(address)).toBeNull();
		// The object leaves memory; whatever wakes it next finds the rows and sets the alarm.
		await evictDurableObject(objectOf(address));
		expect((await as("owner").fetch(`${base(address)}/folders`)).status).toBe(200);
		expect(await alarmOf(address)).toBe(Date.parse(taken.send_at));

		// An alarm that is set is left as it is, and a mailbox that waits for nothing gets none.
		await inMailbox(address, (_sql, state) => state.storage.setAlarm(Date.now() + 10 * MINUTE));
		const kept = await alarmOf(address);
		await evictDurableObject(objectOf(address));
		expect((await as("owner").fetch(`${base(address)}/folders`)).status).toBe(200);
		expect(await alarmOf(address)).toBe(kept);
		const idle = await mailbox("idle");
		await evictDurableObject(objectOf(idle));
		expect((await as("owner").fetch(`${base(idle)}/folders`)).status).toBe(200);
		expect(await alarmOf(idle)).toBeNull();
	});
});
