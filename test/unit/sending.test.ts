// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Outgoing mail waits before it leaves (ADR-0016), as far as pure code decides it: the schema
 * of the send request, when a request says a message leaves, the tries, what the service's
 * answer means, what a stored row gives the service, the words of the reasons, and the static
 * check that mail leaves by one function.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { setLanguage } from "../../app/i18n/index.ts";
import { tr } from "../../app/i18n/tr.ts";
import {
	fieldValue,
	laterChoices,
	mayHaveLeft,
	reasonMessage,
	reasonWords,
	timeRefusal,
} from "../../app/lib/sending-words.ts";
import { LEAVING, senderProblems } from "../../scripts/checks/sender.ts";
import { plainTextOf } from "../../shared/html-text.ts";
import {
	DEFAULT_UNDO_SECONDS,
	NOT_NOW_CODES,
	OWN_REASONS,
	outcomeOfRefusal,
	retryAfterMs,
	SEND_CODES,
	SENDING,
	SUBMISSION_STATES,
	UNDO_SECONDS,
	whenToLeave,
} from "../../shared/sending.ts";
import { MAX_ATTACHMENTS, MAX_MESSAGE_BYTES, MAX_RECIPIENTS } from "../../shared/sending-limits.ts";
import { fits, fromOf, fromStored, headerList } from "../../workers/lib/outgoing-message.ts";
import { RescheduleRequestSchema, SendEmailRequestSchema } from "../../workers/lib/schemas.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NOW = Date.parse("2026-11-18T10:00:00.000Z");

const message = (extra: Record<string, unknown> = {}) => ({
	to: "someone@elsewhere.test",
	from: "me@example.com",
	subject: "S",
	text: "T",
	...extra,
});
const taken = (extra: Record<string, unknown>) =>
	SendEmailRequestSchema.safeParse(message(extra)).success;

describe("the sticky names of the record", () => {
	it("are the states, the reasons, the codes and the limits it fixed", () => {
		expect([...SUBMISSION_STATES]).toEqual(["waiting", "sending", "sent", "failed"]);
		expect([...OWN_REASONS]).toEqual(["right", "sender", "limits", "late", "unknown"]);
		expect(SEND_CODES).toEqual({
			scheduled: "SCHEDULED",
			started: "SEND_STARTED",
			tooFar: "SEND_AT_TOO_FAR",
			tooMany: "TOO_MANY_WAITING",
		});
		expect([...UNDO_SECONDS]).toEqual([5, 10, 30]);
		expect(DEFAULT_UNDO_SECONDS).toBe(10);
		expect(SENDING).toEqual({
			marginMs: 2000,
			farthestMs: 365 * DAY,
			waiting: 100,
			attempts: 6,
			retryAfterMs: [MINUTE, 5 * MINUTE, 15 * MINUTE, HOUR, 4 * HOUR],
			answerWithinMs: MINUTE,
			unansweredAfterMs: 15 * MINUTE,
			lateAfterMs: DAY,
			perRun: 10,
		});
	});
});

describe("the send request", () => {
	it("takes an undo window of 5, 10 or 30 seconds, and nothing else: there is no off", () => {
		for (const seconds of UNDO_SECONDS) expect(taken({ undo_seconds: seconds })).toBe(true);
		expect(taken({})).toBe(true);
		for (const bad of [0, 1, 7, 15, 60, -5, 10.5, "10", true, null, [10]]) {
			expect(taken({ undo_seconds: bad }), String(bad)).toBe(false);
		}
	});

	it("takes a time as an instant in UTC, and nothing that only looks like one", () => {
		for (const good of ["2027-01-02T03:04:05Z", "2027-01-02T03:04:05.678Z"]) {
			expect(taken({ send_at: good }), good).toBe(true);
		}
		for (const bad of [
			"2027-01-02T03:04:05+03:00",
			"2027-01-02T03:04:05",
			"2027-01-02",
			"tomorrow",
			"",
			1_800_000_000_000,
			null,
			`2027-01-02T03:04:05${"0".repeat(40)}Z`,
		]) {
			expect(taken({ send_at: bad }), String(bad)).toBe(false);
		}
	});

	it("keeps what it always held: a body, the recipients, the size", () => {
		expect(taken({ text: undefined })).toBe(false);
		expect(taken({ to: "not an address" })).toBe(false);
		const parsed = SendEmailRequestSchema.parse(
			message({ send_at: "2027-01-02T03:04:05Z", undo_seconds: 30, draft_id: "d-1" }),
		);
		expect(parsed).toMatchObject({
			send_at: "2027-01-02T03:04:05Z",
			undo_seconds: 30,
			draft_id: "d-1",
		});
	});

	it("gives a waiting message a new time, or none for now, and takes nothing else", () => {
		expect(RescheduleRequestSchema.safeParse({}).success).toBe(true);
		expect(RescheduleRequestSchema.safeParse({ send_at: "2027-01-02T03:04:05Z" }).success).toBe(
			true,
		);
		for (const bad of [
			{ send_at: "2027-01-02T03:04:05+01:00" },
			{ send_at: null },
			{ send_at: "2027-01-02T03:04:05Z", undo_seconds: 5 },
			{ to: "someone@elsewhere.test" },
			null,
			"now",
		]) {
			expect(RescheduleRequestSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
		}
	});
});

describe("when a message leaves", () => {
	it("is after the window and two seconds more, for an ordinary send", () => {
		expect(whenToLeave({}, NOW)).toEqual({ at: NOW + 12_000, later: false });
		for (const seconds of UNDO_SECONDS) {
			expect(whenToLeave({ undo_seconds: seconds }, NOW)).toEqual({
				at: NOW + seconds * 1000 + SENDING.marginMs,
				later: false,
			});
		}
		// A window that is not one is the window nobody chose.
		expect(whenToLeave({ undo_seconds: 0 }, NOW)).toEqual({ at: NOW + 12_000, later: false });
	});

	it("is the time itself for a message sent later, with no window on top", () => {
		const at = NOW + 3 * HOUR;
		expect(whenToLeave({ send_at: new Date(at).toISOString(), undo_seconds: 30 }, NOW)).toEqual({
			at,
			later: true,
		});
		// The furthest time is 365 days ahead, to the millisecond.
		const farthest = NOW + SENDING.farthestMs;
		expect(whenToLeave({ send_at: new Date(farthest).toISOString() }, NOW)).toEqual({
			at: farthest,
			later: true,
		});
		expect(whenToLeave({ send_at: new Date(farthest + 1).toISOString() }, NOW)).toEqual({
			refused: "too_far",
		});
	});

	it("refuses a time that is past or now, and one that is no time", () => {
		for (const send_at of [new Date(NOW).toISOString(), new Date(NOW - 1).toISOString(), "x"]) {
			expect(whenToLeave({ send_at }, NOW), send_at).toEqual({ refused: "past" });
		}
	});

	it("takes a time nearer than the window as an ordinary send", () => {
		const near = new Date(NOW + 4_000).toISOString();
		expect(whenToLeave({ send_at: near, undo_seconds: 5 }, NOW)).toEqual({
			at: NOW + 7_000,
			later: false,
		});
		// The window itself is the first time that is "later".
		const edge = new Date(NOW + 5_000).toISOString();
		expect(whenToLeave({ send_at: edge, undo_seconds: 5 }, NOW)).toEqual({
			at: NOW + 5_000,
			later: true,
		});
	});
});

describe("tries", () => {
	it("are made after 1, 5 and 15 minutes, 1 hour and 4 hours: six attempts, and no seventh", () => {
		expect([1, 2, 3, 4, 5].map(retryAfterMs)).toEqual([
			MINUTE,
			5 * MINUTE,
			15 * MINUTE,
			HOUR,
			4 * HOUR,
		]);
		for (const none of [6, 7, 100, 0, -1, 1.5, Number.NaN]) {
			expect(retryAfterMs(none), String(none)).toBeNull();
		}
		// A little over five hours from the first attempt to the last.
		const whole = SENDING.retryAfterMs.reduce((sum, wait) => sum + wait, 0);
		expect(whole).toBe(5 * HOUR + 21 * MINUTE);
	});
});

describe("what the service's answer means", () => {
	const refusal = (code: unknown) => Object.assign(new Error("the service's own words"), { code });

	it("reads three codes as not now, and every other code as final", () => {
		expect([...NOT_NOW_CODES].sort()).toEqual(
			["E_EMAIL_SENDING_NOT_READY", "E_INTERNAL_SERVER_ERROR", "E_RATE_LIMIT_EXCEEDED"].sort(),
		);
		for (const code of NOT_NOW_CODES) {
			expect(outcomeOfRefusal(refusal(code))).toEqual({ is: "again", code });
		}
		for (const code of [
			"E_DELIVERY_FAILED",
			"E_DAILY_LIMIT_EXCEEDED",
			"E_SENDER_NOT_VERIFIED",
			"E_VALIDATION_ERROR",
			"E_A_CODE_OF_TOMORROW",
		]) {
			expect(outcomeOfRefusal(refusal(code))).toEqual({ is: "failed", error: code });
		}
	});

	it("reads no answer, an error without a code and a code that is none as unknown", () => {
		expect(outcomeOfRefusal(null)).toEqual({ is: "failed", error: "unknown" });
		for (const error of [
			new Error("connection lost"),
			refusal(undefined),
			refusal(42),
			refusal("rate limited"),
			refusal("e_rate_limit_exceeded"),
			refusal(`E_${"A".repeat(200)}`),
			"a string",
			undefined,
			{},
		]) {
			expect(outcomeOfRefusal(error)).toEqual({ is: "failed", error: "unknown" });
		}
	});

	it("reads an argument of the wrong shape as a message that does not fit", () => {
		expect(outcomeOfRefusal(new TypeError("to: wrong shape"))).toEqual({
			is: "failed",
			error: "limits",
		});
	});

	it("never keeps the service's own words", () => {
		const outcome = outcomeOfRefusal(refusal("E_RECIPIENT_SUPPRESSED"));
		expect(JSON.stringify(outcome)).not.toContain("own words");
	});
});

describe("what a stored message gives the service", () => {
	const stored = (from: string | { email: string; name: string }, more = {}) => ({
		subject: "Hello",
		sender: "desk@example.com",
		recipient: "one@elsewhere.test, two@elsewhere.test",
		cc: "copy@elsewhere.test",
		bcc: null,
		body: "<p>Tom &amp; Jerry &lt;3</p><p>Second</p>",
		in_reply_to: "question@sender.test",
		email_references: JSON.stringify(["first@sender.test", "question@sender.test"]),
		raw_headers: headerList({
			from,
			to: ["one@elsewhere.test", "two@elsewhere.test"],
			cc: "copy@elsewhere.test",
			subject: "Hello",
			date: "2026-11-18T10:00:00.000Z",
			messageId: "id@example.com",
			inReplyTo: "question@sender.test",
			references: ["first@sender.test", "question@sender.test"],
		}),
		...more,
	});

	it("is read back from the rows alone: recipients, both forms of the text, the threading", () => {
		expect(fromStored(stored("desk@example.com"))).toEqual({
			to: ["one@elsewhere.test", "two@elsewhere.test"],
			cc: ["copy@elsewhere.test"],
			from: "desk@example.com",
			subject: "Hello",
			html: "<p>Tom &amp; Jerry &lt;3</p><p>Second</p>",
			text: "Tom & Jerry <3\n\nSecond",
			headers: {
				"In-Reply-To": "<question@sender.test>",
				References: "<first@sender.test> <question@sender.test>",
			},
		});
		// Neither `Message-ID` nor `Date` is handed over: the service sets both itself.
		const headers = fromStored(stored("desk@example.com")).headers ?? {};
		expect(Object.keys(headers).map((name) => name.toLowerCase())).not.toContain("message-id");
		expect(Object.keys(headers).map((name) => name.toLowerCase())).not.toContain("date");
	});

	it("keeps the name a mailbox sends under, whatever the name holds", () => {
		for (const name of ["The Desk", "Desk <of> Podbay", 'A "quoted" name', "desk@example.com"]) {
			const from = { email: "Desk@Example.com", name };
			expect(fromOf(stored(from)), name).toEqual({ email: "desk@example.com", name });
		}
		expect(fromOf(stored("desk@example.com"))).toBe("desk@example.com");
		expect(fromOf(stored({ email: "desk@example.com", name: "" }))).toBe("desk@example.com");
		// A header list that is not one, or is gone, leaves the address.
		expect(fromOf(stored("x", { raw_headers: "not json" }))).toBe("desk@example.com");
		expect(fromOf(stored("x", { raw_headers: null }))).toBe("desk@example.com");
	});

	it("makes the text form from the HTML, decoding each character reference once", () => {
		expect(plainTextOf("<p>a &amp;lt; b</p>")).toBe("a &lt; b");
		expect(plainTextOf("<p>caf&#233; &#x1F600;&nbsp;x</p>")).toBe("café 😀 x");
		expect(plainTextOf("<style>p{}</style><p>seen</p><script>hidden()</script>")).toBe("seen");
		expect(plainTextOf("<p>one</p><p>two<br>three</p>")).toBe("one\n\ntwo\nthree");
		expect(plainTextOf("&#0; &#99999999; &bogus;")).toBe("&#0; &#99999999; &bogus;");
	});

	it("fits what the service takes, or does not: recipients, files and size", () => {
		const people = (count: number) =>
			Array.from({ length: count }, (_one, index) => `p${index}@elsewhere.test`);
		const small = { html: "<p>x</p>", text: "x" };
		expect(fits({ to: people(MAX_RECIPIENTS), ...small }, [])).toBe(true);
		expect(fits({ to: people(MAX_RECIPIENTS - 1), cc: ["c@elsewhere.test"], ...small }, [])).toBe(
			true,
		);
		expect(fits({ to: people(MAX_RECIPIENTS), bcc: ["b@elsewhere.test"], ...small }, [])).toBe(
			false,
		);
		expect(fits({ to: [], ...small }, [])).toBe(false);
		const files = (count: number, size = 1) => Array.from({ length: count }, () => ({ size }));
		expect(fits({ to: "a@elsewhere.test", ...small }, files(MAX_ATTACHMENTS))).toBe(true);
		expect(fits({ to: "a@elsewhere.test", ...small }, files(MAX_ATTACHMENTS + 1))).toBe(false);
		// A file travels as base64, a third larger than it is.
		const room = Math.floor(((MAX_MESSAGE_BYTES - 9) * 3) / 4);
		expect(fits({ to: "a@elsewhere.test", ...small }, files(1, room - 3))).toBe(true);
		expect(fits({ to: "a@elsewhere.test", ...small }, files(1, room + 3))).toBe(false);
	});
});

describe("the words of the reasons", () => {
	it("has a sentence of the app's own for every reason of Podbay and every code of the service", () => {
		// The codes of the sending service, as its documentation lists them (the ledger).
		const codes = [
			"E_VALIDATION_ERROR",
			"E_FIELD_MISSING",
			"E_TOO_MANY_RECIPIENTS",
			"E_TOO_MANY_ATTACHMENTS",
			"E_SENDER_NOT_VERIFIED",
			"E_SENDER_DOMAIN_NOT_AVAILABLE",
			"E_SENDER_DOMAIN_NOT_CONFIGURED",
			"E_EMAIL_SENDING_NOT_READY",
			"E_RECIPIENT_NOT_ALLOWED",
			"E_RECIPIENT_PLAN_RESTRICTED",
			"E_RECIPIENT_SUPPRESSED",
			"E_ACCOUNT_SUSPENDED",
			"E_CONTENT_TOO_LARGE",
			"E_DELIVERY_FAILED",
			"E_RATE_LIMIT_EXCEEDED",
			"E_DAILY_LIMIT_EXCEEDED",
			"E_INTERNAL_SERVER_ERROR",
			"E_HEADER_NOT_ALLOWED",
			"E_HEADER_USE_API_FIELD",
			"E_HEADER_VALUE_INVALID",
			"E_HEADER_VALUE_TOO_LONG",
			"E_HEADER_NAME_INVALID",
			"E_HEADERS_TOO_LARGE",
			"E_HEADERS_TOO_MANY",
		];
		expect(codes).toHaveLength(24);
		const other = reasonMessage("E_A_CODE_OF_TOMORROW");
		for (const reason of [...OWN_REASONS, ...codes]) {
			const words = reasonMessage(reason);
			expect(words, reason).not.toBe(other);
			expect(words.length, reason).toBeGreaterThan(20);
			// A sentence of the app, never a code, and with its Turkish.
			expect(words, reason).not.toMatch(/E_[A-Z]|\{|\}/);
			expect(tr[words], reason).toBeTypeOf("string");
		}
		// What the app does not know is said as that, and nothing is shown raw.
		for (const unknown of ["E_A_CODE_OF_TOMORROW", "", null, undefined, "<b>markup</b>"]) {
			expect(reasonMessage(unknown)).toBe(other);
		}
		expect(tr[other]).toBeTypeOf("string");
	});

	it("says what cannot be known, and what a failed delivery does not say", () => {
		expect(reasonMessage("unknown")).toMatch(/may have been sent/);
		expect(mayHaveLeft("unknown")).toBe(true);
		for (const known of ["late", "right", "E_DELIVERY_FAILED", null]) {
			expect(mayHaveLeft(known)).toBe(false);
		}
		expect(reasonMessage("E_DELIVERY_FAILED")).toMatch(/does not say whether another recipient/);
		// "Not now" that lasted through every try is said as that, not as a failure of the message.
		expect(reasonMessage("E_RATE_LIMIT_EXCEEDED")).toBe(reasonMessage("E_INTERNAL_SERVER_ERROR"));
	});

	it("is in the reader's language", () => {
		const english = reasonWords("late");
		setLanguage("tr");
		try {
			expect(reasonWords("late")).not.toBe(english);
			expect(reasonWords("late")).toBe(tr[reasonMessage("late")]);
		} finally {
			setLanguage("en");
		}
	});
});

describe("the times the app offers for sending later", () => {
	it("are in an hour, tomorrow morning and afternoon, and Monday morning when that is not tomorrow", () => {
		// A Wednesday, in this device's own time zone.
		const wednesday = new Date(2026, 10, 18, 10, 30);
		const choices = laterChoices(wednesday);
		expect(choices.map((choice) => choice.name)).toEqual([
			"In an hour",
			"Tomorrow morning",
			"Tomorrow afternoon",
			"Monday morning",
		]);
		expect(choices.map((choice) => fieldValue(choice.at))).toEqual([
			"2026-11-18T11:30",
			"2026-11-19T08:00",
			"2026-11-19T13:00",
			"2026-11-23T08:00",
		]);
		// From a Sunday, Monday morning is tomorrow morning, and is offered once.
		const sunday = new Date(2026, 10, 22, 23, 59);
		expect(laterChoices(sunday).map((choice) => fieldValue(choice.at))).toEqual([
			"2026-11-23T00:59",
			"2026-11-23T08:00",
			"2026-11-23T13:00",
		]);
		// From a Monday it is the Monday after.
		const monday = new Date(2026, 10, 23, 7, 0);
		expect(fieldValue(laterChoices(monday).at(-1)?.at ?? monday)).toBe("2026-11-30T08:00");
		// Every time offered is one the mailbox takes.
		for (const start of [wednesday, sunday, monday]) {
			for (const choice of laterChoices(start)) {
				expect(timeRefusal(choice.at, start), choice.name).toBeNull();
			}
		}
	});

	it("refuses a time a person picked that is past, too far or no time", () => {
		const now = new Date(NOW);
		expect(timeRefusal(new Date(NOW + MINUTE), now)).toBeNull();
		expect(timeRefusal(new Date(NOW + SENDING.farthestMs), now)).toBeNull();
		expect(timeRefusal(new Date(NOW), now)).toMatch(/still to come/);
		expect(timeRefusal(new Date(NOW - MINUTE), now)).toMatch(/still to come/);
		expect(timeRefusal(new Date(NOW + SENDING.farthestMs + MINUTE), now)).toMatch(/a year/);
		expect(timeRefusal(new Date("not a date"), now)).toMatch(/date and a time/);
	});
});

describe("the static check: mail leaves by one function", () => {
	const leaving = readFileSync(LEAVING, "utf8");

	it("passes for the code as it is", () => {
		expect(senderProblems(LEAVING, leaving)).toEqual([]);
		for (const file of [
			"workers/lib/outgoing.ts",
			"workers/routes/sending.ts",
			"workers/durableObject/index.ts",
			"workers/durableObject/submissions.ts",
			"workers/durableObject/alarm.ts",
			"workers/email-sender.ts",
			"workers/agent/tools.ts",
		]) {
			expect(senderProblems(file, readFileSync(file, "utf8")), file).toEqual([]);
		}
	});

	it("refuses a second reader of the send binding, a second caller of the adapter or of the handover", () => {
		const elsewhere = "workers/lib/outgoing.ts";
		expect(senderProblems(elsewhere, "await c.env.EMAIL.send(message);")).toHaveLength(1);
		expect(senderProblems(elsewhere, "await sendEmail(binding, message);")).toHaveLength(1);
		expect(
			senderProblems(elsewhere, 'import { handOver } from "../durableObject/submissions";'),
		).toHaveLength(1);
		expect(senderProblems(elsewhere, "submissions.handOver(storage, row, now);")).toHaveLength(1);
		// And in the one file itself, a second call of either.
		expect(senderProblems(LEAVING, `${leaving}\nawait sendEmail(env.EMAIL, again);`)).toHaveLength(
			2,
		);
		expect(senderProblems(LEAVING, `${leaving}\nhandOver(storage, seen, clock());`)).toHaveLength(
			1,
		);
		expect(senderProblems(LEAVING, "export const nothing = 1;")).toHaveLength(3);
	});

	it("leaves alone what only talks about it, and code that does not ship", () => {
		expect(senderProblems("workers/x.ts", "// never call env.EMAIL.send() here")).toEqual([]);
		expect(senderProblems("workers/x.ts", "/* sendEmail(binding, x) is the adapter */")).toEqual(
			[],
		);
		expect(senderProblems("test/unit/x.test.ts", "await env.EMAIL.send(message);")).toEqual([]);
		expect(senderProblems("app/x.ts", "await sendEmail(a, b);")).toEqual([]);
		// The tools' environment names the binding to shadow it, and reads none.
		expect(senderProblems("workers/agent/tools.ts", "EMAIL: { value: REFUSING_SENDER }")).toEqual(
			[],
		);
	});
});
