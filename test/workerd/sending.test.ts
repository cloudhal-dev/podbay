/**
 * Tier 3: outgoing mail waits before it leaves (ADR-0016; rules S8, S13, boundary B6).
 *
 * - a send route stores the message in Scheduled with a `waiting` row, gives it a time and
 *   answers; it calls no sending service;
 * - a message is in Scheduled exactly when its state is `waiting` or `sending`;
 * - a message leaves at most once: a second alarm, a repeated request, a retry and a row
 *   found `sending` never send it again, and no answer means `unknown`, never a resend;
 * - the service's answer decides what comes next, and only "not now" is tried again, after
 *   1, 5 and 15 minutes, 1 hour and 4 hours;
 * - a final failure brings the message back to Drafts with its files and the reason;
 * - a message is taken back while it waits (409 `SEND_STARTED` when it is too late), is sent
 *   later at a time in UTC, and is given a new time.
 *
 * The send binding is the test's own: it answers what it is told and counts every call.
 */
import { env, runInDurableObject } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { NOT_NOW_CODES, SENDING } from "../../modules/mail/shared/sending.ts";
import {
	Browser,
	createMailbox,
	json,
	migrate,
	seedMembership,
	seedUser,
	setupOwner,
} from "./helpers.ts";
import {
	type Answer,
	age,
	alarmOf,
	fakeSender,
	HOUR,
	inMailbox,
	letLeave,
	MINUTE,
	objectOf,
	outOfPlace,
	placeOf,
	rowsOf,
	SECOND,
	submissionOf,
	wake,
	wakeNow,
} from "./sending-helpers.ts";

const bucket = (env as unknown as { BUCKET: R2Bucket }).BUCKET;
const browsers: Record<string, Browser> = {};
const as = (who: string) => browsers[who] as Browser;
let senderId = "";

interface Taken {
	id: string;
	status: string;
	send_at: string;
}
interface Message {
	id: string;
	folder_id: string;
	date: string;
	read: boolean;
	subject: string;
	in_reply_to: string | null;
	message_id: string | null;
	attachments: { id: string; filename: string }[];
	submission?: { state: string; send_at: string; error: string | null };
}

const base = (address: string) => `/api/v1/mailboxes/${encodeURIComponent(address)}`;

let made = 0;
/** A mailbox of its own for a test, so that no test spends another's caps. */
async function mailbox(name: string): Promise<string> {
	made += 1;
	const address = `${name}-${made}@example.com`;
	expect((await createMailbox(as("owner").cookie, address)).status).toBe(201);
	await seedMembership(address, senderId, "sender");
	return address;
}

const message = (address: string, more: Record<string, unknown> = {}) => ({
	to: "to@elsewhere.test",
	from: address,
	subject: "Hello",
	html: "<p>Hello &amp; goodbye</p>",
	...more,
});

/** Sends as the owner and expects the mailbox to take the message. */
async function send(address: string, more: Record<string, unknown> = {}): Promise<Taken> {
	const res = await as("owner").post(`${base(address)}/emails`, message(address, more));
	expect(res.status, "the send").toBe(202);
	return json<Taken>(res);
}
const read = async (address: string, id: string) =>
	json<Message>(await as("owner").fetch(`${base(address)}/emails/${id}`));
const unsend = (address: string, id: string, who = "owner") =>
	as(who).post(`${base(address)}/emails/${id}/unsend`);
const reschedule = (address: string, id: string, body: unknown = {}, who = "owner") =>
	as(who).post(`${base(address)}/emails/${id}/reschedule`, body);
const logged = async (address: string) => (await rowsOf(address, `SELECT at FROM send_log`)).length;

async function draft(address: string, more: Record<string, unknown> = {}): Promise<string> {
	const res = await as("owner").post(`${base(address)}/drafts`, {
		to: "to@elsewhere.test",
		subject: "A draft",
		body: "<p>x</p>",
		...more,
	});
	expect(res.status).toBe(201);
	return (await json<{ id: string }>(res)).id;
}
/** Declares a file of a draft and sends its bytes. Returns its key in the bucket. */
async function attach(address: string, draftId: string, name: string, content: string) {
	const declared = await as("owner").post(`${base(address)}/drafts/${draftId}/attachments`, {
		filename: name,
		type: "text/plain",
		size: content.length,
	});
	expect(declared.status).toBe(201);
	const file = await json<{ id: string }>(declared);
	const stored = await as("owner").fetch(
		`${base(address)}/drafts/${draftId}/attachments/${file.id}`,
		{ method: "PUT", body: content },
	);
	expect(stored.status).toBe(200);
	return `attachments/${draftId}/${file.id}/${name}`;
}

beforeAll(async () => {
	await migrate();
	expect((await setupOwner()).status).toBe(201);
	senderId = await seedUser("sender@example.com", "member");
	for (const who of ["owner", "sender"]) {
		browsers[who] = new Browser();
		expect((await as(who).signIn(`${who}@example.com`)).status).toBe(200);
	}
});

describe("a send is taken, and leaves later", () => {
	it("answers that the message waits, stores it in Scheduled and calls no service", async () => {
		const address = await mailbox("taken");
		const fake = await fakeSender(address);
		const before = Date.now();
		const res = await as("owner").post(`${base(address)}/emails`, message(address));
		expect(res.status).toBe(202);
		const taken = await json<Taken>(res);
		expect(Object.keys(taken).sort()).toEqual(["id", "send_at", "status"]);
		expect(taken.status).toBe("waiting");
		// The window nobody chose is ten seconds, and the mailbox holds it two seconds longer.
		const leaves = Date.parse(taken.send_at);
		expect(leaves - before).toBeGreaterThanOrEqual(12 * SECOND);
		expect(leaves - before).toBeLessThan(17 * SECOND);

		expect(await placeOf(address, taken.id)).toBe("scheduled");
		const row = await submissionOf(address, taken.id);
		expect(row).toMatchObject({ state: "waiting", send_at: taken.send_at, attempts: 0 });
		expect(row?.requested_by).not.toBe("");
		expect(fake.calls).toHaveLength(0);
		expect(await alarmOf(address)).toBe(leaves);

		// It says so wherever it is read, it is listed in Scheduled, and Sent is empty.
		const shown = await read(address, taken.id);
		expect(shown.submission).toEqual({ state: "waiting", send_at: taken.send_at, error: null });
		expect(shown.read).toBe(true);
		for (const threaded of ["true", "false"]) {
			const listed = await json<{ emails: Message[]; totalCount: number }>(
				await as("owner").fetch(`${base(address)}/emails?folder=scheduled&threaded=${threaded}`),
			);
			expect(listed.totalCount).toBe(1);
			expect(listed.emails[0]?.submission?.state).toBe("waiting");
		}
		const sent = await json<{ emails: Message[] }>(
			await as("owner").fetch(`${base(address)}/emails?folder=sent`),
		);
		expect(sent.emails).toEqual([]);
		// The window is honest: before its time nothing leaves, also when the alarm runs.
		await wakeNow(address);
		expect(fake.calls).toHaveLength(0);
		expect(await placeOf(address, taken.id)).toBe("scheduled");
	});

	it("leaves at its time: it is in Sent with the time it left and the service's id", async () => {
		const address = await mailbox("left");
		const fake = await fakeSender(address);
		fake.next = [{ messageId: "<abc@service.test>" }];
		const taken = await send(address, {
			cc: "cc@elsewhere.test",
			from: { email: address, name: "Desk <of> Podbay" },
			in_reply_to: "question@sender.test",
			references: ["first@sender.test", "question@sender.test"],
		});
		const pressed = (await read(address, taken.id)).date;
		await age(address, 13 * SECOND);
		expect(await wake(address)).toBe(true);

		// What the service was given is read from the stored rows: both forms of the text, the
		// name the mailbox sends under, and how the message is threaded.
		expect(fake.calls).toHaveLength(1);
		expect(fake.calls[0]).toEqual({
			to: ["to@elsewhere.test"],
			cc: ["cc@elsewhere.test"],
			from: { email: address, name: "Desk <of> Podbay" },
			subject: "Hello",
			html: "<p>Hello &amp; goodbye</p>",
			text: "Hello & goodbye",
			headers: {
				"In-Reply-To": "<question@sender.test>",
				References: "<first@sender.test> <question@sender.test>",
			},
		});
		const now = await read(address, taken.id);
		expect(now.folder_id).toBe("sent");
		expect(now.submission).toMatchObject({ state: "sent", error: null });
		expect(Date.parse(now.date)).toBeGreaterThan(Date.parse(pressed));
		const row = await submissionOf(address, taken.id);
		expect(row).toMatchObject({ state: "sent", service_id: "<abc@service.test>", attempts: 1 });
		expect(row?.sent_at).toBe(now.date);
		// Nothing waits any more, so no alarm is set.
		expect(await alarmOf(address)).toBeNull();
		expect(await logged(address)).toBe(1);
	});

	it("gives a message sent as text alone an HTML body, and both forms leave", async () => {
		const address = await mailbox("text");
		const fake = await fakeSender(address);
		await send(address, { html: undefined, text: "Line one\nLine <two>" });
		await letLeave(address);
		expect(fake.calls[0]?.html).toContain("Line one<br>Line &lt;two&gt;");
		expect(fake.calls[0]?.text).toBe("Line one\nLine <two>");
	});

	it("holds the place and the state together through every change", async () => {
		const address = await mailbox("together");
		const fake = await fakeSender(address);
		const steady = async (what: string) => expect(await outOfPlace(address), what).toEqual([]);
		const id = await draft(address);
		await steady("a draft");
		await send(address, { draft_id: id });
		await steady("taken");
		expect((await unsend(address, id)).status).toBe(200);
		await steady("taken back");
		await send(address, { draft_id: id, send_at: new Date(Date.now() + HOUR).toISOString() });
		expect((await reschedule(address, id)).status).toBe(200);
		await steady("given a new time");
		fake.next = [{ code: "E_RATE_LIMIT_EXCEEDED" }, { messageId: "<x@service.test>" }];
		await wakeNow(address);
		expect((await submissionOf(address, id))?.state).toBe("waiting");
		await steady("refused for now");
		await age(address, 2 * MINUTE);
		await wake(address);
		expect(await placeOf(address, id)).toBe("sent");
		await steady("sent");
		const other = await send(address);
		fake.next = [{ code: "E_ACCOUNT_SUSPENDED" }];
		await letLeave(address);
		expect(await placeOf(address, other.id)).toBe("draft");
		await steady("failed");
		// The rule can fail: a waiting row whose message is elsewhere breaks it.
		await inMailbox(address, (sql) =>
			sql.exec(`UPDATE submissions SET state = 'waiting' WHERE email_id = ?1`, other.id),
		);
		expect(await outOfPlace(address)).toEqual([{ id: other.id }]);
	});
});

describe("a message leaves at most once", () => {
	it("a second alarm sends nothing again", async () => {
		const address = await mailbox("twice");
		const fake = await fakeSender(address);
		const taken = await send(address);
		await letLeave(address);
		expect(fake.calls).toHaveLength(1);
		await wakeNow(address);
		await wakeNow(address);
		expect(fake.calls).toHaveLength(1);
		expect((await submissionOf(address, taken.id))?.attempts).toBe(1);
	});

	it("two runs at once hand a message over once", async () => {
		const address = await mailbox("at-once");
		const fake = await fakeSender(address);
		await send(address);
		await age(address, MINUTE);
		await runInDurableObject(objectOf(address), async (instance) => {
			const object = instance as unknown as { alarm(): Promise<void> };
			await Promise.all([object.alarm(), object.alarm(), object.alarm()]);
		});
		expect(fake.calls).toHaveLength(1);
		expect(await logged(address)).toBe(1);
	});

	it("a repeated request that names the same draft is refused, and one message leaves", async () => {
		const address = await mailbox("repeated");
		const fake = await fakeSender(address);
		const id = await draft(address);
		const first = await send(address, { draft_id: id });
		expect(first.id).toBe(id);
		const again = await as("owner").post(
			`${base(address)}/emails`,
			message(address, { draft_id: id }),
		);
		expect(again.status).toBe(409);
		expect((await json<{ code: string }>(again)).code).toBe("SCHEDULED");
		await letLeave(address);
		// Once it has left, the id names no draft any more.
		const late = await as("owner").post(
			`${base(address)}/emails`,
			message(address, { draft_id: id }),
		);
		expect(late.status).toBe(404);
		await letLeave(address);
		expect(fake.calls).toHaveLength(1);
		expect(await rowsOf(address, `SELECT id FROM emails`)).toHaveLength(1);
	});

	it("a row found `sending` is never handed over again, and is given up after fifteen minutes", async () => {
		const address = await mailbox("stopped");
		const fake = await fakeSender(address);
		const taken = await send(address);
		// A handler that stopped between the write and the answer leaves exactly this.
		await inMailbox(address, (sql) => {
			const now = new Date().toISOString();
			sql.exec(
				`UPDATE submissions SET state = 'sending', started_at = ?1, attempts = 1 WHERE email_id = ?2`,
				now,
				taken.id,
			);
			sql.exec(`INSERT INTO send_log (at, kind) VALUES (?1, 'person')`, now);
		});
		// The alarm is set to the fifteenth minute of the attempt, and until then nothing is done.
		await wakeNow(address);
		expect((await submissionOf(address, taken.id))?.state).toBe("sending");
		const set = await alarmOf(address);
		expect(set).not.toBeNull();
		expect(Math.abs((set ?? 0) - Date.now() - SENDING.unansweredAfterMs)).toBeLessThan(5 * SECOND);
		expect((await unsend(address, taken.id)).status).toBe(409);

		await age(address, SENDING.unansweredAfterMs + SECOND);
		expect(await wake(address)).toBe(true);
		const row = await submissionOf(address, taken.id);
		expect(row).toMatchObject({ state: "failed", error: "unknown", attempts: 1 });
		expect(await placeOf(address, taken.id)).toBe("draft");
		// Nobody knows whether it left: it keeps its place in the caps, and nothing resends it.
		expect(await logged(address)).toBe(1);
		await wakeNow(address);
		expect(fake.calls).toHaveLength(0);
	});

	it("no answer means unknown, never a resend", async () => {
		const address = await mailbox("silent");
		const fake = await fakeSender(address, 50);
		fake.otherwise = "never";
		const taken = await send(address);
		await letLeave(address);
		expect(fake.calls).toHaveLength(1);
		expect(await submissionOf(address, taken.id)).toMatchObject({
			state: "failed",
			error: "unknown",
		});
		expect(await placeOf(address, taken.id)).toBe("draft");
		expect(await logged(address)).toBe(1);
		for (let run = 0; run < 3; run++) await wakeNow(address);
		expect(fake.calls).toHaveLength(1);
	});
});

describe("the service's answer decides what comes next", () => {
	it.each(NOT_NOW_CODES)(
		"%s reads as not now: the message waits for its next try",
		async (code) => {
			const address = await mailbox("not-now");
			const fake = await fakeSender(address);
			fake.next = [{ code }];
			const taken = await send(address);
			await letLeave(address);
			const row = await submissionOf(address, taken.id);
			expect(row).toMatchObject({ state: "waiting", attempts: 1, error: code });
			expect(await placeOf(address, taken.id)).toBe("scheduled");
			const wait = Date.parse(row?.retry_at ?? "") - Date.now();
			expect(Math.abs(wait - MINUTE)).toBeLessThan(5 * SECOND);
			// The service did not take it: it has no place in the caps.
			expect(await logged(address)).toBe(0);
			expect(await alarmOf(address)).toBe(Date.parse(row?.retry_at ?? ""));
		},
	);

	const FINAL: [string, Answer, string, number][] = [
		["a refusal that is final", { code: "E_SENDER_NOT_VERIFIED" }, "E_SENDER_NOT_VERIFIED", 0],
		["a failed delivery", { code: "E_DELIVERY_FAILED" }, "E_DELIVERY_FAILED", 0],
		[
			"the account's own daily quota",
			{ code: "E_DAILY_LIMIT_EXCEEDED" },
			"E_DAILY_LIMIT_EXCEEDED",
			0,
		],
		["an argument of the wrong shape", "type-error", "limits", 0],
		["an error without a code", "no-code", "unknown", 1],
		["a code that is no code of the service", { code: "nonsense code" }, "unknown", 1],
		["an answer without an id", "empty", "unknown", 1],
	];
	it.each(FINAL)("%s is final", async (_name, answer, reason, counted) => {
		const address = await mailbox("final");
		const fake = await fakeSender(address);
		fake.next = [answer];
		const taken = await send(address);
		await letLeave(address);
		expect(await submissionOf(address, taken.id)).toMatchObject({
			state: "failed",
			error: reason,
			attempts: 1,
			retry_at: null,
		});
		expect(await placeOf(address, taken.id)).toBe("draft");
		// Only what may have left keeps its place in the caps.
		expect(await logged(address)).toBe(counted);
		await wakeNow(address);
		expect(fake.calls).toHaveLength(1);
		expect(await alarmOf(address)).toBeNull();
	});
});

describe("tries", () => {
	it("are made after 1, 5 and 15 minutes, 1 hour and 4 hours, and then no more", async () => {
		const address = await mailbox("tries");
		const fake = await fakeSender(address);
		fake.otherwise = { code: "E_INTERNAL_SERVER_ERROR" };
		const taken = await send(address);
		await age(address, MINUTE);
		const waits = [1, 5, 15, 60, 240].map((minutes) => minutes * MINUTE);
		expect([...SENDING.retryAfterMs]).toEqual(waits);
		for (const [index, wait] of waits.entries()) {
			expect(await wake(address), `attempt ${index + 1}`).toBe(true);
			const row = await submissionOf(address, taken.id);
			expect(row).toMatchObject({ state: "waiting", attempts: index + 1 });
			expect(Math.abs(Date.parse(row?.retry_at ?? "") - Date.now() - wait)).toBeLessThan(
				5 * SECOND,
			);
			// Before its time a try is not made, also when the alarm runs.
			await age(address, wait - 10 * SECOND);
			await wakeNow(address);
			expect(fake.calls).toHaveLength(index + 1);
			await age(address, 11 * SECOND);
		}
		// The sixth attempt is the last: the message has failed with the last code.
		expect(await wake(address)).toBe(true);
		expect(fake.calls).toHaveLength(SENDING.attempts);
		expect(await submissionOf(address, taken.id)).toMatchObject({
			state: "failed",
			error: "E_INTERNAL_SERVER_ERROR",
			attempts: 6,
		});
		expect(await placeOf(address, taken.id)).toBe("draft");
		await wakeNow(address);
		expect(fake.calls).toHaveLength(SENDING.attempts);
		expect(await logged(address)).toBe(0);
	});
});

describe("a final failure brings the message back", () => {
	it("to Drafts, with its files and the reason, until it is sent again or the mark is taken off", async () => {
		const address = await mailbox("back");
		const fake = await fakeSender(address);
		await inMailbox(address, (sql) =>
			sql.exec(
				`INSERT INTO emails (id, folder_id, subject, sender, recipient, date, body, message_id, thread_id)
				 VALUES ('asked', 'inbox', 'A question', 'ada@sender.test', ?1, ?2, 'q', 'question@sender.test', 'talk')`,
				address,
				new Date().toISOString(),
			),
		);
		const id = await draft(address, { in_reply_to: "asked", thread_id: "talk" });
		const key = await attach(address, id, "notes.txt", "notes");
		const reply = await as("owner").post(
			`${base(address)}/emails/asked/reply`,
			message(address, { draft_id: id, subject: "Re: A question" }),
		);
		expect(reply.status).toBe(202);
		// On its way it names what it answers by that message's Message-ID.
		expect((await read(address, id)).in_reply_to).toBe("question@sender.test");
		fake.next = [{ code: "E_RECIPIENT_SUPPRESSED" }];
		await letLeave(address);

		const back = await read(address, id);
		expect(back.folder_id).toBe("draft");
		expect(back.submission).toMatchObject({ state: "failed", error: "E_RECIPIENT_SUPPRESSED" });
		expect(back.read).toBe(false);
		// A draft again in every way: it answers the message by its id, and carries no id of its own.
		expect([back.in_reply_to, back.message_id]).toEqual(["asked", null]);
		expect(back.attachments.map((file) => file.filename)).toEqual(["notes.txt"]);
		expect(await bucket.head(key)).not.toBeNull();
		const places = await json<{ id: string; notSent?: number; waiting?: number }[]>(
			await as("owner").fetch(`${base(address)}/folders`),
		);
		expect(places.find((place) => place.id === "draft")?.notSent).toBe(1);
		expect(places.find((place) => place.id === "scheduled")?.waiting).toBe(0);
		// It is listed in Drafts with its mark, and it can be saved over like any draft.
		const drafts = await json<{ emails: Message[] }>(
			await as("owner").fetch(`${base(address)}/emails?folder=draft&threaded=true`),
		);
		expect(drafts.emails[0]?.submission?.state).toBe("failed");

		// Sent again, it is taken anew and leaves: the tries start over.
		const again = await as("owner").post(
			`${base(address)}/emails/asked/reply`,
			message(address, { draft_id: id, subject: "Re: A question" }),
		);
		expect(again.status).toBe(202);
		expect(await submissionOf(address, id)).toMatchObject({
			state: "waiting",
			attempts: 0,
			error: null,
		});
		fake.next = [{ code: "E_CONTENT_TOO_LARGE" }];
		await letLeave(address);
		expect((await read(address, id)).submission?.error).toBe("E_CONTENT_TOO_LARGE");

		// Dismissing the mark is `unsend` on a failed message: a plain draft again.
		expect((await unsend(address, id)).status).toBe(200);
		expect(await submissionOf(address, id)).toBeUndefined();
		const plain = await read(address, id);
		expect(plain.folder_id).toBe("draft");
		expect(plain.submission).toBeUndefined();
		expect(plain.attachments).toHaveLength(1);
		expect(fake.calls).toHaveLength(2);
		expect(fake.calls[0]?.attachments?.map((file) => file.filename)).toEqual(["notes.txt"]);
	});
});

describe("undo", () => {
	it("inside the window makes the message a draft again, with the same id and the same files", async () => {
		const address = await mailbox("undone");
		const fake = await fakeSender(address);
		const id = await draft(address);
		const key = await attach(address, id, "plan.txt", "plan");
		const taken = await send(address, { draft_id: id, undo_seconds: 5 });
		expect(taken.id).toBe(id);
		const res = await unsend(address, id);
		expect(res.status).toBe(200);
		expect(await json(res)).toEqual({ id, status: "draft" });

		const back = await read(address, id);
		expect(back.folder_id).toBe("draft");
		expect(back.submission).toBeUndefined();
		expect(back.attachments.map((file) => file.filename)).toEqual(["plan.txt"]);
		expect(await bucket.head(key)).not.toBeNull();
		expect(await submissionOf(address, id)).toBeUndefined();
		// Nothing waits, so no alarm is set, and nothing ever leaves.
		expect(await alarmOf(address)).toBeNull();
		await wakeNow(address);
		expect(fake.calls).toHaveLength(0);
		// Taken back twice is nothing to take back.
		expect((await unsend(address, id)).status).toBe(404);
		expect((await unsend(address, "no-such-message")).status).toBe(404);
	});

	it("works for as long as the message waits: the state decides, not the clock", async () => {
		const address = await mailbox("late-undo");
		const fake = await fakeSender(address);
		const taken = await send(address);
		// The alarm is late: the window is longer, never shorter.
		await age(address, 5 * MINUTE);
		expect((await unsend(address, taken.id)).status).toBe(200);
		await wakeNow(address);
		expect(fake.calls).toHaveLength(0);
		expect(await placeOf(address, taken.id)).toBe("draft");
	});

	it("is refused with SEND_STARTED once the message was handed over", async () => {
		const address = await mailbox("too-late");
		await fakeSender(address);
		const taken = await send(address);
		await letLeave(address);
		for (const res of [await unsend(address, taken.id), await reschedule(address, taken.id)]) {
			expect(res.status).toBe(409);
			expect((await json<{ code: string }>(res)).code).toBe("SEND_STARTED");
		}
		expect(await placeOf(address, taken.id)).toBe("sent");
	});

	it("waits for the window the request names: 5, 10 or 30 seconds, and nothing else", async () => {
		const address = await mailbox("window");
		for (const seconds of [5, 10, 30]) {
			const before = Date.now();
			const taken = await send(address, { undo_seconds: seconds });
			const wait = Date.parse(taken.send_at) - before;
			expect(wait, `${seconds}`).toBeGreaterThanOrEqual(seconds * SECOND + SENDING.marginMs);
			expect(wait, `${seconds}`).toBeLessThan(seconds * SECOND + SENDING.marginMs + 5 * SECOND);
		}
		for (const bad of [0, 7, 60, "10", null]) {
			const res = await as("owner").post(
				`${base(address)}/emails`,
				message(address, { undo_seconds: bad }),
			);
			expect(res.status, String(bad)).toBe(400);
		}
		expect(await rowsOf(address, `SELECT id FROM emails`)).toHaveLength(3);
	});
});

describe("send later", () => {
	it("keeps the instant, has no window on top, and leaves when its time has come", async () => {
		const address = await mailbox("later");
		const fake = await fakeSender(address);
		const at = new Date(Date.now() + 2 * HOUR).toISOString();
		const taken = await send(address, { send_at: at });
		expect(taken).toMatchObject({ status: "waiting", send_at: at });
		expect(await alarmOf(address)).toBe(Date.parse(at));
		await age(address, HOUR);
		await wakeNow(address);
		expect(fake.calls).toHaveLength(0);
		await age(address, HOUR + SECOND);
		expect(await wake(address)).toBe(true);
		expect(fake.calls).toHaveLength(1);
		expect(await placeOf(address, taken.id)).toBe("sent");
	});

	it("refuses a time in the past, one more than a year ahead and one that is not UTC", async () => {
		const address = await mailbox("times");
		const day = 24 * HOUR;
		const refused: [string, string, string | undefined][] = [
			["the past", new Date(Date.now() - MINUTE).toISOString(), "INVALID"],
			["366 days ahead", new Date(Date.now() + 366 * day).toISOString(), "SEND_AT_TOO_FAR"],
			["a local time", "2030-01-01T10:00:00+03:00", undefined],
			["no time at all", "tomorrow", undefined],
		];
		for (const [what, send_at, code] of refused) {
			const res = await as("owner").post(`${base(address)}/emails`, message(address, { send_at }));
			expect(res.status, what).toBe(400);
			if (code) expect((await json<{ code: string }>(res)).code, what).toBe(code);
		}
		expect(await rowsOf(address, `SELECT id FROM emails`)).toEqual([]);
		// The furthest time is taken; a time nearer than the window is an ordinary send.
		const far = new Date(Date.now() + 364 * day).toISOString();
		expect((await send(address, { send_at: far })).send_at).toBe(far);
		const near = await send(address, { send_at: new Date(Date.now() + 3 * SECOND).toISOString() });
		expect(Date.parse(near.send_at) - Date.now()).toBeGreaterThan(10 * SECOND);
	});

	it("is given a new time, sent now or cancelled by whoever may send", async () => {
		const address = await mailbox("changed");
		const fake = await fakeSender(address);
		const taken = await send(address, { send_at: new Date(Date.now() + 5 * HOUR).toISOString() });
		const owner = (await submissionOf(address, taken.id))?.requested_by;

		// A new time, by another member who may send: theirs is the right asked at leaving.
		const at = new Date(Date.now() + HOUR).toISOString();
		const moved = await reschedule(address, taken.id, { send_at: at }, "sender");
		expect(moved.status).toBe(200);
		expect(await json(moved)).toEqual({ id: taken.id, status: "waiting", send_at: at });
		const row = await submissionOf(address, taken.id);
		expect(row).toMatchObject({ state: "waiting", send_at: at, requested_by: senderId });
		expect(row?.requested_by).not.toBe(owner);
		expect(await alarmOf(address)).toBe(Date.parse(at));

		for (const [send_at, code] of [
			[new Date(Date.now() - MINUTE).toISOString(), "INVALID"],
			[new Date(Date.now() + 400 * 24 * HOUR).toISOString(), "SEND_AT_TOO_FAR"],
		]) {
			const res = await reschedule(address, taken.id, { send_at });
			expect(res.status).toBe(400);
			expect((await json<{ code: string }>(res)).code).toBe(code);
		}
		expect((await reschedule(address, taken.id, { send_at: at, more: 1 })).status).toBe(400);
		expect((await reschedule(address, "no-such-message")).status).toBe(404);
		expect((await submissionOf(address, taken.id))?.send_at).toBe(at);

		// Send now: no time in the request. It leaves at the next run, with no window on top.
		const now = await reschedule(address, taken.id);
		expect(now.status).toBe(200);
		expect((await submissionOf(address, taken.id))?.attempts).toBe(0);
		await letLeave(address);
		expect(fake.calls).toHaveLength(1);
		expect(await placeOf(address, taken.id)).toBe("sent");

		// Cancelling is taking it back: a draft again, and a draft has no time to change.
		const other = await send(address, { send_at: new Date(Date.now() + HOUR).toISOString() });
		expect((await unsend(address, other.id, "sender")).status).toBe(200);
		expect(await placeOf(address, other.id)).toBe("draft");
		expect((await reschedule(address, other.id)).status).toBe(404);
		expect(fake.calls).toHaveLength(1);
	});

	it("holds at most 100 waiting messages in a mailbox", async () => {
		const address = await mailbox("full");
		await inMailbox(address, (sql) => {
			const at = new Date(Date.now() + HOUR).toISOString();
			for (let index = 0; index < SENDING.waiting - 1; index++) {
				sql.exec(
					`INSERT INTO emails (id, folder_id, subject, sender, recipient, date, body) VALUES (?1, 'scheduled', 'Waits', ?2, 'to@elsewhere.test', ?3, 'x')`,
					`w-${index}`,
					address,
					at,
				);
				sql.exec(
					`INSERT INTO submissions (email_id, state, send_at, requested_at, requested_by) VALUES (?1, 'waiting', ?2, ?2, 'someone')`,
					`w-${index}`,
					at,
				);
			}
		});
		const later = { send_at: new Date(Date.now() + 2 * HOUR).toISOString() };
		const last = await send(address, later);
		for (const more of [later, {}]) {
			const res = await as("owner").post(`${base(address)}/emails`, message(address, more));
			expect(res.status).toBe(409);
			expect((await json<{ code: string }>(res)).code).toBe("TOO_MANY_WAITING");
		}
		expect(await rowsOf(address, `SELECT id FROM emails`)).toHaveLength(SENDING.waiting);
		// One taken back makes room for one.
		expect((await unsend(address, last.id)).status).toBe(200);
		await send(address, later);
	});
});
