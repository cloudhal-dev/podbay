/**
 * Tier 3: who may send, take back and give a new time, and what Scheduled is to every other
 * route (ADR-0016, decisions 2, 19, 21 and 25; rules S1, S7, S13, D3; boundaries B1 and B4).
 *
 * - send, send later, `unsend` and `reschedule` need `mailbox.send`; seeing Scheduled needs
 *   `mailbox.read`. A reader is refused, someone without a membership is told nothing, and a
 *   message of another mailbox does not exist here;
 * - a message enters and leaves Scheduled only by being sent, taken back or let go: the
 *   routes that move, delete, mark, label, save and empty, and the deeds on many
 *   conversations, refuse it as a source (409 `SCHEDULED`) and as a target;
 * - deleting a mailbox deletes what waits and the alarm: nothing is sent afterwards;
 * - the tables come by a migration that is run from the release before it, with the caps
 *   seeded from what is in Sent from the last day;
 * - a log line of a refused handover carries ids, a state and a code, never the mail or the
 *   service's words;
 * - an open app is told when a message is taken, taken back, leaves or fails.
 */
import { env } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { applyMigrations, mailboxMigrations } from "../../workers/durableObject/migrations.ts";
import {
	Browser,
	createMailbox,
	json,
	migrate,
	seedMembership,
	seedUser,
	setupOwner,
} from "./helpers.ts";
import { open } from "./live-helpers.ts";
import {
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
	submissionOf,
	wake,
	wakeNow,
} from "./sending-helpers.ts";

const bucket = (env as unknown as { BUCKET: R2Bucket }).BUCKET;
const DESK = "desk@example.com";
const OTHER = "other@example.com";
const browsers: Record<string, Browser> = {};
const as = (who: string) => browsers[who] as Browser;

interface Taken {
	id: string;
	status: string;
	send_at: string;
}
interface Refusal {
	error: string;
	code?: string;
}

const base = (address: string) => `/api/v1/mailboxes/${encodeURIComponent(address)}`;
const message = (address: string, more: Record<string, unknown> = {}) => ({
	to: "to@elsewhere.test",
	from: address,
	subject: "Hello",
	html: "<p>Hello</p>",
	...more,
});
const later = (ms = HOUR) => ({ send_at: new Date(Date.now() + ms).toISOString() });
async function send(who: string, address: string, more: Record<string, unknown> = {}) {
	const res = await as(who).post(`${base(address)}/emails`, message(address, more));
	expect(res.status, "the send").toBe(202);
	return json<Taken>(res);
}
const put = (who: string, path: string, body: unknown) =>
	as(who).fetch(path, { method: "PUT", body: JSON.stringify(body) });
const del = (who: string, path: string) => as(who).fetch(path, { method: "DELETE" });
/** Expects a route to refuse a message because it waits to leave. */
async function waits(res: Response, what: string) {
	expect(res.status, what).toBe(409);
	expect((await json<Refusal>(res)).code, what).toBe("SCHEDULED");
}
/** Everything about a message that a route could have changed. */
const stateOf = (address: string, id: string) =>
	inMailbox(address, (sql) => ({
		row: [...sql.exec(`SELECT * FROM emails WHERE id = ?1`, id)][0],
		labels: [...sql.exec(`SELECT label_id FROM email_labels WHERE email_id = ?1`, id)],
		submission: [...sql.exec(`SELECT * FROM submissions WHERE email_id = ?1`, id)][0],
	}));

beforeAll(async () => {
	await migrate();
	expect((await setupOwner()).status).toBe(201);
	const ids: Record<string, string> = {};
	for (const who of ["sender", "reader", "stranger"]) {
		ids[who] = await seedUser(`${who}@example.com`, "member");
	}
	ids.admin = await seedUser("admin@example.com", "admin");
	for (const who of ["owner", "sender", "reader", "stranger", "admin"]) {
		browsers[who] = new Browser();
		expect((await as(who).signIn(`${who}@example.com`)).status).toBe(200);
	}
	for (const address of [DESK, OTHER]) {
		expect((await createMailbox(as("owner").cookie, address)).status).toBe(201);
	}
	await seedMembership(DESK, ids.sender ?? "", "sender");
	await seedMembership(DESK, ids.reader ?? "", "reader");
	await inMailbox(DESK, (sql) =>
		sql.exec(
			`INSERT INTO emails (id, folder_id, subject, sender, recipient, date, body, message_id, thread_id)
			 VALUES ('asked', 'inbox', 'A question', 'ada@sender.test', ?1, ?2, 'q', 'question@sender.test', 'talk')`,
			DESK,
			new Date().toISOString(),
		),
	);
});

afterEach(async () => {
	// Every test leaves the caps as it found them.
	for (const address of [DESK, OTHER]) {
		await inMailbox(address, (sql) => sql.exec(`DELETE FROM send_log`));
	}
});

describe("who may send, take back and give a new time", () => {
	it("an owner and a sender may, on every route", async () => {
		for (const who of ["owner", "sender"]) {
			const sent = await send(who, DESK, later());
			const reply = await as(who).post(`${base(DESK)}/emails/asked/reply`, message(DESK, later()));
			const forward = await as(who).post(
				`${base(DESK)}/emails/asked/forward`,
				message(DESK, later()),
			);
			expect([reply.status, forward.status], who).toEqual([202, 202]);
			const moved = await as(who).post(`${base(DESK)}/emails/${sent.id}/reschedule`, later());
			expect(moved.status, who).toBe(200);
			for (const id of [sent.id, (await json<Taken>(reply)).id, (await json<Taken>(forward)).id]) {
				expect((await as(who).post(`${base(DESK)}/emails/${id}/unsend`)).status, who).toBe(200);
				expect((await del(who, `${base(DESK)}/emails/${id}`)).status, who).toBe(204);
			}
		}
	});

	it("a reader sees what waits and can neither send, take back nor give a new time", async () => {
		const taken = await send("owner", DESK, later());
		const before = await stateOf(DESK, taken.id);
		const listed = await json<{ emails: { id: string }[] }>(
			await as("reader").fetch(`${base(DESK)}/emails?folder=scheduled`),
		);
		expect(listed.emails.map((one) => one.id)).toEqual([taken.id]);
		const shown = await as("reader").fetch(`${base(DESK)}/emails/${taken.id}`);
		expect(shown.status).toBe(200);
		expect((await json<{ submission?: { state: string } }>(shown)).submission?.state).toBe(
			"waiting",
		);

		const refused = [
			await as("reader").post(`${base(DESK)}/emails`, message(DESK)),
			await as("reader").post(`${base(DESK)}/emails`, message(DESK, later())),
			await as("reader").post(`${base(DESK)}/emails/asked/reply`, message(DESK)),
			await as("reader").post(`${base(DESK)}/emails/asked/forward`, message(DESK)),
			await as("reader").post(`${base(DESK)}/emails/${taken.id}/unsend`),
			await as("reader").post(`${base(DESK)}/emails/${taken.id}/reschedule`, later()),
			await as("reader").post(`${base(DESK)}/emails/${taken.id}/reschedule`),
		];
		expect(refused.map((res) => res.status)).toEqual([403, 403, 403, 403, 403, 403, 403]);
		expect(await stateOf(DESK, taken.id)).toEqual(before);
		expect((await as("owner").post(`${base(DESK)}/emails/${taken.id}/unsend`)).status).toBe(200);
	});

	it("someone without a membership is told nothing, whatever they manage", async () => {
		const taken = await send("owner", DESK, later());
		const before = await stateOf(DESK, taken.id);
		for (const who of ["stranger", "admin"]) {
			const refused = [
				await as(who).post(`${base(DESK)}/emails`, message(DESK)),
				await as(who).post(`${base(DESK)}/emails/${taken.id}/unsend`),
				await as(who).post(`${base(DESK)}/emails/${taken.id}/reschedule`, later()),
				await as(who).fetch(`${base(DESK)}/emails?folder=scheduled`),
				await as(who).fetch(`${base(DESK)}/emails/${taken.id}`),
			];
			expect(
				refused.map((res) => res.status),
				who,
			).toEqual([404, 404, 404, 404, 404]);
		}
		// Without a session, and from another site.
		const none = new Browser();
		expect((await none.post(`${base(DESK)}/emails/${taken.id}/unsend`)).status).toBe(401);
		expect((await none.post(`${base(DESK)}/emails/${taken.id}/reschedule`)).status).toBe(401);
		for (const path of ["unsend", "reschedule"]) {
			const foreign = await as("owner").fetch(`${base(DESK)}/emails/${taken.id}/${path}`, {
				method: "POST",
				body: "{}",
				headers: { origin: "https://elsewhere.test" },
			});
			expect(foreign.status, path).toBe(403);
		}
		expect(await stateOf(DESK, taken.id)).toEqual(before);
		expect((await as("owner").post(`${base(DESK)}/emails/${taken.id}/unsend`)).status).toBe(200);
	});

	it("a waiting message of another mailbox does not exist here", async () => {
		const theirs = await send("owner", OTHER, later());
		const before = await stateOf(OTHER, theirs.id);
		// The owner is a member of both: the id is looked up in the mailbox of the address.
		for (const path of ["unsend", "reschedule"]) {
			const res = await as("owner").post(`${base(DESK)}/emails/${theirs.id}/${path}`);
			expect(res.status, path).toBe(404);
		}
		expect(await stateOf(OTHER, theirs.id)).toEqual(before);
		expect((await as("owner").post(`${base(OTHER)}/emails/${theirs.id}/unsend`)).status).toBe(200);
	});
});

describe("Scheduled is entered and left only by sending", () => {
	it("every route that changes mail refuses a waiting message", async () => {
		const label = await json<{ id: string }>(
			await as("owner").post(`${base(DESK)}/labels`, { name: "Kept" }),
		);
		const draft = await json<{ id: string }>(
			await as("owner").post(`${base(DESK)}/drafts`, { to: "to@elsewhere.test", body: "x" }),
		);
		const declared = await json<{ id: string }>(
			await as("owner").post(`${base(DESK)}/drafts/${draft.id}/attachments`, {
				filename: "a.txt",
				type: "text/plain",
				size: 1,
			}),
		);
		const stored = await as("owner").fetch(
			`${base(DESK)}/drafts/${draft.id}/attachments/${declared.id}`,
			{ method: "PUT", body: "a" },
		);
		expect(stored.status).toBe(200);
		const taken = await send("owner", DESK, { draft_id: draft.id, ...later() });
		const id = taken.id;
		const before = await stateOf(DESK, id);
		const M = base(DESK);

		for (const folderId of ["trash", "archive", "inbox", "draft", "sent", "spam"]) {
			await waits(await as("owner").post(`${M}/emails/${id}/move`, { folderId }), folderId);
		}
		await waits(await del("owner", `${M}/emails/${id}`), "deleting it");
		await waits(await put("owner", `${M}/emails/${id}`, { read: false }), "marking it unread");
		await waits(await put("owner", `${M}/emails/${id}`, { starred: true }), "starring it");
		await waits(
			await put("owner", `${M}/emails/${id}/labels`, { add: [label.id], remove: [] }),
			"labelling it",
		);
		for (const change of [
			{ move: "trash" },
			{ move: "archive" },
			{ read: false },
			{ starred: true },
			{ labels: { add: [label.id] } },
		]) {
			for (const unit of ["conversation", "message"]) {
				await waits(
					await as("owner").post(`${M}/bulk`, { ids: [id], unit, change }),
					`a deed: ${JSON.stringify(change)}`,
				);
			}
			await waits(
				await as("owner").post(`${M}/bulk`, { filter: { folder: "scheduled" }, change }),
				"a deed on everything in Scheduled",
			);
		}
		// Named beside another message, the whole request is refused: nothing is changed.
		await waits(
			await as("owner").post(`${M}/bulk`, { ids: ["asked", id], change: { starred: true } }),
			"a deed that names it beside another",
		);
		expect((await stateOf(DESK, "asked")).row?.starred).toBe(0);

		// It is not a draft: saving over it, and its files, do not exist as a draft's.
		const saved = await put("owner", `${M}/drafts/${id}`, { subject: "Changed", body: "changed" });
		expect(saved.status).toBe(404);
		const more = await as("owner").post(`${M}/drafts/${id}/attachments`, {
			filename: "b.txt",
			type: "text/plain",
			size: 1,
		});
		expect(more.status).toBe(404);
		expect((await del("owner", `${M}/drafts/${id}/attachments/${declared.id}`)).status).toBe(404);
		// Scheduled cannot be emptied.
		const emptied = await as("owner").post(`${M}/folders/scheduled/empty`);
		expect(emptied.status).toBe(400);
		expect((await json<Refusal>(emptied)).code).toBe("NOT_EMPTIABLE");

		expect(await stateOf(DESK, id)).toEqual(before);
		expect(await bucket.head(`attachments/${id}/${declared.id}/a.txt`)).not.toBeNull();
		expect(await outOfPlace(DESK)).toEqual([]);
		expect((await as("owner").post(`${M}/emails/${id}/unsend`)).status).toBe(200);
		expect((await del("owner", `${M}/emails/${id}`)).status).toBe(204);
	});

	it("nothing can be moved into Scheduled", async () => {
		const M = base(DESK);
		const before = await stateOf(DESK, "asked");
		await waits(
			await as("owner").post(`${M}/emails/asked/move`, { folderId: "scheduled" }),
			"a move",
		);
		for (const body of [
			{ ids: ["asked"], change: { move: "scheduled" } },
			{ filter: { folder: "inbox" }, change: { move: "scheduled" } },
		]) {
			const res = await as("owner").post(`${M}/bulk`, body);
			expect(res.status).toBe(400);
		}
		// Not by a draft either: a draft goes there by being sent, and only then.
		const draft = await json<{ id: string }>(
			await as("owner").post(`${M}/drafts`, { to: "to@elsewhere.test", body: "x" }),
		);
		await waits(
			await as("owner").post(`${M}/emails/${draft.id}/move`, { folderId: "scheduled" }),
			"a draft",
		);
		expect(await placeOf(DESK, draft.id)).toBe("draft");
		expect(await stateOf(DESK, "asked")).toEqual(before);
		expect(await rowsOf(DESK, `SELECT id FROM emails WHERE folder_id = 'scheduled'`)).toEqual([]);
		expect((await del("owner", `${M}/emails/${draft.id}`)).status).toBe(204);
	});

	it("a deed on a conversation, or on everything a search finds, passes over the message that waits", async () => {
		const M = base(DESK);
		const reply = await as("owner").post(
			`${M}/emails/asked/reply`,
			message(DESK, { subject: "Re: A question", ...later() }),
		);
		expect(reply.status).toBe(202);
		const { id } = await json<Taken>(reply);
		const before = await stateOf(DESK, id);
		const label = await json<{ id: string }>(
			await as("owner").post(`${M}/labels`, { name: "Passed over" }),
		);

		// The conversation is starred, labelled and archived from the inbox: its waiting
		// answer is left as it is, and where it is.
		const done = await as("owner").post(`${M}/bulk`, {
			ids: ["asked"],
			change: { labels: { add: [label.id] }, move: "archive", read: false },
		});
		expect(done.status).toBe(200);
		expect((await stateOf(DESK, "asked")).row?.folder_id).toBe("archive");
		expect(await stateOf(DESK, id)).toEqual(before);

		// Everything a search finds, across places.
		const asked = await as("owner").post(`${M}/bulk`, {
			filter: { subject: "question" },
			change: { starred: true },
		});
		expect(asked.status).toBe(200);
		const counted = await json<{ deed: string }>(asked);
		const ran = await as("owner").post(`${M}/bulk/${counted.deed}/run`);
		expect(ran.status).toBe(200);
		const step = await json<{ skipped: { place: number }; more: boolean }>(ran);
		expect(step.skipped.place).toBe(1);
		expect(await stateOf(DESK, id)).toEqual(before);
		// Taking the deed back leaves it alone as well.
		expect((await as("owner").post(`${M}/bulk/${counted.deed}/undo`)).status).toBe(200);
		expect(await stateOf(DESK, id)).toEqual(before);

		expect((await as("owner").post(`${M}/emails/${id}/unsend`)).status).toBe(200);
		expect((await del("owner", `${M}/emails/${id}`)).status).toBe(204);
		await inMailbox(DESK, (sql) =>
			sql.exec(`UPDATE emails SET folder_id = 'inbox', read = 0 WHERE id = 'asked'`),
		);
	});

	it("is found by a search that names it, and by none that names no place it is in", async () => {
		const taken = await send("owner", DESK, { subject: "Findable later", ...later() });
		const found = async (query: string) =>
			(
				await json<{ emails: { id: string }[] }>(
					await as("owner").fetch(`${base(DESK)}/search?${query}`),
				)
			).emails.map((one) => one.id);
		expect(await found("folder=scheduled&query=Findable")).toEqual([taken.id]);
		expect(await found("folder=sent&query=Findable")).toEqual([]);
		expect(await found("folder=draft&query=Findable")).toEqual([]);
		expect((await as("owner").post(`${base(DESK)}/emails/${taken.id}/unsend`)).status).toBe(200);
		expect((await del("owner", `${base(DESK)}/emails/${taken.id}`)).status).toBe(204);
	});
});

describe("a deleted mailbox sends nothing", () => {
	it("leaves no row, no object and no alarm, and nothing is handed over afterwards", async () => {
		const address = "closing@example.com";
		expect((await createMailbox(as("owner").cookie, address)).status).toBe(201);
		const fake = await fakeSender(address);
		const M = base(address);
		const draft = await json<{ id: string }>(
			await as("owner").post(`${M}/drafts`, { to: "to@elsewhere.test", body: "x" }),
		);
		const declared = await json<{ id: string }>(
			await as("owner").post(`${M}/drafts/${draft.id}/attachments`, {
				filename: "plan.txt",
				type: "text/plain",
				size: 4,
			}),
		);
		const stored = await as("owner").fetch(`${M}/drafts/${draft.id}/attachments/${declared.id}`, {
			method: "PUT",
			body: "plan",
		});
		expect(stored.status).toBe(200);
		await send("owner", address, { draft_id: draft.id });
		await send("owner", address, later());
		// One that was handed over and never answered.
		const stuck = await send("owner", address);
		await inMailbox(address, (sql) =>
			sql.exec(
				`UPDATE submissions SET state = 'sending', started_at = ?1 WHERE email_id = ?2`,
				new Date().toISOString(),
				stuck.id,
			),
		);
		// The rail's question before deleting reads how many wait from here.
		const places = await json<{ id: string; waiting?: number }[]>(
			await as("owner").fetch(`${M}/folders`),
		);
		expect(places.find((place) => place.id === "scheduled")?.waiting).toBe(3);
		expect(await alarmOf(address)).not.toBeNull();
		expect(await bucket.head(`attachments/${draft.id}/${declared.id}/plan.txt`)).not.toBeNull();

		expect((await del("owner", M)).status).toBe(204);
		expect(await alarmOf(address)).toBeNull();
		expect(await rowsOf(address, `SELECT email_id FROM submissions`)).toEqual([]);
		expect(await rowsOf(address, `SELECT at FROM send_log`)).toEqual([]);
		expect(await rowsOf(address, `SELECT id FROM emails`)).toEqual([]);
		expect((await bucket.list({ prefix: `attachments/${draft.id}/` })).objects).toEqual([]);
		// The clock moves past every time: no alarm runs, and one run by hand finds nothing.
		expect(await wake(address)).toBe(false);
		await wakeNow(address);
		expect(fake.calls).toHaveLength(0);
		expect(await alarmOf(address)).toBeNull();
	});
});

describe("the mailbox's database", () => {
	it("gets the place and the tables from the release before it, with the caps seeded from Sent", async () => {
		const address = "upgraded@example.com";
		expect((await createMailbox(as("owner").cookie, address)).status).toBe(201);
		const fake = await fakeSender(address);
		// The state of the previous release: no Scheduled, no tables, and mail in Sent.
		await inMailbox(address, (sql, state) => {
			sql.exec(`DROP TABLE submissions`);
			sql.exec(`DROP TABLE send_log`);
			sql.exec(`DELETE FROM folders WHERE id = 'scheduled'`);
			sql.exec(`DELETE FROM d1_migrations WHERE name = '17_submissions'`);
			const sent = (id: string, ago: number, place = "sent") =>
				sql.exec(
					`INSERT INTO emails (id, folder_id, subject, sender, recipient, date, body, read) VALUES (?1, ?2, 'Old', ?3, 'to@elsewhere.test', ?4, 'x', 1)`,
					id,
					place,
					address,
					new Date(Date.now() - ago).toISOString(),
				);
			sent("an-hour-ago", HOUR);
			sent("this-morning", 10 * HOUR);
			sent("two-days-ago", 48 * HOUR);
			sent("received", MINUTE, "inbox");
			applyMigrations(sql, mailboxMigrations, state.storage);
		});
		// This record's migration is the seventeenth. The one after it is ADR-0008's
		// (test/workerd/rules.test.ts).
		expect(mailboxMigrations[16]?.name).toBe("17_submissions");

		// Nothing is rewritten: mail in Sent has no row and reads as sent.
		expect(await rowsOf(address, `SELECT email_id FROM submissions`)).toEqual([]);
		expect(await rowsOf(address, `SELECT id FROM emails WHERE folder_id = 'sent'`)).toHaveLength(3);
		const old = await as("owner").fetch(`${base(address)}/emails/an-hour-ago`);
		expect((await json<{ submission?: unknown }>(old)).submission).toBeUndefined();
		// The caps do not start over: what left in the last day is counted, and nothing else.
		const seeded = await rowsOf<{ at: string; kind: string }>(
			address,
			`SELECT at, kind FROM send_log ORDER BY at`,
		);
		expect(seeded.map((row) => row.kind)).toEqual(["person", "person"]);
		expect(Date.now() - Date.parse(seeded[0]?.at ?? "")).toBeGreaterThan(9 * HOUR);
		// The columns are the ones the record names.
		const columns = async (table: string) =>
			(await rowsOf<{ name: string }>(address, `SELECT name FROM pragma_table_info('${table}')`))
				.map((column) => column.name)
				.sort();
		expect(await columns("submissions")).toEqual(
			[
				"attempts",
				"email_id",
				"error",
				"requested_at",
				"requested_by",
				"retry_at",
				"send_at",
				"sent_at",
				"service_id",
				"started_at",
				"state",
			].sort(),
		);
		expect(await columns("send_log")).toEqual(["at", "kind"]);

		// And the mailbox sends: a message waits in the new place and leaves.
		const taken = await send("owner", address);
		expect(await placeOf(address, taken.id)).toBe("scheduled");
		await letLeave(address);
		expect(fake.calls).toHaveLength(1);
		expect((await submissionOf(address, taken.id))?.state).toBe("sent");
		expect(await rowsOf(address, `SELECT at FROM send_log`)).toHaveLength(3);
		// Run again, the migration changes nothing.
		await inMailbox(address, (sql, state) =>
			applyMigrations(sql, mailboxMigrations, state.storage),
		);
		expect(await rowsOf(address, `SELECT at FROM send_log`)).toHaveLength(3);
	});
});

describe("what a log line carries", () => {
	it("is ids, a state and a code: never the mail, an address or the service's words", async () => {
		const address = "quiet@example.com";
		expect((await createMailbox(as("owner").cookie, address)).status).toBe(201);
		const fake = await fakeSender(address);
		const MARK = "zebra-violet-marker";
		const lines: string[] = [];
		const keep = (line: unknown) => {
			lines.push(String(line));
		};
		const spies = [
			vi.spyOn(console, "log").mockImplementation(keep),
			vi.spyOn(console, "warn").mockImplementation(keep),
			vi.spyOn(console, "error").mockImplementation(keep),
		];
		try {
			const marked = {
				to: `${MARK}@elsewhere.test`,
				subject: `Subject ${MARK}`,
				html: `<p>Body ${MARK}</p>`,
			};
			// Each kind of end: refused for good, refused for now, no answer, an error without a
			// code, a check that fails at leaving, and sent.
			fake.next = [
				{ code: "E_RECIPIENT_SUPPRESSED", message: `${MARK}@elsewhere.test is suppressed` },
				{ code: "E_RATE_LIMIT_EXCEEDED", message: `slow down, ${MARK}` },
				"no-code",
				{ messageId: `<${MARK}@service.test>` },
			];
			const taken: Taken[] = [];
			for (let index = 0; index < 4; index++) taken.push(await send("owner", address, marked));
			await letLeave(address);
			const late = await send("owner", address, marked);
			await age(address, 25 * HOUR, `email_id = '${late.id}'`);
			await letLeave(address);
			expect(await submissionOf(address, late.id)).toMatchObject({
				state: "failed",
				error: "late",
			});
			expect(fake.calls).toHaveLength(4);
		} finally {
			for (const spy of spies) spy.mockRestore();
		}
		const about = lines.filter((line) => line.includes('"event":"send.'));
		// The handovers were logged, with the mailbox's object id and the message's id.
		expect(about.length).toBeGreaterThanOrEqual(5);
		expect(about.some((line) => line.includes("E_RECIPIENT_SUPPRESSED"))).toBe(true);
		expect(about.some((line) => line.includes('"reason":"unknown"'))).toBe(true);
		expect(about.some((line) => line.includes('"reason":"late"'))).toBe(true);
		for (const line of lines) {
			expect(line, line).not.toContain(MARK);
			expect(line, line).not.toContain(address);
			expect(line, line).not.toContain("elsewhere.test");
			expect(line, line).not.toContain("suppressed");
			expect(line, line).not.toContain("slow down");
		}
		for (const line of about) {
			const fields = Object.keys(JSON.parse(line) as object).sort();
			for (const field of fields) {
				expect(
					["attempt", "code", "event", "level", "mailbox", "message", "reason", "state"],
					line,
				).toContain(field);
			}
			expect(line).toContain(objectOf(address).id.toString());
		}
	});
});

describe("an open app is told", () => {
	it("when a message is taken, given a new time, taken back, leaves and fails", async () => {
		const address = "told@example.com";
		expect((await createMailbox(as("owner").cookie, address)).status).toBe(201);
		const fake = await fakeSender(address);
		const tab = await open(as("owner"), address);
		const mail = () => Number(tab.last.mail);
		const settle = () => new Promise((done) => setTimeout(done, 20));
		let seen = mail();
		const moved = async (what: string) => {
			await settle();
			expect(mail(), what).toBeGreaterThan(seen);
			seen = mail();
		};

		const taken = await send("owner", address, later());
		await moved("taken");
		const sooner = await as("owner").post(
			`${base(address)}/emails/${taken.id}/reschedule`,
			later(30 * MINUTE),
		);
		expect(sooner.status).toBe(200);
		await moved("given a new time");
		// The alarm writes too: it tells like any other write, and `delivery` is not its kind.
		const delivery = tab.last.delivery;
		await age(address, 31 * MINUTE);
		expect(await wake(address)).toBe(true);
		expect(await placeOf(address, taken.id)).toBe("sent");
		await moved("left");
		fake.next = [{ code: "E_ACCOUNT_SUSPENDED" }];
		const failing = await send("owner", address);
		await moved("taken");
		await letLeave(address);
		await moved("failed");
		expect((await as("owner").post(`${base(address)}/emails/${failing.id}/unsend`)).status).toBe(
			200,
		);
		await moved("the mark taken off");
		expect(tab.last.delivery).toBe(delivery);
		expect([tab.last.labels, tab.last.settings]).toEqual(["0", "0"]);

		// A run that finds nothing to do, and a refused request, tell nobody.
		const before = tab.texts.length;
		await wakeNow(address);
		expect((await as("owner").post(`${base(address)}/emails/no-such/unsend`)).status).toBe(404);
		await settle();
		expect(tab.texts.length).toBe(before);
		tab.socket.close(1000);
	});
});
