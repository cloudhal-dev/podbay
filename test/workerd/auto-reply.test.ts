/**
 * Tier 3: the automatic reply (ADR-0008, decisions 8 to 10; boundaries B1 and B6; RFC 3834).
 * It is mail sent because mail from a stranger arrived, so every line of the record is a test
 * here, with a send binding of the tests that counts every call:
 *
 * - it leaves by the one function that lets mail leave, as the mailbox, counted as `auto`;
 * - never to a message with `Auto-Submitted` other than `no`;
 * - never unless the mailbox's address is in To or Cc;
 * - never to mail filed in Spam or Trash, or from a blocked sender;
 * - never to a list or bulk mail, a bounce, a program's address or the mailbox itself;
 * - to the envelope sender only, whatever From and Reply-To say;
 * - once for a sender in seven days;
 * - marked `Auto-Submitted: auto-replied`, with none of the incoming message in it;
 * - under caps of its own, below the mailbox's; and not at all when the mailbox's are full;
 * - it teaches the mailbox no address, and is nobody's draft when it does not leave;
 * - whatever it does, the message that arrived is stored.
 *
 * Saving it, and the right of the person who saved it, are in `auto-reply-standing.test.ts`.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AUTO_REPLY } from "../../modules/mail/shared/rules.ts";
import {
	aMailboxThatAnswers,
	answered,
	arrives,
	DAY,
	kept,
	on,
	REPLY,
	read,
	sender,
	waiting,
} from "./auto-reply-helpers.ts";
import { json, mime } from "./helpers.ts";
import { stoppedAt } from "./original-helpers.ts";
import { as, DESK, deliver, ids, inMailbox, M, rows, stored } from "./rules-helpers.ts";
import { age, type FakeSender, letLeave, MINUTE } from "./sending-helpers.ts";

aMailboxThatAnswers();
let fake: FakeSender;
beforeAll(() => {
	fake = sender.fake;
});

describe("the automatic reply of a mailbox", () => {
	it("is off until someone turns it on, and then nothing is sent for mail that arrives", async () => {
		expect(await read()).toEqual({
			isEnabled: false,
			fromDate: null,
			toDate: null,
			subject: null,
			textBody: null,
			htmlBody: null,
			stopped: false,
		});
		expect(await arrives("Before it is on")).toMatchObject({ folder_id: "inbox" });
		expect(fake.calls).toEqual([]);
	});

	it("leaves by the mailbox's one way out, as the mailbox, marked and counted as automatic", async () => {
		await on();
		expect(await arrives("Are you there?")).toMatchObject({ folder_id: "inbox", read: 0 });
		expect(fake.calls).toEqual([
			{
				to: ["ada@sender.test"],
				from: DESK,
				subject: "Away until Monday",
				html: '<div style="white-space:pre-wrap">I am away and will answer when I am back.</div>',
				text: "I am away and will answer when I am back.",
				headers: { "Auto-Submitted": "auto-replied" },
			},
		]);
		// It went the way of every message: a row that waited, was handed over once and is in Sent.
		expect(await rows(`SELECT kind FROM send_log`)).toEqual([{ kind: "auto" }]);
		expect(
			await rows(
				`SELECT e.folder_id, s.state FROM submissions s JOIN emails e ON e.id = s.email_id`,
			),
		).toEqual([{ folder_id: "sent", state: "sent" }]);
		expect(await rows(`SELECT sender FROM auto_reply_log`)).toEqual([
			{ sender: "ada@sender.test" },
		]);
	});

	it("uses a subject of its own when none was given, and the HTML body when there is one", async () => {
		await on({
			...REPLY,
			subject: null,
			textBody: "Away, in HTML.",
			htmlBody: "<p>Away, in <b>HTML</b>.</p>",
		});
		await arrives("Hello");
		expect(fake.calls[0]).toMatchObject({
			subject: AUTO_REPLY.defaultSubject,
			html: "<p>Away, in <b>HTML</b>.</p>",
		});
	});

	it("answers only between its dates", async () => {
		await on({ ...REPLY, fromDate: new Date(Date.now() + DAY).toISOString() });
		await arrives("Too early");
		await on({ ...REPLY, toDate: new Date(Date.now() - 1000).toISOString() });
		await arrives("Too late", {}, "late@sender.test");
		expect(fake.calls).toEqual([]);
		await on({
			...REPLY,
			fromDate: new Date(Date.now() - DAY).toISOString(),
			toDate: new Date(Date.now() + DAY).toISOString(),
		});
		await arrives("In time", {}, "in-time@sender.test");
		expect(answered()).toEqual(["in-time@sender.test"]);
	});

	it("is not sent once it is turned off", async () => {
		await on();
		await on({ ...REPLY, isEnabled: false });
		await arrives("After it was turned off");
		expect(fake.calls).toEqual([]);
	});

	it("keeps no stranger's address once it is turned off", async () => {
		await on();
		await arrives("While it is on", {}, "kept@sender.test");
		expect(await rows(`SELECT sender FROM auto_reply_log`)).toEqual([
			{ sender: "kept@sender.test" },
		]);
		await on({ ...REPLY, isEnabled: false });
		expect(await rows(`SELECT 1 FROM auto_reply_log`)).toEqual([]);
		// Turned on again it is a new absence, and the same sender is answered once more.
		await on();
		await arrives("After it is on again", {}, "kept@sender.test");
		expect(answered()).toEqual(["kept@sender.test", "kept@sender.test"]);
	});
});

describe("who never gets one (decision 9; RFC 3834)", () => {
	beforeEach(() => on());

	it.each([
		"auto-replied",
		"auto-generated",
		"AUTO-Replied",
		'auto-notified; owner-email="a@b.test"',
		"yes",
	])("a message with Auto-Submitted: %s", async (value) => {
		expect(await arrives("From a program", { "Auto-Submitted": value })).toMatchObject({
			folder_id: "inbox",
		});
		expect(fake.calls).toEqual([]);
		expect(await waiting()).toEqual([]);
	});

	it("but a message that says Auto-Submitted: no is answered", async () => {
		await arrives("From a person", { "Auto-Submitted": "no" });
		expect(answered()).toEqual(["ada@sender.test"]);
	});

	it("a message that does not name the mailbox in To or Cc", async () => {
		await arrives("Blind copy", { To: "someone@else.test" });
		await arrives("To a list", { To: "everyone@lists.test", Cc: "more@lists.test" });
		await arrives("A lookalike", { To: `not-${DESK}`, Cc: `${DESK}.evil.test` });
		const noTo = await deliver(`From: ada@sender.test\r\nSubject: No To at all\r\n\r\nHello\r\n`);
		expect(noTo).toEqual({ rejections: [], threw: null });
		await letLeave(DESK);
		// Each was delivered all the same: only the reply is withheld.
		expect(await stored("No To at all")).toMatchObject({ folder_id: "inbox" });
		expect(fake.calls).toEqual([]);
	});

	it("but a message that names the mailbox in Cc is answered", async () => {
		await arrives("Copied in", { To: "someone@else.test", Cc: `Desk <${DESK.toUpperCase()}>` });
		expect(answered()).toEqual(["ada@sender.test"]);
	});

	it("an envelope sender that is blocked, whatever From names", async () => {
		for (const sender of ["ada@sender.test", "@blocked.test"]) {
			expect((await as("owner").post(`${M}/blocked-senders`, { sender })).status).toBe(201);
		}
		// From decides where a message is filed, so these stay in the Inbox; the reply would go to
		// the envelope sender, and that address, or its domain, is blocked.
		const from = { From: "Bea <bea@other.test>" };
		expect(await arrives("Under another name", from, "ada@sender.test")).toMatchObject({
			folder_id: "inbox",
		});
		expect(await arrives("From a blocked domain", from, "cy@blocked.test")).toMatchObject({
			folder_id: "inbox",
		});
		expect(fake.calls).toEqual([]);
		expect(await waiting()).toEqual([]);
		expect(await rows(`SELECT sender FROM auto_reply_log`)).toEqual([]);
		// Control: an envelope sender that is not blocked is answered.
		await arrives("From someone else", from, "dee@sender.test");
		expect(answered()).toEqual(["dee@sender.test"]);
	});

	it("mail from a blocked sender, and mail a rule filed in Spam or Trash", async () => {
		expect(
			(await as("owner").post(`${M}/blocked-senders`, { sender: "ada@sender.test" })).status,
		).toBe(201);
		expect(await arrives("From the blocked")).toMatchObject({ folder_id: "spam" });
		await inMailbox((sql) => sql.exec(`DELETE FROM rules WHERE kind = 'block'`));
		const rules = [
			{ conditions: { subject: "lottery" }, actions: { place: "spam" } },
			{ conditions: { subject: "newsletter" }, actions: { place: "trash" } },
			{ conditions: { subject: "receipt" }, actions: { place: "archive" } },
		];
		expect(
			(await as("owner").fetch(`${M}/rules`, { method: "PUT", body: JSON.stringify({ rules }) }))
				.status,
		).toBe(200);
		expect(await arrives("The lottery", {}, "one@sender.test")).toMatchObject({
			folder_id: "spam",
		});
		expect(await arrives("A newsletter", {}, "two@sender.test")).toMatchObject({
			folder_id: "trash",
		});
		expect(fake.calls).toEqual([]);
		// Mail a rule only archived is still mail the person will read: it is answered.
		expect(await arrives("A receipt", {}, "three@sender.test")).toMatchObject({
			folder_id: "archive",
		});
		expect(answered()).toEqual(["three@sender.test"]);
	});

	it.each([
		["List-Id", "<news.lists.test>"],
		["List-Unsubscribe", "<https://lists.test/leave>"],
		["List-Post", "<mailto:news@lists.test>"],
		["Precedence", "bulk"],
		["Precedence", "list"],
		["Precedence", "Junk"],
	])("mail of a list or bulk mail (%s: %s)", async (name, value) => {
		await arrives("From a list", { [name]: value });
		expect(fake.calls).toEqual([]);
	});

	it.each([
		["a bounce, which has no envelope sender", ""],
		["a bounce with an empty sender in brackets", "<>"],
		["the mail system", "MAILER-DAEMON@sender.test"],
		["the owner of a list", "owner-news@sender.test"],
		["the door of a list", "news-request@sender.test"],
		["something that is not one address", "ada@sender.test, grace@sender.test"],
		["the mailbox itself", DESK],
		// Routing delivers name+anything@domain to name@domain: that is the mailbox too.
		["the mailbox itself under a tag", "desk+away@example.com"],
		["the mailbox itself under a tag, in capitals", "DESK+Away@Example.COM"],
	])("%s", async (_what, envelope) => {
		expect(await arrives("Nobody to answer", {}, envelope)).toMatchObject({ folder_id: "inbox" });
		expect(fake.calls).toEqual([]);
		expect(await rows(`SELECT * FROM auto_reply_log`)).toEqual([]);
	});

	it("a message that could not be read: nothing is known of it", async () => {
		// Two things hold this: only a parsed message is asked about at all, and a message that
		// could not be read names no recipient. Each alone keeps the reply from being made.
		const open = Array.from(
			{ length: 300 },
			(_one, n) => `Content-Type: multipart/mixed; boundary="b${n}"\r\n\r\n--b${n}\r\n`,
		).join("");
		const raw = `From: ada@sender.test\r\nTo: ${DESK}\r\nSubject: Too deep\r\n${open}Content-Type: text/plain\r\n\r\nx\r\n`;
		expect(await deliver(raw, { from: "deep@sender.test" })).toEqual({
			rejections: [],
			threw: null,
		});
		await letLeave(DESK);
		expect(await rows(`SELECT unparsed FROM emails WHERE sender = 'deep@sender.test'`)).toEqual([
			{ unparsed: "parser" },
		]);
		expect(fake.calls).toEqual([]);
	});
});

describe("what a reply is (decision 9)", () => {
	beforeEach(() => on());

	it("goes to the envelope sender only, whatever From, Reply-To and Sender say", async () => {
		await arrives(
			"Who is asking",
			{
				From: "Boss <boss@header.test>",
				"Reply-To": "reply-here@elsewhere.test",
				Sender: "assistant@header.test",
				Cc: `${DESK}, onlooker@header.test`,
				"Return-Path": "<forged-path@header.test>",
			},
			"Envelope@Sender.test",
		);
		expect(fake.calls).toHaveLength(1);
		expect(fake.calls[0]).toMatchObject({ to: ["envelope@sender.test"] });
		expect(fake.calls[0]?.cc).toBeUndefined();
		expect(fake.calls[0]?.bcc).toBeUndefined();
		expect(JSON.stringify(fake.calls)).not.toMatch(/header\.test|elsewhere\.test/);
	});

	it("is sent to one sender once in seven days", async () => {
		await arrives("First");
		await arrives("Second");
		await arrives("Third", {}, "ADA@sender.test");
		expect(answered()).toEqual(["ada@sender.test"]);
		// Six days later still nothing; after seven the sender is answered again.
		const shift = (days: number) =>
			inMailbox((sql) =>
				sql.exec(
					`UPDATE auto_reply_log SET at = ?1`,
					new Date(Date.now() - days * DAY).toISOString(),
				),
			);
		await shift(6.9);
		await arrives("A week has not passed");
		expect(fake.calls).toHaveLength(1);
		await shift(7.1);
		await arrives("A week has passed");
		expect(answered()).toEqual(["ada@sender.test", "ada@sender.test"]);
		// Someone else is answered meanwhile: the count is each sender's own.
		await arrives("Another person", {}, "grace@sender.test");
		expect(answered()).toHaveLength(3);
	});

	it("carries the mark of an automatic reply, and no other header", async () => {
		await arrives("Mark it", {
			"Message-ID": "<asked-1@sender.test>",
			References: "<older@sender.test>",
		});
		expect(fake.calls[0]?.headers).toEqual({ "Auto-Submitted": "auto-replied" });
	});

	it("has none of the incoming message in it", async () => {
		const result = await deliver(
			mime(
				{
					From: "Marker-Name <ada@sender.test>",
					To: DESK,
					Subject: "MARKER-SUBJECT",
					"Message-ID": "<MARKER-ID@sender.test>",
					"Reply-To": "MARKER-REPLY@sender.test",
					"X-Marker": "MARKER-HEADER",
				},
				"MARKER-BODY <script>MARKER-SCRIPT</script>",
			),
			{ from: "ada@sender.test" },
		);
		expect(result).toEqual({ rejections: [], threw: null });
		await letLeave(DESK);
		expect(fake.calls).toHaveLength(1);
		expect(JSON.stringify(fake.calls)).not.toMatch(/marker/i);
		// Nor is any of it in the row the mailbox keeps of its reply.
		const kept = await rows(`SELECT * FROM emails WHERE folder_id = 'sent'`);
		expect(kept).toHaveLength(1);
		expect(JSON.stringify(kept)).not.toMatch(/marker/i);
		expect(kept[0]).toMatchObject({ in_reply_to: null, email_references: null });
	});
});

describe("it is still the mailbox sending (decision 10)", () => {
	beforeEach(() => on());

	it("has a cap of its own in an hour, below the mailbox's", async () => {
		for (let n = 0; n <= AUTO_REPLY.perHour; n++) {
			await arrives(`Flood ${n}`, {}, `flood-${n}@sender.test`);
		}
		expect(fake.calls).toHaveLength(AUTO_REPLY.perHour);
		expect(answered()).not.toContain(`flood-${AUTO_REPLY.perHour}@sender.test`);
		// The mailbox can still send its own mail: the flood did not spend the hour.
		const sent = await as("owner").post(`${M}/emails`, {
			from: DESK,
			to: "a-person@elsewhere.test",
			subject: "Written by a person",
			text: "Hello",
		});
		expect(sent.status).toBe(202);
	});

	it("has a cap of its own in a day", async () => {
		await inMailbox((sql) => {
			const at = new Date(Date.now() - 2 * 60 * 60_000).toISOString();
			for (let n = 0; n < AUTO_REPLY.perDay; n++) {
				sql.exec(`INSERT INTO auto_reply_log (sender, at) VALUES (?1, ?2)`, `d${n}@day.test`, at);
			}
		});
		await arrives("The day is spent");
		expect(fake.calls).toEqual([]);
	});

	it("is not made when the mailbox's own caps are full", async () => {
		await inMailbox((sql) => {
			for (let n = 0; n < 20; n++) {
				sql.exec(`INSERT INTO send_log (at, kind) VALUES (?1, 'person')`, new Date().toISOString());
			}
		});
		await arrives("The hour is spent");
		expect(fake.calls).toEqual([]);
		expect(await waiting()).toEqual([]);
		expect(await rows(`SELECT * FROM auto_reply_log`)).toEqual([]);
	});

	it("counts against the mailbox's caps like any message", async () => {
		await arrives("Counted");
		const refusedAfter = async (held: number) => {
			await inMailbox((sql) => {
				for (let n = 0; n < held; n++) {
					sql.exec(
						`INSERT INTO send_log (at, kind) VALUES (?1, 'person')`,
						new Date().toISOString(),
					);
				}
			});
			return (
				await as("owner").post(`${M}/emails`, {
					from: DESK,
					to: "a-person@elsewhere.test",
					subject: "One too many",
					text: "Hello",
				})
			).status;
		};
		// Nineteen of a person's and the one automatic reply are the twenty of an hour.
		expect(await refusedAfter(19)).toBe(429);
	});

	it("teaches the mailbox no address", async () => {
		await arrives("Teach me", { Cc: `${DESK}, planted@sender.test` }, "stranger@sender.test");
		expect(answered()).toEqual(["stranger@sender.test"]);
		expect(await rows(`SELECT * FROM known_addresses`)).toEqual([]);
		const offered = await as("owner").fetch(`${M}/known-addresses?q=stranger`);
		expect(await json(offered)).toEqual({ addresses: [] });
	});

	it("is nobody's draft when the service refuses it, and is not tried for that sender again", async () => {
		fake.next = [{ code: "E_RECIPIENT_SUPPRESSED", message: "refused for ada@sender.test" }];
		await arrives("Refused");
		expect(fake.calls).toHaveLength(1);
		expect(await kept()).toEqual([]);
		expect(await rows(`SELECT 1 FROM submissions`)).toEqual([]);
		expect(await rows(`SELECT 1 FROM send_log`)).toEqual([]);
		const places = await json<{ id: string; notSent?: number; waiting?: number }[]>(
			await as("owner").fetch(`${M}/folders`),
		);
		expect(places.find((place) => place.id === "draft")?.notSent).toBe(0);
		await arrives("Refused, and asked again");
		expect(fake.calls).toHaveLength(1);
	});

	it("is not sent twice when the service gives no answer", async () => {
		fake.next = ["never"];
		await arrives("No answer");
		expect(fake.calls).toHaveLength(1);
		expect(await kept()).toEqual([]);
		// Nobody knows whether it left: its place in the caps stays taken.
		expect(await rows(`SELECT kind FROM send_log`)).toEqual([{ kind: "auto" }]);
		await letLeave(DESK);
		expect(fake.calls).toHaveLength(1);
	});

	it("waits and is tried again when the service says not now", async () => {
		fake.next = [{ code: "E_RATE_LIMIT_EXCEEDED" }];
		await arrives("Not now");
		expect(fake.calls).toHaveLength(1);
		// It is a message that waits, and nobody's draft; its next try is a minute away.
		expect(
			await rows(
				`SELECT e.folder_id, s.state FROM submissions s JOIN emails e ON e.id = s.email_id`,
			),
		).toEqual([{ folder_id: "scheduled", state: "waiting" }]);
		await age(DESK, 2 * MINUTE);
		await letLeave(DESK);
		expect(fake.calls).toHaveLength(2);
		expect(fake.calls[1]?.headers).toEqual({ "Auto-Submitted": "auto-replied" });
		expect(await rows(`SELECT kind FROM send_log`)).toEqual([{ kind: "auto" }]);
	});

	it("is nobody's to take back or give a time while it waits, not even a member who may send", async () => {
		fake.next = [{ code: "E_RATE_LIMIT_EXCEEDED" }];
		await arrives("Waiting for its next try", {}, "waits@sender.test");
		const [reply] = await rows<{ email_id: string; requested_by: string; send_at: string }>(
			`SELECT email_id, requested_by, send_at FROM submissions WHERE state = 'waiting'`,
		);
		const saver = reply?.requested_by ?? "";
		expect(saver).not.toBe(ids.sender);
		const at = (route: string) =>
			`${M}/emails/${encodeURIComponent(reply?.email_id ?? "")}/${route}`;
		const later = new Date(Date.now() + 300 * DAY).toISOString();
		for (const who of ["sender", "owner"]) {
			expect((await as(who).post(at("reschedule"), { send_at: later })).status, who).toBe(404);
			expect((await as(who).post(at("reschedule"), {})).status, who).toBe(404);
			expect((await as(who).post(at("unsend"), {})).status, who).toBe(404);
		}
		// It is as it was: the owner's standing, its time, waiting, and nobody's draft.
		expect(
			await rows(
				`SELECT requested_by, send_at, state FROM submissions WHERE email_id = ?1`,
				DESK,
				reply?.email_id ?? "",
			),
		).toEqual([{ requested_by: saver, send_at: reply?.send_at, state: "waiting" }]);
		expect(await rows(`SELECT 1 FROM emails WHERE folder_id = 'draft'`)).toEqual([]);
		await age(DESK, 2 * MINUTE);
		await letLeave(DESK);
		expect(answered()).toEqual(["waits@sender.test", "waits@sender.test"]);
	});

	it("does not leave when it was turned off, or its end date passed, while it waited", async () => {
		const changes: [string, string, () => Promise<unknown>][] = [
			["Turned off while it waited", "off@sender.test", () => on({ ...REPLY, isEnabled: false })],
			[
				"Past its end while it waited",
				"ended@sender.test",
				() =>
					inMailbox((sql) =>
						sql.exec(
							`UPDATE rules SET body = json_set(body, '$.toDate', ?1) WHERE kind = 'auto_reply'`,
							new Date(Date.now() - MINUTE).toISOString(),
						),
					),
			],
		];
		for (const [subject, from, change] of changes) {
			await on();
			fake.calls.length = 0;
			fake.next = [{ code: "E_RATE_LIMIT_EXCEEDED" }];
			await arrives(subject, {}, from);
			expect(fake.calls, subject).toHaveLength(1);
			await change();
			await age(DESK, 2 * MINUTE);
			await letLeave(DESK);
			// Asked again when it would leave, it does not, and nothing of it is kept.
			expect(fake.calls, subject).toHaveLength(1);
			expect(await kept(), subject).toEqual([]);
			expect(await rows(`SELECT 1 FROM submissions`), subject).toEqual([]);
			// Nobody was answered, so the sender is not held off for seven days.
			expect(await rows(`SELECT 1 FROM auto_reply_log WHERE sender = ?1`, DESK, from)).toEqual([]);
		}
		// Control: turned on again, the same sender is answered.
		await on();
		fake.calls.length = 0;
		await arrives("Once it is on again", {}, "off@sender.test");
		expect(answered()).toEqual(["off@sender.test"]);
	});

	it("does not leave with the words of an earlier save when it was saved again while it waited", async () => {
		await on({ ...REPLY, textBody: "The words of the first save." });
		fake.next = [{ code: "E_RATE_LIMIT_EXCEEDED" }];
		await arrives("Waiting while it is saved again", {}, "early@sender.test");
		expect(fake.calls).toHaveLength(1);
		// Saved again, with other words, while the first reply waits for its next try.
		await on({ ...REPLY, textBody: "The words of the second save." });
		await age(DESK, 2 * MINUTE);
		await letLeave(DESK);
		// The waiting reply was made from a save that is no longer in force: it does not leave,
		// nothing of it is kept, and its sender was not answered.
		expect(fake.calls).toHaveLength(1);
		expect(await kept()).toEqual([]);
		expect(await rows(`SELECT 1 FROM submissions`)).toEqual([]);
		expect(await rows(`SELECT 1 FROM auto_reply_log`)).toEqual([]);
		// When they write again, they are answered with the words in force.
		await arrives("Writing again after the second save", {}, "early@sender.test");
		expect(fake.calls).toHaveLength(2);
		expect(JSON.stringify(fake.calls[1])).toContain("The words of the second save.");
		expect(JSON.stringify(fake.calls[1])).not.toContain("first save");
		expect(answered()).toEqual(["early@sender.test", "early@sender.test"]);
	});
});

describe("an arrival that was left half done", () => {
	it("is answered once when the next arrival finishes it", async () => {
		await on();
		// The handler is stopped after the bytes are stored and before the message is filed.
		const left = await deliver(
			mime({ From: "Ada <ada@sender.test>", To: DESK, Subject: "Left half done" }),
			{
				from: "resumed@sender.test",
				env: stoppedAt("fileArrival") as unknown as Record<string, unknown>,
			},
		);
		expect(left).toEqual({ rejections: [], threw: null });
		expect(await stored("Left half done")).toBeUndefined();
		expect(fake.calls).toEqual([]);
		await inMailbox((sql) =>
			sql.exec(
				`UPDATE arrivals SET started_at = ?1`,
				new Date(Date.now() - 20 * MINUTE).toISOString(),
			),
		);
		// The next arrival finishes it: both are answered, each once.
		await arrives("The next arrival", {}, "next@sender.test");
		expect(await stored("Left half done")).toMatchObject({ folder_id: "inbox" });
		expect(answered().sort()).toEqual(["next@sender.test", "resumed@sender.test"]);
		// And the one after that finds nothing left to finish, and answers nobody twice.
		await arrives("The one after", {}, "after@sender.test");
		expect(answered().sort()).toEqual([
			"after@sender.test",
			"next@sender.test",
			"resumed@sender.test",
		]);
		expect(await rows(`SELECT 1 FROM arrivals`)).toEqual([]);
	});
});

describe("whatever the reply does, the message that arrived is stored", () => {
	it("when its record cannot be written", async () => {
		await on();
		await inMailbox((sql) => sql.exec(`ALTER TABLE auto_reply_log RENAME TO auto_reply_log_away`));
		try {
			expect(await arrives("The log is gone")).toMatchObject({ folder_id: "inbox", read: 0 });
			expect(fake.calls).toEqual([]);
			expect(await waiting()).toEqual([]);
			// Nothing of the delivery is cut short either: a file of the message is stored.
			const withFile = [
				"From: Ada <ada@sender.test>",
				`To: ${DESK}`,
				"Subject: With a file, and no log",
				"MIME-Version: 1.0",
				'Content-Type: multipart/mixed; boundary="b"',
				"",
				"--b",
				"Content-Type: text/plain",
				"",
				"See the file.",
				"--b",
				'Content-Type: text/plain; name="notes.txt"',
				'Content-Disposition: attachment; filename="notes.txt"',
				"",
				"notes",
				"--b--",
				"",
			].join("\r\n");
			expect(await deliver(withFile, { from: "file@sender.test" })).toEqual({
				rejections: [],
				threw: null,
			});
			const message = await stored("With a file, and no log");
			expect(message).toMatchObject({ folder_id: "inbox" });
			expect(
				await rows(
					`SELECT filename, uploading_since FROM attachments WHERE email_id = ?1`,
					DESK,
					message?.id ?? "",
				),
			).toEqual([{ filename: "notes.txt", uploading_since: null }]);
		} finally {
			await inMailbox((sql) =>
				sql.exec(`ALTER TABLE auto_reply_log_away RENAME TO auto_reply_log`),
			);
		}
	});

	it("when the stored object is not one", async () => {
		await on();
		await inMailbox((sql) =>
			sql.exec(`UPDATE rules SET body = '{broken' WHERE kind = 'auto_reply'`),
		);
		expect(await arrives("The object is broken")).toMatchObject({ folder_id: "inbox" });
		expect(fake.calls).toEqual([]);
		expect(await read()).toMatchObject({ isEnabled: false });
	});
});
