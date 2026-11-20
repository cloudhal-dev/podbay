/**
 * Tier 0: the one pure function that runs a mailbox's rules, the strict schema of the request
 * that saves them, and the facts taken from a parsed message (ADR-0008, decisions 2 to 6 and
 * 11). Whether the automatic reply is owed is in `auto-reply.test.ts`.
 *
 * A message is a stranger's text and a rule is a person's: neither is ever a pattern or an
 * expression here, and nothing in this module can throw on the way of a delivery.
 */
import PostalMime from "postal-mime";
import { describe, expect, it } from "vitest";
import {
	blockedSenderOf,
	cleanText,
	evaluate,
	FACT_LIMITS,
	factsOf,
	isAddress,
	isBlocked,
	isRuleId,
	type MessageFacts,
	newRuleId,
	RULE_LIMITS,
	shownRule,
} from "../../modules/mail/shared/rules.ts";
import { parseRules, parseSender } from "../../modules/mail/shared/rules-schema.ts";
import { factsOfParsed } from "../../modules/mail/worker/lib/rule-facts.ts";

const facts = (over: Partial<MessageFacts> = {}): MessageFacts =>
	factsOf({
		from: "Ada@Sender.test",
		fromName: "Ada Lovelace",
		recipients: ["desk@example.com", "Team@Example.com"],
		subject: "Invoice 42 is OVERDUE",
		text: "Please pay the invoice by Friday.\nThank you",
		hasAttachment: false,
		autoSubmitted: null,
		list: false,
		...over,
	});
const rule = (conditions: unknown, actions: unknown) => ({ id: newRuleId(), conditions, actions });
const LABEL = "lbl_0123456789abcdef01234567";
const OTHER_LABEL = "lbl_89abcdef0123456789abcdef";

describe("the limits of the record (decision 11)", () => {
	it("are 100 rules, 500 blocked senders, 200 characters and 10 labels", () => {
		expect(RULE_LIMITS).toEqual({ rules: 100, blocked: 500, condition: 200, labels: 10 });
	});

	it("cut every field of a message to a fixed length before anything is compared", () => {
		const long = factsOf({
			from: `${"a".repeat(400)}@sender.test`,
			fromName: "n".repeat(500),
			recipients: Array.from({ length: 150 }, (_one, n) => `r${n}@example.com`),
			subject: "s".repeat(5000),
			text: "t".repeat(50_000),
			autoSubmitted: "x".repeat(500),
		});
		expect(long.from).toHaveLength(FACT_LIMITS.address);
		expect(long.fromName).toHaveLength(FACT_LIMITS.name);
		expect(long.recipients).toHaveLength(FACT_LIMITS.recipients);
		expect(long.subject).toHaveLength(FACT_LIMITS.subject);
		expect(long.text).toHaveLength(FACT_LIMITS.text);
		expect(long.autoSubmitted).toHaveLength(FACT_LIMITS.name);
	});

	it("take anything that is not text as nothing", () => {
		expect(
			factsOf({ from: 7, fromName: null, recipients: "a@b.test", subject: {}, text: [] }),
		).toEqual({
			from: "",
			fromName: "",
			recipients: [],
			subject: "",
			text: "",
			hasAttachment: false,
			autoSubmitted: null,
			list: false,
		});
		expect(factsOf({ recipients: ["A@B.test", 3, "", null] }).recipients).toEqual(["a@b.test"]);
		expect(factsOf({ hasAttachment: true, list: true })).toMatchObject({
			hasAttachment: true,
			list: true,
		});
	});
});

describe("conditions (decision 2): plain text, without regard to case", () => {
	const filed = (conditions: unknown, over: Partial<MessageFacts> = {}) =>
		evaluate([], [rule(conditions, { place: "archive" })], facts(over)).place === "archive";

	it("the sender is, or contains: the address, and for contains also the name", () => {
		expect(filed({ from: { match: "is", value: "ada@sender.test" } })).toBe(true);
		expect(filed({ from: { match: "is", value: "ADA@SENDER.TEST" } })).toBe(true);
		expect(filed({ from: { match: "is", value: "ada@sender" } })).toBe(false);
		expect(filed({ from: { match: "is", value: "Ada Lovelace" } })).toBe(false);
		expect(filed({ from: { match: "contains", value: "@sender.test" } })).toBe(true);
		expect(filed({ from: { match: "contains", value: "lovelace" } })).toBe(true);
		expect(filed({ from: { match: "contains", value: "grace" } })).toBe(false);
	});

	it("a recipient is, or contains: any address of To and Cc", () => {
		expect(filed({ to: { match: "is", value: "team@example.com" } })).toBe(true);
		expect(filed({ to: { match: "is", value: "team@example" } })).toBe(false);
		expect(filed({ to: { match: "contains", value: "DESK@" } })).toBe(true);
		expect(filed({ to: { match: "contains", value: "nobody" } })).toBe(false);
	});

	it("the subject contains", () => {
		expect(filed({ subject: "invoice 42" })).toBe(true);
		expect(filed({ subject: "overdue" })).toBe(true);
		expect(filed({ subject: "friday" })).toBe(false);
	});

	it("the message contains the words: each of them, in its subject or its text", () => {
		expect(filed({ words: "friday invoice" })).toBe(true);
		expect(filed({ words: "OVERDUE thank" })).toBe(true);
		expect(filed({ words: "friday refund" })).toBe(false);
	});

	it("it has an attachment", () => {
		expect(filed({ hasAttachment: true })).toBe(false);
		expect(filed({ hasAttachment: true }, { hasAttachment: true })).toBe(true);
	});

	it("all conditions of a rule must hold", () => {
		const both = { from: { match: "contains", value: "sender.test" }, subject: "invoice" };
		expect(filed(both)).toBe(true);
		expect(filed({ ...both, subject: "refund" })).toBe(false);
		expect(filed({ ...both, hasAttachment: true })).toBe(false);
	});

	it.each([
		["a regular expression", { subject: ".*" }],
		["a wildcard of the database", { subject: "%" }],
		["a wildcard of a shell", { subject: "inv*" }],
		["an alternation", { subject: "invoice|refund" }],
		["a class", { from: { match: "contains", value: "[a-z]+@" } }],
		["an anchor", { subject: "^invoice" }],
	])("never reads a condition as %s", (_what, conditions) => {
		expect(filed(conditions)).toBe(false);
	});

	it("matches a character a pattern would give a meaning as itself", () => {
		expect(
			filed({ subject: "50% (off) [today] a.b*c" }, { subject: "Now 50% (OFF) [today] a.b*c!" }),
		).toBe(true);
		expect(filed({ subject: "a.b" }, { subject: "axb" })).toBe(false);
	});

	it("is not slowed by text made to slow a pattern down", () => {
		const hostile = `${"a".repeat(FACT_LIMITS.text)}!`;
		const many = Array.from({ length: RULE_LIMITS.rules }, () =>
			rule({ words: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab ".repeat(6).trim() }, { read: true }),
		);
		const began = performance.now();
		expect(evaluate([], many, facts({ text: hostile, subject: hostile })).matched).toBe(0);
		expect(performance.now() - began).toBeLessThan(2000);
	});
});

describe("actions (decision 3) and the order of rules (decision 5)", () => {
	it("leaves a message no rule matches unread in the Inbox", () => {
		expect(evaluate([], [rule({ subject: "refund" }, { place: "trash" })], facts())).toEqual({
			place: "inbox",
			read: false,
			starred: false,
			labels: [],
			blocked: false,
			matched: 0,
			skipped: 0,
		});
	});

	it("skips the inbox, marks as read, stars and gives labels", () => {
		expect(
			evaluate(
				[],
				[
					rule(
						{ subject: "invoice" },
						{ place: "archive", read: true, star: true, labels: [LABEL] },
					),
				],
				facts(),
			),
		).toMatchObject({ place: "archive", read: true, starred: true, labels: [LABEL], matched: 1 });
	});

	it("applies every rule that matches, and gives a label once", () => {
		const outcome = evaluate(
			[],
			[
				rule({ subject: "invoice" }, { labels: [LABEL] }),
				rule({ subject: "refund" }, { star: true }),
				rule({ words: "friday" }, { read: true, labels: [LABEL, OTHER_LABEL] }),
			],
			facts(),
		);
		expect(outcome).toMatchObject({ read: true, starred: false, matched: 2, place: "inbox" });
		expect(outcome.labels).toEqual([LABEL, OTHER_LABEL]);
	});

	it("lets Trash win over Spam, and Spam over Archive, whatever the order", () => {
		const to = (place: string) => rule({ subject: "invoice" }, { place });
		const placeOf = (...places: string[]) => evaluate([], places.map(to), facts()).place;
		expect(placeOf("archive")).toBe("archive");
		expect(placeOf("archive", "spam")).toBe("spam");
		expect(placeOf("spam", "archive")).toBe("spam");
		expect(placeOf("spam", "trash", "archive")).toBe("trash");
		expect(placeOf("trash", "spam")).toBe("trash");
	});

	it("gives one message no more labels than it can carry", () => {
		const label = (n: number) => `lbl_${n.toString(16).padStart(24, "0")}`;
		const many = Array.from({ length: 10 }, (_one, r) =>
			rule(
				{ subject: "invoice" },
				{ labels: Array.from({ length: 10 }, (_l, n) => label(r * 10 + n)) },
			),
		);
		expect(evaluate([], many, facts()).labels).toHaveLength(FACT_LIMITS.labels);
	});
});

describe("blocked senders (decision 4)", () => {
	it("are an address, or everything at a domain", () => {
		expect(isBlocked(["ada@sender.test"], "Ada@Sender.test")).toBe(true);
		expect(isBlocked(["@sender.test"], "anyone@sender.test")).toBe(true);
		expect(isBlocked(["@sender.test"], "anyone@other.test")).toBe(false);
		expect(isBlocked(["ada@sender.test"], "grace@sender.test")).toBe(false);
		// A domain is that domain, not what ends in it or is under it.
		expect(isBlocked(["@sender.test"], "ada@notsender.test")).toBe(false);
		expect(isBlocked(["@sender.test"], "ada@mail.sender.test")).toBe(false);
		expect(isBlocked(["@sender.test"], "")).toBe(false);
		expect(isBlocked(["sender.test"], "sender.test")).toBe(true);
		expect(isBlocked(["@sender.test"], "no-at-sign")).toBe(false);
		// A character a pattern would give a meaning is itself: it is compared, never matched.
		expect(isBlocked(["%@sender.test", "_da@sender.test"], "ada@sender.test")).toBe(false);
		expect(isBlocked(["%@sender.test"], "%@sender.test")).toBe(true);
	});

	it("go to Spam before any rule, and a rule that sends to Trash still wins", () => {
		expect(evaluate(["ada@sender.test"], [], facts())).toMatchObject({
			place: "spam",
			blocked: true,
			matched: 0,
		});
		expect(
			evaluate(["@sender.test"], [rule({ subject: "invoice" }, { place: "trash" })], facts()),
		).toMatchObject({ place: "trash", blocked: true });
		expect(
			evaluate(["@sender.test"], [rule({ subject: "invoice" }, { place: "archive" })], facts()),
		).toMatchObject({ place: "spam", blocked: true });
	});

	it("are stored as an address in lower case or as @domain", () => {
		expect(blockedSenderOf("  Ada@Sender.TEST ")).toBe("ada@sender.test");
		expect(blockedSenderOf("Sender.test")).toBe("@sender.test");
		expect(blockedSenderOf("@sender.test")).toBe("@sender.test");
		for (const not of [
			"",
			"ada",
			"@",
			"ada@",
			"@sender",
			"a@b@c.test",
			"ada @sender.test",
			"ada@sender..test",
			"<ada@sender.test>",
			"ada@sender.test, grace@sender.test",
			"ada@sender.test\nbcc@sender.test",
			`${"a".repeat(400)}@sender.test`,
			7,
			null,
		]) {
			expect(blockedSenderOf(not), String(not)).toBeNull();
		}
	});

	it("know one whole address from anything else", () => {
		expect(isAddress("ada@sender.test")).toBe(true);
		for (const not of ["ada", "@sender.test", "ada@sender", "a b@sender.test", "a@b.test;"]) {
			expect(isAddress(not), not).toBe(false);
		}
		expect(isAddress(`${"a".repeat(250)}@sender.test`)).toBe(false);
		expect(isAddress(`a@${"d".repeat(250)}.test`)).toBe(false);
	});
});

describe("a rule that cannot be evaluated is skipped and counted (decision 6)", () => {
	const good = rule({ subject: "invoice" }, { star: true });

	it.each([
		["is not a rule", "nonsense"],
		["is nothing", null],
		["is a list", [1, 2]],
		["has no conditions", { actions: { read: true } }],
		["has conditions that are not an object", rule("subject:invoice", { read: true })],
		["has an empty set of conditions", rule({}, { read: true })],
		["has a condition the vocabulary does not have", rule({ header: "x" }, { read: true })],
		["has a subject that is not text", rule({ subject: 42 }, { read: true })],
		["has an empty subject", rule({ subject: "" }, { read: true })],
		["has words that are only spaces", rule({ words: "   " }, { read: true })],
		["has words that are not text", rule({ words: ["a"] }, { read: true })],
		["has a condition far over its length", rule({ subject: "s".repeat(801) }, { read: true })],
		["has a sender that is not a condition", rule({ from: "ada@sender.test" }, { read: true })],
		[
			"has a way of matching it does not know",
			rule({ from: { match: "regex", value: "a" } }, { read: true }),
		],
		["has a recipient without a value", rule({ to: { match: "is" } }, { read: true })],
		["asks for no attachment", rule({ hasAttachment: false }, { read: true })],
		["has no actions", { conditions: { subject: "invoice" } }],
		["has actions that are not an object", rule({ subject: "invoice" }, "read")],
		["has an action that does nothing", rule({ subject: "invoice" }, {})],
		["has a place it does not know", rule({ subject: "invoice" }, { place: "inbox" })],
		["forwards", rule({ subject: "invoice" }, { forward: "elsewhere@outside.test" })],
		["has labels that are not ids", rule({ subject: "invoice" }, { labels: [1, null] })],
	])("a rule that %s", (_what, broken) => {
		const outcome = evaluate([], [broken, good], facts());
		expect(outcome.skipped).toBe(1);
		// The rule after it still runs, and nothing was thrown.
		expect(outcome).toMatchObject({ matched: 1, starred: true, place: "inbox", read: false });
	});

	it("is skipped when reading it throws, and the next rule still runs", () => {
		const trap = {
			get conditions(): never {
				throw new Error("no");
			},
			actions: { read: true },
		};
		expect(evaluate([], [trap, good], facts())).toMatchObject({ skipped: 1, matched: 1 });
	});

	it("keeps the known actions of a rule that also has labels that are not text", () => {
		expect(
			evaluate([], [rule({ subject: "invoice" }, { read: true, labels: [LABEL, 3] })], facts()),
		).toMatchObject({ read: true, labels: [LABEL], skipped: 0 });
	});

	it("files a message whose facts are not facts in the Inbox, with every rule counted", () => {
		const broken = { ...facts(), recipients: null } as unknown as MessageFacts;
		expect(evaluate(["@sender.test"], [good, good], broken)).toMatchObject({
			place: "inbox",
			skipped: 2,
			matched: 0,
		});
	});
});

describe("a stored rule as it is shown", () => {
	it("is the rule when the vocabulary knows it, and nothing when it does not", () => {
		const id = newRuleId();
		expect(
			shownRule(id, { conditions: { subject: "x" }, actions: { read: true, other: 1 } }),
		).toEqual({
			id,
			conditions: { subject: "x" },
			actions: { read: true },
		});
		for (const not of [
			null,
			"rule",
			{ conditions: "x", actions: { read: true } },
			{ conditions: { subject: 42 }, actions: { read: true } },
			{ conditions: { regex: ".*" }, actions: { read: true } },
			{ conditions: { subject: "x" }, actions: {} },
			{ conditions: {}, actions: { read: true } },
		]) {
			expect(shownRule(id, not)).toBeNull();
		}
	});
});

describe("ids and stored text", () => {
	it("an id is opaque and has one shape", () => {
		expect(isRuleId(newRuleId())).toBe(true);
		expect(newRuleId()).not.toBe(newRuleId());
		for (const not of ["rul_1", "lbl_0123456789abcdef01234567", "", 3, null]) {
			expect(isRuleId(not)).toBe(false);
		}
	});

	it("a condition is stored trimmed, in one form, and no longer than 200 characters", () => {
		expect(cleanText("  two   words \n")).toBe("two words");
		expect(cleanText("é")).toBe("é");
		expect(cleanText("x".repeat(200))).toHaveLength(200);
		expect(cleanText("x".repeat(201))).toBeNull();
		expect(cleanText("   ")).toBeNull();
		expect(cleanText(5)).toBeNull();
	});
});

describe("the request of PUT …/rules (rule D2)", () => {
	const one = { conditions: { subject: " Invoice " }, actions: { read: true } };

	it("takes the vocabulary, cleans the text and gives every rule an id", () => {
		const parsed = parseRules({
			rules: [
				one,
				{
					id: "rul_0123456789abcdef01234567",
					conditions: {
						from: { match: "is", value: "Ada@Sender.test" },
						to: { match: "contains", value: "desk" },
						words: "pay  friday",
						hasAttachment: true,
					},
					actions: { place: "spam", star: true, labels: [LABEL, LABEL] },
				},
			],
		});
		if ("refused" in parsed) throw new Error(parsed.refused);
		expect(parsed.rules[0]).toMatchObject({ conditions: { subject: "Invoice" } });
		expect(isRuleId(parsed.rules[0]?.id)).toBe(true);
		expect(parsed.rules[1]).toEqual({
			id: "rul_0123456789abcdef01234567",
			conditions: {
				from: { match: "is", value: "Ada@Sender.test" },
				to: { match: "contains", value: "desk" },
				words: "pay friday",
				hasAttachment: true,
			},
			actions: { place: "spam", star: true, labels: [LABEL] },
		});
		expect(parseRules({ rules: [] })).toEqual({ rules: [] });
	});

	it.each([
		["nothing", null],
		["no list", {}],
		["a key it does not know", { rules: [], extra: 1 }],
		["a rule with a key it does not know", { rules: [{ ...one, name: "x" }] }],
		[
			"a condition it does not know",
			{ rules: [{ ...one, conditions: { subject: "x", header: "x" } }] },
		],
		[
			"an action it does not know",
			{ rules: [{ ...one, actions: { read: true, forward: "a@b.test" } }] },
		],
		["a rule that rejects", { rules: [{ ...one, actions: { read: true, reject: true } }] }],
		["a place that is not one", { rules: [{ ...one, actions: { place: "inbox" } }] }],
		["no condition", { rules: [{ ...one, conditions: {} }] }],
		["no action", { rules: [{ ...one, actions: {} }] }],
		["an empty condition", { rules: [{ ...one, conditions: { subject: "  " } }] }],
		["an empty sender", { rules: [{ ...one, conditions: { from: { match: "is", value: " " } } }] }],
		[
			"a condition over 200 characters",
			{ rules: [{ ...one, conditions: { words: "w".repeat(201) } }] },
		],
		[
			"a way of matching that is not one",
			{ rules: [{ ...one, conditions: { to: { match: "regex", value: "a" } } }] },
		],
		[
			"a subject that is matched exactly",
			{ rules: [{ ...one, conditions: { subject: { match: "is", value: "a" } } }] },
		],
		["no attachment asked for", { rules: [{ ...one, conditions: { hasAttachment: false } }] }],
		["a label that is not an id", { rules: [{ ...one, actions: { labels: ["Work"] } }] }],
		[
			"eleven labels",
			{
				rules: [
					{
						...one,
						actions: {
							labels: Array.from(
								{ length: 11 },
								(_l, n) => `lbl_${n.toString(16).padStart(24, "0")}`,
							),
						},
					},
				],
			},
		],
		["an id that is not one", { rules: [{ ...one, id: "1" }] }],
		[
			"the same id twice",
			{
				rules: [
					{ ...one, id: "rul_0123456789abcdef01234567" },
					{ ...one, id: "rul_0123456789abcdef01234567" },
				],
			},
		],
	])("refuses %s, whole", (_what, body) => {
		expect(parseRules(body)).toEqual({ refused: "invalid" });
	});

	it("takes 100 rules and says of 101 that they are too many", () => {
		const many = (count: number) => ({ rules: Array.from({ length: count }, () => one) });
		expect("rules" in parseRules(many(RULE_LIMITS.rules))).toBe(true);
		expect(parseRules(many(RULE_LIMITS.rules + 1))).toEqual({ refused: "too_many" });
		expect(parseRules(many(RULE_LIMITS.rules + 2))).toEqual({ refused: "invalid" });
	});

	it("reads the sender of a block from the body, and nothing else", () => {
		expect(parseSender({ sender: "Ada@Sender.test" })).toBe("ada@sender.test");
		expect(parseSender({ sender: "sender.test" })).toBe("@sender.test");
		expect(parseSender({ sender: "ada" })).toBeNull();
		expect(parseSender({ sender: "ada@sender.test", also: 1 })).toBeNull();
		expect(parseSender({})).toBeNull();
		expect(parseSender(null)).toBeNull();
	});

	it("blocks one whole address, never a domain, when the request says it means an address", () => {
		const address = (sender: string) => parseSender({ sender, kind: "address" });
		expect(address("Ada@Sender.test")).toBe("ada@sender.test");
		// A From without an @ would otherwise be read as a domain.
		expect(address("sender.test")).toBeNull();
		expect(address("@sender.test")).toBeNull();
		expect(parseSender({ sender: "sender.test", kind: "domain" })).toBe("@sender.test");
		expect(parseSender({ sender: "ada@sender.test", kind: "domain" })).toBeNull();
		expect(parseSender({ sender: "ada@sender.test", kind: "everything" })).toBeNull();
	});
});

describe("the facts of a parsed message", () => {
	const parse = (raw: string) => PostalMime.parse(raw.replace(/\n/g, "\r\n"));

	it("are the sender, everyone in To and Cc, the subject, the text and whether a file came along", async () => {
		const parsed = await parse(
			[
				'From: "Ada Lovelace" <ADA@Sender.test>',
				"To: desk@example.com, Team: one@example.com, two@example.com;",
				"Cc: Copy <COPY@example.com>",
				"Bcc: hidden@example.com",
				"Subject: A subject",
				"MIME-Version: 1.0",
				'Content-Type: multipart/mixed; boundary="b"',
				"",
				"--b",
				"Content-Type: text/plain",
				"",
				"The text.",
				"--b",
				'Content-Type: text/plain; name="a.txt"',
				'Content-Disposition: attachment; filename="a.txt"',
				"",
				"file",
				"--b--",
				"",
			].join("\n"),
		);
		expect(factsOfParsed(parsed)).toEqual({
			from: "ada@sender.test",
			fromName: "Ada Lovelace",
			recipients: ["desk@example.com", "one@example.com", "two@example.com", "copy@example.com"],
			subject: "A subject",
			text: "The text.",
			hasAttachment: true,
			autoSubmitted: null,
			list: false,
		});
	});

	it("take the text of the HTML when there is no other, and no script of it", async () => {
		const parsed = await parse(
			[
				"From: ada@sender.test",
				"Subject: HTML only",
				"MIME-Version: 1.0",
				"Content-Type: text/html",
				"",
				"<p>Shown <b>words</b></p><script>hidden()</script><style>p{}</style>",
				"",
			].join("\n"),
		);
		const facts = factsOfParsed(parsed);
		expect(facts.text).toContain("Shown words");
		expect(facts.text).not.toMatch(/hidden|p\{\}/);
		expect(facts).toMatchObject({ recipients: [], hasAttachment: false });
	});

	it("say when a program or a list sent it", async () => {
		const withHeaders = async (...lines: string[]) =>
			factsOfParsed(await parse(["From: a@sender.test", ...lines, "", "x", ""].join("\n")));
		expect(await withHeaders("Auto-Submitted: auto-replied")).toMatchObject({
			autoSubmitted: "auto-replied",
			list: false,
		});
		for (const line of [
			"List-Id: <news.lists.test>",
			"List-Unsubscribe: <mailto:leave@lists.test>",
			"List-Post: <mailto:news@lists.test>",
			"Precedence: bulk",
			"Precedence:  LIST ",
			"Precedence: junk",
		]) {
			expect((await withHeaders(line)).list, line).toBe(true);
		}
		for (const line of ["Precedence: first-class", "X-List: yes", "Listed-By: someone"]) {
			expect((await withHeaders(line)).list, line).toBe(false);
		}
	});

	it("do not count an image a message embeds as an attachment", async () => {
		const parsed = await parse(
			[
				"From: a@sender.test",
				"MIME-Version: 1.0",
				'Content-Type: multipart/related; boundary="b"',
				"",
				"--b",
				"Content-Type: text/html",
				"",
				'<img src="cid:one">',
				"--b",
				"Content-Type: image/png",
				"Content-Disposition: inline",
				"Content-ID: <one>",
				"Content-Transfer-Encoding: base64",
				"",
				"iVBORw0KGgo=",
				"--b--",
				"",
			].join("\n"),
		);
		expect(factsOfParsed(parsed).hasAttachment).toBe(false);
	});
});
