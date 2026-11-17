/**
 * Tier 3: one request acts on many conversations, and a list has an order (ADR-0014).
 *
 * Every case of the record's decision 24, and what the rest of it promises:
 * - a reader is refused and someone without a membership is told nothing, on all three routes;
 * - an id or a label of another mailbox does not exist here; a request over a limit, with an
 *   empty filter, or with Sent or Drafts as a target is refused and changes nothing;
 * - a line is a conversation in a place: a move takes the whole line, read and labels the
 *   conversation outside Spam and Trash, unread and a star the newest message of the line;
 * - a request with a filter only counts; running it needs the asking, in time, with a scope
 *   that did not grow; mail that arrives during a deed is left alone;
 * - a deed is taken back from the mailbox's record within the hour, never over a later change,
 *   and a message deleted for good leaves no row in that record;
 * - a filter deed is on the audit log when it starts and when it is undone, without the search;
 * - a list is ordered newest, unread or starred first, and the old sort parameters are gone.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { BULK_LIMITS } from "../../shared/bulk.ts";
import { LABEL_LIMITS } from "../../shared/labels.ts";
import { applyMigrations, mailboxMigrations } from "../../workers/durableObject/migrations.ts";
import {
	as,
	audit,
	label,
	mailbox,
	NO_DEED,
	NONE,
	people,
	type Refusal,
	type Seed,
} from "./bulk-helpers.ts";
import { json, seedMembership } from "./helpers.ts";

beforeAll(people);

describe("who may act on many conversations", () => {
	it("refuses a reader, tells a non-member nothing, and needs a session", async () => {
		const box = await mailbox("rights");
		const reader = (await as("reader").me()).id as string;
		await seedMembership(box.address, reader, "reader");
		await box.seed([{ id: "a" }, { id: "b" }]);
		const asked = await box.ask({ filter: { folder: "inbox" }, change: { move: "archive" } });
		const done = await box.act({ ids: ["b"], change: { starred: true } });
		const before = await box.state();

		for (const [who, status] of [
			["reader", 403],
			["outsider", 404],
			["nobody", 401],
		] as const) {
			const tries = [
				await box.bulk({ ids: ["a"], change: { move: "trash" } }, who),
				await box.bulk({ filter: { folder: "inbox" }, change: { read: true } }, who),
				await box.run(asked.deed, who),
				await box.undo(done.deed, who),
			];
			expect(
				tries.map((res) => res.status),
				who,
			).toEqual([status, status, status, status]);
		}
		expect(await box.state()).toEqual(before);
		// The deed that was asked for is still there for someone who may change mail.
		expect((await box.run(asked.deed)).status).toBe(200);
	});

	it("knows no message, label or deed of another mailbox", async () => {
		const box = await mailbox("mine");
		const other = await mailbox("theirs");
		await box.seed([{ id: "here" }]);
		await other.seed([{ id: "there" }]);
		const theirLabel = await label(other.base, "Theirs");
		const theirDeed = await other.ask({ filter: { folder: "inbox" }, change: { move: "trash" } });

		const step = await box.act({ ids: ["there", "here"], change: { move: "archive" } });
		expect(step).toMatchObject({
			conversations: 1,
			messages: 1,
			skipped: { ...NONE, not_found: 1 },
		});
		expect(await other.state()).toEqual({ there: "inbox" });

		const labelled = await box.bulk({ ids: ["here"], change: { labels: { add: [theirLabel] } } });
		expect(labelled.status).toBe(404);
		expect((await json<Refusal>(labelled)).code).toBe("NOT_FOUND");
		const filtered = await box.ask({ filter: { label: theirLabel }, change: { read: true } });
		expect(filtered).toMatchObject({ conversations: 0, messages: 0 });

		for (const call of [box.run(theirDeed.deed), box.undo(theirDeed.deed), box.run(NO_DEED)]) {
			const res = await call;
			expect(res.status).toBe(404);
			expect((await json<Refusal>(res)).code).toBe("NOT_FOUND");
		}
		expect(await box.state()).toEqual({ here: "archive" });
		expect(await other.state()).toEqual({ there: "inbox" });
	});
});

describe("what a request may ask", () => {
	it("is refused over each limit, without a scope or a change, and changes nothing", async () => {
		const box = await mailbox("limits");
		await box.seed([{ id: "a" }]);
		const ids = (count: number) => Array.from({ length: count }, (_value, n) => `m-${n}`);
		const labels = Array.from(
			{ length: BULK_LIMITS.labels + 1 },
			(_value, n) => `lbl_${String(n).padStart(24, "0")}`,
		);
		const long = "x".repeat(BULK_LIMITS.text + 1);
		const read = { read: true };

		const refused: [string, unknown][] = [
			["TOO_LARGE", { ids: ids(BULK_LIMITS.ids + 1), change: read }],
			["TOO_LARGE", { ids: ["x".repeat(BULK_LIMITS.idLength + 1)], change: read }],
			["TOO_LARGE", { ids: ["a"], change: { labels: { add: labels } } }],
			["TOO_LARGE", { filter: { query: long }, change: read }],
			["TOO_LARGE", { filter: { from: long }, change: read }],
			["EMPTY_FILTER", { filter: {}, change: read }],
			["EMPTY_FILTER", { filter: { query: "", has_attachment: false }, change: read }],
			["INVALID", { ids: ["a"], filter: { folder: "inbox" }, change: read }],
			["INVALID", { change: read }],
			["INVALID", { ids: ["a"], change: {} }],
			["INVALID", { ids: ["a"], change: { labels: { add: [], remove: [] } } }],
			["INVALID", { ids: ["a"], change: { labels: { add: [labels[0]], remove: [labels[0]] } } }],
			// Sent and Drafts are never a target; nothing is deleted for good or sent.
			["INVALID", { ids: ["a"], change: { move: "sent" } }],
			["INVALID", { ids: ["a"], change: { move: "draft" } }],
			["INVALID", { ids: ["a"], change: { move: "nowhere" } }],
			["INVALID", { ids: ["a"], change: { delete: true } }],
			["INVALID", { ids: ["a"], change: read, send: true }],
			["INVALID", { ids: ["a"], unit: "mailbox", change: read }],
			["INVALID", { filter: { body: "x" }, change: read }],
			["INVALID", null],
		];
		for (const [code, body] of refused) {
			const res = await box.bulk(body);
			expect(res.status, JSON.stringify(body).slice(0, 80)).toBe(400);
			expect((await json<Refusal>(res)).code, JSON.stringify(body).slice(0, 80)).toBe(code);
		}
		expect(await box.state()).toEqual({ a: "inbox" });
		expect(await box.sql((sql) => [...sql.exec(`SELECT id FROM deeds`)])).toEqual([]);

		// At the limit it is taken: a full page is one request.
		const full = await box.act({ ids: ["a", ...ids(BULK_LIMITS.ids - 1)], change: read });
		expect(full).toMatchObject({
			conversations: 1,
			messages: 1,
			skipped: { ...NONE, not_found: BULK_LIMITS.ids - 1 },
			more: false,
		});
	});
});

describe("a line is a conversation in a place", () => {
	it("moves the whole line, and leaves the rest of the conversation where it is", async () => {
		const box = await mailbox("lines");
		await box.seed([
			{ id: "talk-1", thread: "talk", ago: 50 },
			{ id: "talk-2", thread: "talk", ago: 40 },
			{ id: "talk-answer", thread: "talk", place: "sent", ago: 30, read: true },
			{ id: "talk-3", thread: "talk", ago: 20 },
			{ id: "other", ago: 10 },
		]);
		// The line is named by its newest message, as a list shows it.
		const step = await box.act({ ids: ["talk-3"], change: { move: "archive" } });
		expect(step).toMatchObject({ conversations: 1, messages: 3, skipped: NONE, more: false });
		expect(await box.state()).toEqual({
			"talk-1": "archive",
			"talk-2": "archive",
			"talk-3": "archive",
			"talk-answer": "sent r",
			other: "inbox",
		});
		const inbox = await json<{ emails: { id: string }[]; totalCount: number }>(
			await as("owner").fetch(`${box.base}/emails?folder=inbox&threaded=true`),
		);
		expect(inbox.emails.map((row) => row.id)).toEqual(["other"]);
		expect(inbox.totalCount).toBe(1);

		// Sent twice, it finds everything as asked and changes nothing.
		const again = await box.act({ ids: ["talk-3"], change: { move: "archive" } });
		expect(again).toMatchObject({ conversations: 0, messages: 0, skipped: NONE });

		// With conversations off a line is one message.
		const one = await box.act({ ids: ["talk-1"], unit: "message", change: { move: "inbox" } });
		expect(one).toMatchObject({ conversations: 1, messages: 1 });
		expect(await box.state()).toMatchObject({ "talk-1": "inbox", "talk-2": "archive" });
	});

	it("takes a line in Sent to Trash only, and moves no draft", async () => {
		const box = await mailbox("fixed");
		await box.seed([
			{ id: "sent-1", place: "sent", read: true },
			{ id: "draft-1", place: "draft", read: true },
			{ id: "in-1" },
		]);
		for (const move of ["archive", "inbox", "spam"]) {
			const step = await box.act({
				ids: ["sent-1", "draft-1", "gone"],
				change: { move, read: true },
			});
			expect(step, move).toMatchObject({
				conversations: 0,
				messages: 0,
				skipped: { not_found: 1, place: 2, label_limit: 0 },
			});
		}
		// A line that is left out is left out whole: the draft was not marked either.
		expect(await box.state()).toEqual({
			"sent-1": "sent r",
			"draft-1": "draft r",
			"in-1": "inbox",
		});

		const binned = await box.act({ ids: ["sent-1", "draft-1", "in-1"], change: { move: "trash" } });
		expect(binned).toMatchObject({ conversations: 2, messages: 2, skipped: { ...NONE, place: 1 } });
		expect(await box.state()).toEqual({
			"sent-1": "trash r",
			"draft-1": "draft r",
			"in-1": "trash",
		});

		// Undo puts the sent message back into Sent from the record: no request names Sent.
		expect(await box.back(binned.deed)).toEqual({ messages: 2, more: false });
		expect(await box.state()).toEqual({
			"sent-1": "sent r",
			"draft-1": "draft r",
			"in-1": "inbox",
		});
	});

	it("marks the conversation read, and gives unread and a star to the newest of the line", async () => {
		const box = await mailbox("marks");
		await box.seed([
			{ id: "c-1", thread: "c", ago: 50 },
			{ id: "c-2", thread: "c", ago: 40, place: "archive" },
			{ id: "c-3", thread: "c", ago: 30 },
			{ id: "c-bin", thread: "c", ago: 20, place: "trash" },
			{ id: "c-junk", thread: "c", ago: 10, place: "spam" },
		]);
		const act = async (body: unknown) => box.act(body);

		// Read: every message of the conversation outside Spam and Trash.
		expect(await act({ ids: ["c-1"], change: { read: true } })).toMatchObject({
			conversations: 1,
			messages: 3,
		});
		expect(await box.state()).toEqual({
			"c-1": "inbox r",
			"c-2": "archive r",
			"c-3": "inbox r",
			"c-bin": "trash",
			"c-junk": "spam",
		});
		// Unread and a star: one message, the newest of the line that was named.
		expect(await act({ ids: ["c-1"], change: { read: false, starred: true } })).toMatchObject({
			conversations: 1,
			messages: 1,
		});
		expect(await box.state()).toMatchObject({
			"c-1": "inbox r",
			"c-2": "archive r",
			"c-3": "inbox *",
		});
		// Taking the star takes it from the conversation.
		await box.sql((sql) => sql.exec(`UPDATE emails SET starred = 1`));
		expect(await act({ ids: ["c-3"], change: { starred: false } })).toMatchObject({ messages: 3 });
		expect(await box.state()).toEqual({
			"c-1": "inbox r",
			"c-2": "archive r",
			"c-3": "inbox",
			"c-bin": "trash *",
			"c-junk": "spam *",
		});
		// A line in Spam or Trash is marked by itself.
		expect(await act({ ids: ["c-junk"], change: { read: true, starred: false } })).toMatchObject({
			conversations: 1,
			messages: 1,
		});
		expect(await box.state()).toMatchObject({
			"c-junk": "spam r",
			"c-bin": "trash *",
			"c-3": "inbox",
		});
		// With conversations off a mark takes the named message alone.
		expect(await act({ ids: ["c-3"], unit: "message", change: { read: true } })).toMatchObject({
			conversations: 1,
			messages: 1,
		});
		expect(await act({ ids: ["c-1"], unit: "message", change: { read: false } })).toMatchObject({
			conversations: 1,
			messages: 1,
		});
		expect(await box.state()).toMatchObject({
			"c-1": "inbox",
			"c-2": "archive r",
			"c-3": "inbox r",
		});
	});

	it("labels the conversation outside Spam and Trash, and no line that is there", async () => {
		const box = await mailbox("labelled");
		await box.seed([
			{ id: "c-1", thread: "c", ago: 50 },
			{ id: "c-2", thread: "c", ago: 40, place: "archive" },
			{ id: "c-bin", thread: "c", ago: 20, place: "trash" },
			{ id: "junk", place: "spam" },
		]);
		const work = await label(box.base, "Work");
		const home = await label(box.base, "Home");

		const given = await box.act({
			ids: ["c-1", "junk", "c-bin"],
			change: { labels: { add: [work, home] } },
		});
		expect(given).toMatchObject({ conversations: 1, messages: 2, skipped: { ...NONE, place: 2 } });
		expect(await box.state()).toEqual({
			"c-1": "inbox Home Work",
			"c-2": "archive Home Work",
			"c-bin": "trash",
			junk: "spam",
		});
		// "Move to" a label is one deed: the label and the move together, with one record.
		const moved = await box.act({
			ids: ["c-1"],
			unit: "message",
			change: { labels: { remove: [home] }, move: "archive" },
		});
		// Labels stay the conversation's, also when a line is one message.
		expect(moved).toMatchObject({ conversations: 1, messages: 2 });
		expect(await box.state()).toMatchObject({ "c-1": "archive Work", "c-2": "archive Work" });
		expect(await box.back(moved.deed)).toEqual({ messages: 2, more: false });
		expect(await box.state()).toMatchObject({
			"c-1": "inbox Home Work",
			"c-2": "archive Home Work",
		});
	});

	it("leaves out a conversation that would carry a label too many", async () => {
		const box = await mailbox("crowded");
		await box.seed([{ id: "full" }, { id: "light" }]);
		await box.sql((sql) => {
			for (let n = 0; n < LABEL_LIMITS.perMessage + 1; n++) {
				const id = `lbl_${String(n).padStart(24, "0")}`;
				sql.exec(
					`INSERT INTO labels (id, name, color, created_at) VALUES (?, ?, 0, 'x')`,
					id,
					`L${n}`,
				);
				if (n < LABEL_LIMITS.perMessage) {
					sql.exec(`INSERT INTO email_labels (email_id, label_id) VALUES ('full', ?)`, id);
				}
			}
		});
		const first = `lbl_${"0".repeat(24)}`;
		const extra = `lbl_${String(LABEL_LIMITS.perMessage).padStart(24, "0")}`;
		const step = await box.act({
			ids: ["full", "light"],
			change: { labels: { add: [extra] }, read: true },
		});
		expect(step).toMatchObject({
			conversations: 1,
			messages: 1,
			skipped: { ...NONE, label_limit: 1 },
		});
		const carried = (id: string) =>
			box.sql(
				(sql) =>
					[...sql.exec(`SELECT COUNT(*) AS n FROM email_labels WHERE email_id = ?`, id)][0]?.n,
			);
		expect(await carried("full")).toBe(LABEL_LIMITS.perMessage);
		expect((await box.state()).full?.startsWith("inbox L0")).toBe(true);
		// One taken and one given in the same change fits.
		const swapped = await box.act({
			ids: ["full"],
			change: { labels: { add: [extra], remove: [first] } },
		});
		expect(swapped).toMatchObject({ conversations: 1, messages: 1, skipped: NONE });
		expect(await carried("full")).toBe(LABEL_LIMITS.perMessage);
	});
});

describe("everything a filter finds", () => {
	it("is only counted by the request, and acted on by a second call that names the deed", async () => {
		const box = await mailbox("asking");
		await box.seed([
			{ id: "t-1", thread: "t", ago: 50, subject: "Invoice March" },
			{ id: "t-2", thread: "t", ago: 40, subject: "Re: Invoice March" },
			{ id: "solo", ago: 30, subject: "Invoice April" },
			{ id: "kept", ago: 20, subject: "Lunch" },
			{ id: "filed", place: "archive", ago: 15, subject: "Invoice 2025" },
			{ id: "binned", place: "trash", ago: 10, subject: "Invoice (old)" },
			{ id: "junk", place: "spam", ago: 5, subject: "Invoice!!!" },
		]);
		const before = await box.state();
		const filter = { query: "Invoice" };

		const asked = await box.ask({ filter, change: { read: true } });
		// A filter that names no place leaves out what is in Spam and Trash.
		expect(asked).toMatchObject({ conversations: 3, messages: 4 });
		expect(asked.more).toBeUndefined();
		expect(asked.deed).toMatch(/^deed_[0-9a-f]{24}$/);
		expect(await box.state()).toEqual(before);
		expect(await audit(box.address)).toEqual([]);

		// What the deed takes is what the search route lists for the same words.
		const listed = await json<{ emails: { id: string }[] }>(
			await as("owner").fetch(`${box.base}/search?query=Invoice`),
		);
		expect(listed.emails.map((row) => row.id).sort()).toEqual(["filed", "solo", "t-1", "t-2"]);

		const step = await box.step(asked.deed);
		expect(step).toEqual({
			deed: asked.deed,
			conversations: 3,
			messages: 4,
			skipped: NONE,
			more: false,
		});
		expect(await box.state()).toEqual({
			"t-1": "inbox r",
			"t-2": "inbox r",
			solo: "inbox r",
			kept: "inbox",
			filed: "archive r",
			binned: "trash",
			junk: "spam",
		});
		// Sent again, the step has nothing left and does nothing twice.
		expect(await box.step(asked.deed)).toMatchObject({
			conversations: 0,
			messages: 0,
			more: false,
		});

		// It is on the record once: who, which mailbox, which change, how many; not the search.
		const rows = await audit(box.address);
		expect(rows.map((row) => row.action)).toEqual(["mailbox.bulk"]);
		expect(rows[0]?.actor_user_id).toBe((await as("owner").me()).id);
		expect(JSON.parse(rows[0]?.detail ?? "{}")).toEqual({
			deed: asked.deed,
			change: { read: true },
			conversations: 3,
			messages: 4,
		});
		expect(rows[0]?.detail).not.toContain("Invoice");

		// Asked there, what is in Trash is found: the line is marked by itself.
		const there = await box.ask({ filter: { ...filter, folder: "trash" }, change: { read: true } });
		expect(there).toMatchObject({ conversations: 1, messages: 1 });
		// A deed on a ticked page is not recorded.
		await box.bulk({ ids: ["kept"], change: { read: true } });
		expect(await audit(box.address)).toHaveLength(1);
	});

	it("is not run without the asking, too late, or after the scope grew", async () => {
		const box = await mailbox("guarded");
		await box.seed([{ id: "a" }, { id: "b" }, { id: "elsewhere", place: "archive", ago: 90 }]);
		const before = await box.state();
		const ask = async () => box.ask({ filter: { folder: "inbox" }, change: { move: "trash" } });
		const refused = async (deed: string, status: number, code: string) => {
			const res = await box.run(deed);
			expect(res.status).toBe(status);
			expect((await json<Refusal>(res)).code).toBe(code);
		};

		// Without asking: no call names a filter and acts.
		await refused(NO_DEED, 404, "NOT_FOUND");
		await refused("inbox", 404, "NOT_FOUND");
		// A deed on ticked lines is done; it is not one that runs.
		const ticked = await box.act({ ids: ["a"], change: { read: false } });
		await refused(ticked.deed, 404, "NOT_FOUND");

		// Too late: asked more than ten minutes ago.
		const late = await ask();
		await box.sql((sql) =>
			sql.exec(
				`UPDATE deeds SET asked_at = ? WHERE id = ?`,
				new Date(Date.now() - BULK_LIMITS.startWithinMs - 1000).toISOString(),
				late.deed,
			),
		);
		await refused(late.deed, 409, "DEED_LATE");

		// The scope grew: a conversation that was there when it was asked came into the place.
		const grown = await ask();
		expect(grown.conversations).toBe(2);
		await box.sql((sql) =>
			sql.exec(`UPDATE emails SET folder_id = 'inbox' WHERE id = 'elsewhere'`),
		);
		await refused(grown.deed, 409, "SCOPE_GREW");
		await box.sql((sql) =>
			sql.exec(`UPDATE emails SET folder_id = 'archive' WHERE id = 'elsewhere'`),
		);
		expect(await box.state()).toEqual(before);
		expect(await audit(box.address)).toEqual([]);

		// A scope that shrank is no reason to refuse, and asking again works.
		await box.sql((sql) => sql.exec(`UPDATE emails SET folder_id = 'archive' WHERE id = 'b'`));
		expect(await box.step(grown.deed)).toMatchObject({
			conversations: 1,
			messages: 1,
		});
		expect(await box.state()).toEqual({ a: "trash", b: "archive", elsewhere: "archive" });
	});

	it("goes in steps of 500 found messages, leaves what arrived, and is taken back in steps", async () => {
		const box = await mailbox("large");
		const total = BULK_LIMITS.step * 2 + 203;
		const old: Seed[] = Array.from({ length: total }, (_value, n) => ({
			id: `old-${String(n).padStart(4, "0")}`,
			ago: 600,
		}));
		// The first line is a conversation of three, one of them the oldest message of all.
		await box.seed([
			...old,
			{ id: "pair-b", thread: "old-0000", ago: 300 },
			{ id: "pair-c", thread: "old-0000", ago: 200 },
		]);
		const asked = await box.ask({
			filter: { folder: "inbox" },
			change: { move: "archive", read: true },
		});
		expect(asked).toMatchObject({ conversations: total, messages: total + 2 });

		// A budget for one step on the largest mailbox the tests build (rule D13, decision 17).
		const started = Date.now();
		const first = await box.step(asked.deed);
		expect(Date.now() - started).toBeLessThan(5_000);
		expect(first).toMatchObject({ conversations: BULK_LIMITS.step, more: true, skipped: NONE });
		// The line of the first found message went whole, with its two later messages.
		expect(first.messages).toBe(BULK_LIMITS.step + 2);

		// Mail that arrives while the deed runs: new conversations, and one more message in a
		// conversation the deed has not reached yet.
		await box.seed([
			{ id: "new-1", ago: -1 },
			{ id: "new-2", ago: -1 },
			{ id: "new-in-old", thread: `old-${String(total - 1).padStart(4, "0")}`, ago: -1 },
		]);

		let changed = first.messages;
		let conversations = first.conversations;
		let answer = first;
		let calls = 1;
		while (answer.more && calls < 10) {
			answer = await box.step(asked.deed);
			// What arrived is not even found: it is no line that was left out.
			expect(answer.skipped).toEqual(NONE);
			changed += answer.messages;
			conversations += answer.conversations;
			calls += 1;
		}
		expect(calls).toBe(3);
		expect(answer.more).toBe(false);
		expect(changed).toBe(total + 2);
		expect(conversations).toBe(total);

		const after = await box.state();
		const where = (place: string) =>
			Object.values(after).filter((value) => value.startsWith(place));
		expect(where("archive")).toHaveLength(total + 2);
		expect(after).toMatchObject({ "new-1": "inbox", "new-2": "inbox", "new-in-old": "inbox" });
		expect(where("inbox")).toHaveLength(3);

		// Taken back in steps like the deed, from the record; what arrived is not touched.
		const undone: number[] = [];
		let back = { messages: 0, more: true };
		while (back.more && undone.length < 10) {
			back = await box.back(asked.deed);
			undone.push(back.messages);
		}
		expect(undone).toEqual([BULK_LIMITS.step, BULK_LIMITS.step, 205]);
		const restored = await box.state();
		expect(Object.values(restored).filter((value) => value === "inbox")).toHaveLength(total + 5);
		expect(
			await box.sql((sql) => [...sql.exec(`SELECT COUNT(*) AS n FROM deed_changes`)][0]?.n),
		).toBe(0);

		const rows = await audit(box.address);
		expect(rows.map((row) => row.action)).toEqual(["mailbox.bulk", "mailbox.bulk_undone"]);
		expect(JSON.parse(rows[1]?.detail ?? "{}")).toEqual({
			deed: asked.deed,
			change: { move: "archive", read: true },
			conversations: total,
			messages: total + 2,
		});
		// A deed that was taken back runs no further step, and is not taken back twice.
		const rerun = await box.run(asked.deed);
		expect(rerun.status).toBe(409);
		expect((await json<Refusal>(rerun)).code).toBe("DEED_UNDONE");
		expect(await box.back(asked.deed)).toEqual({ messages: 0, more: false });
		expect(await audit(box.address)).toHaveLength(2);
	});

	it("can be stopped where it is: what was done stays done and can be taken back", async () => {
		const box = await mailbox("stopped");
		await box.seed(
			Array.from({ length: BULK_LIMITS.step + 10 }, (_value, n) => ({
				id: `m-${String(n).padStart(4, "0")}`,
			})),
		);
		const asked = await box.ask({ filter: { folder: "inbox" }, change: { move: "trash" } });
		expect(await box.step(asked.deed)).toMatchObject({
			messages: BULK_LIMITS.step,
			more: true,
		});
		// The page is left here. Undo takes back the step that ran, and the deed ends.
		expect(await box.back(asked.deed)).toEqual({
			messages: BULK_LIMITS.step,
			more: false,
		});
		expect(Object.values(await box.state()).every((value) => value === "inbox")).toBe(true);
		expect((await box.run(asked.deed)).status).toBe(409);
	});
});

describe("taking a deed back", () => {
	it("puts back what is still as the deed left it, and nothing that was changed since", async () => {
		const box = await mailbox("undo");
		await box.seed([
			{ id: "still", starred: true },
			{ id: "moved-on" },
			{ id: "read-again" },
			{ id: "relabelled" },
		]);
		const work = await label(box.base, "Work");
		const done = await box.act({
			ids: ["still", "moved-on", "read-again", "relabelled"],
			change: { move: "archive", read: true, starred: false, labels: { add: [work] } },
		});
		expect(done).toMatchObject({ conversations: 4, messages: 4 });
		expect(await box.state()).toMatchObject({
			still: "archive r Work",
			relabelled: "archive r Work",
		});

		// Since then: one was moved, one marked unread, one lost the label again.
		const put = (path: string, body: unknown) =>
			as("owner").fetch(`${box.base}${path}`, { method: "PUT", body: JSON.stringify(body) });
		expect(
			(await as("owner").post(`${box.base}/emails/moved-on/move`, { folderId: "trash" })).status,
		).toBe(200);
		expect((await put("/emails/read-again", { read: false })).status).toBe(200);
		expect((await put("/emails/relabelled/labels", { add: [], remove: [work] })).status).toBe(200);

		expect(await box.back(done.deed)).toEqual({ messages: 1, more: false });
		expect(await box.state()).toEqual({
			still: "inbox *",
			"moved-on": "trash r Work",
			"read-again": "archive Work",
			relabelled: "archive r",
		});
		// The record is used up: a second undo finds nothing.
		expect(await box.back(done.deed)).toEqual({ messages: 0, more: false });
	});

	it("keeps no row of a message that is deleted for good", async () => {
		const box = await mailbox("forgotten");
		await box.seed([{ id: "gone" }, { id: "emptied" }, { id: "stays" }]);
		const done = await box.act({
			ids: ["gone", "emptied", "stays"],
			change: { move: "trash", read: true },
		});
		const recorded = () =>
			box.sql((sql) =>
				[...sql.exec(`SELECT DISTINCT email_id FROM deed_changes ORDER BY email_id`)].map(
					(row) => row.email_id,
				),
			);
		expect(await recorded()).toEqual(["emptied", "gone", "stays"]);

		expect((await as("owner").fetch(`${box.base}/emails/gone`, { method: "DELETE" })).status).toBe(
			204,
		);
		expect(await recorded()).toEqual(["emptied", "stays"]);

		await box.sql((sql) => sql.exec(`UPDATE emails SET folder_id = 'inbox' WHERE id = 'stays'`));
		expect((await as("owner").post(`${box.base}/folders/trash/empty`)).status).toBe(200);
		expect(await recorded()).toEqual(["stays"]);
		// What is left of the record is the place and the marks a message had: no content.
		expect(
			await box.sql((sql) => [...sql.exec(`SELECT kind, was FROM deed_changes ORDER BY kind`)]),
		).toEqual([
			{ kind: "place", was: "inbox" },
			{ kind: "read", was: "0" },
		]);
		expect(await box.back(done.deed)).toEqual({ messages: 0, more: false });
	});

	it("is possible for an hour, and the record goes when the next deed begins after it", async () => {
		const box = await mailbox("hour");
		await box.seed([{ id: "a" }, { id: "b" }]);
		const old = await box.act({ ids: ["a"], change: { move: "archive" } });
		const recent = await box.act({ ids: ["b"], change: { move: "archive" } });
		const over = new Date(Date.now() - BULK_LIMITS.keptForMs - 1000).toISOString();
		await box.sql((sql) =>
			sql.exec(`UPDATE deeds SET asked_at = ?1, started_at = ?1 WHERE id = ?2`, over, old.deed),
		);

		const refused = await box.undo(old.deed);
		expect(refused.status).toBe(409);
		expect((await json<Refusal>(refused)).code).toBe("UNDO_EXPIRED");
		expect(await box.state()).toEqual({ a: "archive", b: "archive" });

		const deeds = () =>
			box.sql((sql) => ({
				deeds: [...sql.exec(`SELECT id FROM deeds ORDER BY asked_at`)].map((row) => row.id),
				changes: [...sql.exec(`SELECT DISTINCT deed_id FROM deed_changes`)].map(
					(row) => row.deed_id,
				),
			}));
		expect((await deeds()).changes.sort()).toEqual([old.deed, recent.deed].sort());
		const next = await box.act({ ids: ["a"], change: { read: true } });
		expect(await deeds()).toEqual({
			deeds: [recent.deed, next.deed],
			changes: expect.arrayContaining([recent.deed, next.deed]),
		});
		expect((await deeds()).changes).toHaveLength(2);
		expect((await box.undo(old.deed)).status).toBe(404);
		expect(await box.back(recent.deed)).toEqual({ messages: 1, more: false });
	});

	it("comes with the mailbox's database from the release before it", async () => {
		const box = await mailbox("upgraded");
		await box.seed([{ id: "kept" }]);
		// The state of the previous release: no record of deeds.
		await box.sql((sql, storage) => {
			sql.exec(`DROP TABLE deed_changes`);
			sql.exec(`DROP TABLE deeds`);
			sql.exec(`DELETE FROM d1_migrations WHERE name = '13_deeds'`);
			applyMigrations(sql, mailboxMigrations, storage);
		});
		expect(await box.state()).toEqual({ kept: "inbox" });
		const done = await box.act({ ids: ["kept"], change: { starred: true } });
		expect(done).toMatchObject({ conversations: 1, messages: 1 });
		expect(await box.back(done.deed)).toEqual({ messages: 1, more: false });
	});
});

describe("the order of a list", () => {
	it("is newest first, or unread or starred conversations first, by the request", async () => {
		const box = await mailbox("order");
		await box.seed([
			{ id: "starred-old", ago: 50, read: true, starred: true },
			{ id: "unread-mid", ago: 40 },
			// A conversation whose older message is unread and starred, and whose newest is not.
			{ id: "talk-1", thread: "talk", ago: 30, starred: true },
			{ id: "talk-2", thread: "talk", ago: 20, read: true },
			{ id: "read-new", ago: 10, read: true },
		]);
		const ids = async (path: string) => {
			const res = await as("owner").fetch(`${box.base}/${path}`);
			expect(res.status, path).toBe(200);
			const body = await json<{ emails: { id: string }[] } | { id: string }[]>(res);
			return (Array.isArray(body) ? body : body.emails).map((row) => row.id);
		};

		const lines = "emails?folder=inbox&threaded=true";
		expect(await ids(lines)).toEqual(["read-new", "talk-2", "unread-mid", "starred-old"]);
		expect(await ids(`${lines}&order=newest`)).toEqual(await ids(lines));
		expect(await ids(`${lines}&order=unread`)).toEqual([
			"talk-2",
			"unread-mid",
			"read-new",
			"starred-old",
		]);
		expect(await ids(`${lines}&order=starred`)).toEqual([
			"talk-2",
			"starred-old",
			"read-new",
			"unread-mid",
		]);

		// Without conversations, and in a search, each message goes by its own marks.
		const newest = ["read-new", "talk-2", "talk-1", "unread-mid", "starred-old"];
		const unread = ["talk-1", "unread-mid", "read-new", "talk-2", "starred-old"];
		const starred = ["talk-1", "starred-old", "read-new", "talk-2", "unread-mid"];
		for (const list of ["emails?folder=inbox", "search?folder=inbox"]) {
			expect(await ids(list), list).toEqual(newest);
			expect(await ids(`${list}&order=unread`), list).toEqual(unread);
			expect(await ids(`${list}&order=starred`), list).toEqual(starred);
		}

		// A value that names no order is refused, not guessed.
		for (const list of [lines, "emails?folder=inbox", "search?folder=inbox"]) {
			for (const bad of ["oldest", "date", "NEWEST", "starred%20DESC"]) {
				const res = await as("owner").fetch(`${box.base}/${list}&order=${bad}`);
				expect(res.status, `${list} ${bad}`).toBe(400);
			}
		}
		// The parameters that sorted by a column are gone: they change nothing.
		expect(await ids("emails?folder=inbox&sortColumn=subject&sortDirection=ASC")).toEqual(newest);
		expect(await ids("emails?folder=inbox&sortColumn=date&sortDirection=asc")).toEqual(newest);
	});
});
