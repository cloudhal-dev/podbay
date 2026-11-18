/**
 * Tier 0: whether the automatic reply of a mailbox is owed for a message, and what its
 * settings may be (ADR-0008, decisions 8 to 10; RFC 3834). The decision is one pure function:
 * each of its refusals is a line of the record, tried here by itself and again in the Workers
 * runtime with a message that really arrives (test/workerd/auto-reply.test.ts).
 */
import { describe, expect, it } from "vitest";
import {
	AUTO_REPLY,
	type AutoReply,
	answersAt,
	type ReplyQuestion,
	replyOwed,
	replySender,
} from "../../shared/rules.ts";
import { parseAutoReply } from "../../shared/rules-schema.ts";

const REPLY: AutoReply = {
	isEnabled: true,
	fromDate: null,
	toDate: null,
	subject: "Away",
	textBody: "I am away until Monday.",
	htmlBody: null,
};
const NOW = Date.parse("2026-11-18T12:00:00Z");
const DAY = 24 * 60 * 60_000;

describe("when the automatic reply answers (decision 8)", () => {
	it("is on, has something to say, and is inside its dates", () => {
		expect(answersAt(REPLY, NOW)).toBe(true);
		expect(answersAt({ ...REPLY, isEnabled: false }, NOW)).toBe(false);
		expect(answersAt({ ...REPLY, textBody: null }, NOW)).toBe(false);
		expect(answersAt({ ...REPLY, textBody: "  " }, NOW)).toBe(false);
		expect(answersAt({ ...REPLY, textBody: null, htmlBody: "<p>Away</p>" }, NOW)).toBe(true);
	});

	it("answers from its beginning, and no longer at its end", () => {
		const at = (ms: number) => new Date(NOW + ms).toISOString();
		expect(answersAt({ ...REPLY, fromDate: at(1) }, NOW)).toBe(false);
		expect(answersAt({ ...REPLY, fromDate: at(0) }, NOW)).toBe(true);
		expect(answersAt({ ...REPLY, toDate: at(1) }, NOW)).toBe(true);
		expect(answersAt({ ...REPLY, toDate: at(0) }, NOW)).toBe(false);
		expect(answersAt({ ...REPLY, fromDate: at(-DAY), toDate: at(DAY) }, NOW)).toBe(true);
		// A date that cannot be read is no licence to answer.
		expect(answersAt({ ...REPLY, fromDate: "soon" }, NOW)).toBe(false);
		expect(answersAt({ ...REPLY, toDate: "later" }, NOW)).toBe(false);
	});

	it("has caps of its own below the mailbox's 20 in an hour and 100 in a day", () => {
		expect(AUTO_REPLY.perHour).toBeLessThan(20);
		expect(AUTO_REPLY.perDay).toBeLessThan(100);
		expect(AUTO_REPLY.oncePerSenderMs).toBe(7 * DAY);
		expect([AUTO_REPLY.header, AUTO_REPLY.headerValue]).toEqual(["Auto-Submitted", "auto-replied"]);
	});
});

describe("whether the automatic reply is owed (decision 9; RFC 3834)", () => {
	const asked = (over: Partial<ReplyQuestion> = {}): ReplyQuestion => ({
		reply: REPLY,
		now: NOW,
		mailbox: "desk@example.com",
		envelopeFrom: "Ada@Sender.test",
		facts: { recipients: ["desk@example.com"], autoSubmitted: null, list: false },
		outcome: { place: "inbox", blocked: false },
		blocked: [],
		lastAnsweredAt: null,
		lastHour: 0,
		lastDay: 0,
		room: true,
		...over,
	});
	const factsWith = (over: Partial<ReplyQuestion["facts"]>) => ({ ...asked().facts, ...over });

	it("goes to the envelope sender, in lower case, and to nobody else", () => {
		expect(replyOwed(asked())).toEqual({ to: "ada@sender.test" });
		expect(replyOwed(asked({ outcome: { place: "archive", blocked: false } }))).toEqual({
			to: "ada@sender.test",
		});
	});

	it("is not owed when the reply is off or outside its dates", () => {
		expect(replyOwed(asked({ reply: { ...REPLY, isEnabled: false } }))).toEqual({ no: "off" });
		expect(
			replyOwed(asked({ reply: { ...REPLY, toDate: new Date(NOW - 1).toISOString() } })),
		).toEqual({ no: "off" });
	});

	it.each([
		"auto-replied",
		"auto-generated",
		"AUTO-REPLIED",
		'auto-notified; owner-email="x@y.test"',
		"anything-else",
		"",
		"(no) yes",
	])("never answers a message with Auto-Submitted: %s", (value) => {
		expect(replyOwed(asked({ facts: factsWith({ autoSubmitted: value }) }))).toEqual({
			no: "automatic",
		});
	});

	it.each(["no", "NO", " no ", "no; x=1", "no (a person)"])(
		"answers a message with Auto-Submitted: %s",
		(value) => {
			expect(replyOwed(asked({ facts: factsWith({ autoSubmitted: value }) }))).toEqual({
				to: "ada@sender.test",
			});
		},
	);

	it("never answers unless the mailbox's address is in To or Cc", () => {
		for (const recipients of [[], ["team@example.com"], ["desk@example.com.evil.test"]]) {
			expect(replyOwed(asked({ facts: factsWith({ recipients }) }))).toEqual({
				no: "not_addressed",
			});
		}
		expect(
			replyOwed(asked({ facts: factsWith({ recipients: ["x@y.test", "DESK@example.com"] }) })),
		).toEqual({
			to: "ada@sender.test",
		});
		expect(replyOwed(asked({ mailbox: " " }))).toEqual({ no: "not_addressed" });
	});

	it("never answers mail that was filed in Spam or Trash, or whose sender is blocked", () => {
		expect(replyOwed(asked({ outcome: { place: "spam", blocked: false } }))).toEqual({
			no: "filed_away",
		});
		expect(replyOwed(asked({ outcome: { place: "trash", blocked: false } }))).toEqual({
			no: "filed_away",
		});
		expect(replyOwed(asked({ outcome: { place: "trash", blocked: true } }))).toEqual({
			no: "filed_away",
		});
		expect(replyOwed(asked({ outcome: { place: "inbox", blocked: true } }))).toEqual({
			no: "filed_away",
		});
	});

	it("never answers an envelope sender that is blocked, whatever the From of the message says", () => {
		// The block list is asked of the address in From, which is in the outcome; the reply goes
		// to the envelope sender, so that one is asked of the list too, as an address and a domain.
		expect(replyOwed(asked({ blocked: ["ada@sender.test"] }))).toEqual({ no: "filed_away" });
		expect(replyOwed(asked({ blocked: ["@sender.test"] }))).toEqual({ no: "filed_away" });
		expect(replyOwed(asked({ blocked: ["someone@sender.test", "@other.test"] }))).toEqual({
			to: "ada@sender.test",
		});
	});

	it("never answers a list or bulk mail", () => {
		expect(replyOwed(asked({ facts: factsWith({ list: true }) }))).toEqual({ no: "list" });
	});

	it.each([
		["a bounce, which has no envelope sender", ""],
		["an empty sender in brackets", "<>"],
		["something that is not an address", "ada"],
		["two addresses", "ada@sender.test, grace@sender.test"],
		["an address with a name", "Ada <ada@sender.test>"],
		["the mailbox itself", "Desk@Example.com"],
		["the mail system", "MAILER-DAEMON@sender.test"],
		["the owner of a list", "owner-news@sender.test"],
		["the door of a list", "news-request@sender.test"],
	])("never answers %s", (_what, envelopeFrom) => {
		expect(replyOwed(asked({ envelopeFrom }))).toEqual({ no: "no_sender" });
	});

	it("names a sender in one form, whatever form the envelope gave it in", () => {
		// The address a reply goes to is the address the seven days are counted for.
		const composed = "jos\u00e9@sender.test";
		const decomposed = " JOSE\u0301@Sender.test ";
		expect(replySender(decomposed)).toBe(composed);
		expect(replyOwed(asked({ envelopeFrom: decomposed }))).toEqual({ to: composed });
	});

	it("answers one sender once in seven days", () => {
		const since = (ms: number) => replyOwed(asked({ lastAnsweredAt: NOW - ms }));
		expect(since(0)).toEqual({ no: "recent" });
		expect(since(6 * DAY)).toEqual({ no: "recent" });
		expect(since(7 * DAY - 1)).toEqual({ no: "recent" });
		expect(since(7 * DAY)).toEqual({ to: "ada@sender.test" });
	});

	it("stops at its own caps, and when the mailbox has no room", () => {
		expect(replyOwed(asked({ lastHour: AUTO_REPLY.perHour - 1 }))).toEqual({
			to: "ada@sender.test",
		});
		expect(replyOwed(asked({ lastHour: AUTO_REPLY.perHour }))).toEqual({ no: "cap" });
		expect(replyOwed(asked({ lastDay: AUTO_REPLY.perDay }))).toEqual({ no: "cap" });
		expect(replyOwed(asked({ room: false }))).toEqual({ no: "cap" });
	});
});

describe("the request of PUT …/auto-reply (rule D2)", () => {
	const body = {
		isEnabled: true,
		fromDate: "2026-12-01T09:00:00+03:00",
		toDate: "2026-12-10T09:00:00Z",
		subject: " Away\r\nBcc: x@y.test ",
		textBody: "Back on the tenth.",
		htmlBody: null,
	};

	it("takes the object of the record, with its dates in one form and its subject on one line", () => {
		expect(parseAutoReply(body)).toEqual({
			reply: {
				isEnabled: true,
				fromDate: "2026-12-01T06:00:00.000Z",
				toDate: "2026-12-10T09:00:00.000Z",
				subject: "Away Bcc: x@y.test",
				textBody: "Back on the tenth.",
				htmlBody: null,
			},
		});
		expect(
			parseAutoReply({ ...body, isEnabled: false, subject: " ", textBody: " ", fromDate: null }),
		).toMatchObject({ reply: { isEnabled: false, subject: null, textBody: null, fromDate: null } });
		expect(parseAutoReply({ ...body, subject: null })).toMatchObject({ reply: { subject: null } });
	});

	it.each([
		["nothing", null],
		["a key it does not know", { ...body, forwardTo: "x@y.test" }],
		["a missing key", { isEnabled: true }],
		["a beginning that is not a date", { ...body, fromDate: "soon" }],
		["an end that is not a date", { ...body, toDate: "later" }],
		["an end before its beginning", { ...body, toDate: "2026-11-30T00:00:00Z" }],
		["an end at its beginning", { ...body, toDate: "2026-12-01T06:00:00Z" }],
		["a subject over its length", { ...body, subject: "s".repeat(AUTO_REPLY.subject + 1) }],
		["a text over its length", { ...body, textBody: "t".repeat(AUTO_REPLY.text + 1) }],
		["an HTML body over its length", { ...body, htmlBody: "h".repeat(AUTO_REPLY.html + 1) }],
		["a flag that is not one", { ...body, isEnabled: "yes" }],
	])("refuses %s", (_what, given) => {
		expect(parseAutoReply(given)).toEqual({ refused: "invalid" });
	});

	it("takes a text and an HTML body together only when the text is the text of the HTML", () => {
		const html = "<p>Away until <b>Monday</b>.</p><p>Back soon.</p>";
		expect(
			parseAutoReply({ ...body, textBody: "Away until Monday.\n\nBack soon.", htmlBody: html }),
		).toMatchObject({
			reply: { htmlBody: html },
		});
		expect(
			parseAutoReply({ ...body, textBody: "Away until Monday. Back soon.", htmlBody: html }),
		).toMatchObject({
			reply: { htmlBody: html },
		});
		expect(parseAutoReply({ ...body, textBody: "I am here.", htmlBody: html })).toEqual({
			refused: "invalid",
		});
		expect(parseAutoReply({ ...body, textBody: "Away until Monday.", htmlBody: html })).toEqual({
			refused: "invalid",
		});
	});

	it("refuses to turn on a reply that says nothing", () => {
		expect(parseAutoReply({ ...body, textBody: "  ", htmlBody: null })).toEqual({
			refused: "empty",
		});
		expect(parseAutoReply({ ...body, textBody: null, htmlBody: "<p>Away</p>" })).toMatchObject({
			reply: { htmlBody: "<p>Away</p>" },
		});
	});
});
