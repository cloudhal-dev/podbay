/**
 * Tier 3: a mailbox has rules for its incoming mail (ADR-0008, decisions 1 to 7, 11 and 12;
 * boundaries B1 and B4).
 *
 * - a filter files, marks and labels a message when it arrives, and never afterwards;
 * - a blocked sender's mail goes to Spam, by address or by domain; unblocking ends it;
 * - blocked senders first, then every rule in order; Trash wins over Spam, Spam over Archive;
 * - a rule cannot fail a delivery: a broken rule, a broken table and a hostile message each
 *   leave the message stored and nothing rejected;
 * - what a stranger writes is compared and never run: no pattern, no statement;
 * - seeing rules is reading, changing them is the owner's; someone without a membership is
 *   told nothing, whatever they manage; every change is on the record without a word of it;
 * - one mailbox never sees or runs another's rules;
 * - the limits of the record; the tables come with the database of the release before.
 */
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { RULE_LIMITS, type RulesAnswer } from "../../modules/mail/shared/rules.ts";
import {
	applyMigrations,
	mailboxMigrations,
} from "../../modules/mail/worker/durableObject/migrations.ts";
import { ROUTE_TABLE } from "../../workers/auth/route-table.ts";
import { json, mime } from "./helpers.ts";
import {
	as,
	audited,
	DESK,
	deliver,
	inMailbox,
	labelsOf,
	M,
	OTHER,
	path,
	people,
	rows,
	signedInAgain,
	stored,
} from "./rules-helpers.ts";

const put = (who: string, at: string, body: unknown) =>
	as(who).fetch(at, { method: "PUT", body: JSON.stringify(body) });
const del = (who: string, at: string, body: unknown) =>
	as(who).fetch(at, { method: "DELETE", body: JSON.stringify(body) });
const setRules = async (rules: unknown[], mailbox = DESK) => {
	const res = await put("owner", `${path(mailbox)}/rules`, { rules });
	expect(res.status, "saving the rules").toBe(200);
	return json<RulesAnswer>(res);
};
const getRules = async (who = "owner", mailbox = DESK) =>
	json<RulesAnswer>(await as(who).fetch(`${path(mailbox)}/rules`));
const block = (sender: string, who = "owner", mailbox = DESK) =>
	as(who).post(`${path(mailbox)}/blocked-senders`, { sender });

/** Delivers one message and gives its row. Nothing may be rejected or thrown on the way. */
async function arrives(
	subject: string,
	headers: Record<string, string> = {},
	options: { body?: string; from?: string; to?: string } = {},
) {
	const result = await deliver(
		mime({ From: "Ada <ada@sender.test>", To: DESK, Subject: subject, ...headers }, options.body),
		{ from: options.from, to: options.to },
	);
	expect(result, `delivering "${subject}"`).toEqual({ rejections: [], threw: null });
	const row = await stored(subject, options.to ?? DESK);
	if (row === undefined) throw new Error(`"${subject}" was not stored`);
	return row;
}

async function label(name: string, mailbox = DESK): Promise<string> {
	const res = await as("owner").post(`${path(mailbox)}/labels`, { name });
	expect(res.status).toBe(201);
	return (await json<{ id: string }>(res)).id;
}

beforeAll(() => people());

describe("without a rule", () => {
	it("a mailbox has none, and mail arrives unread in the Inbox as before", async () => {
		expect(await getRules()).toEqual({ rules: [], blocked: [] });
		expect(await arrives("Plain")).toMatchObject({ folder_id: "inbox", read: 0, starred: 0 });
	});

	it("a new mailbox's settings carry neither forwarding nor an automatic reply", async () => {
		const mailbox = await json<{ settings: Record<string, unknown> }>(await as("owner").fetch(M));
		expect(Object.keys(mailbox.settings).sort()).toEqual(["fromName", "signature"]);
	});
});

describe("a filter acts when a message arrives", () => {
	it("skips the inbox, marks as read, stars and gives labels", async () => {
		const work = await label("Work");
		const bills = await label("Bills");
		await setRules([
			{
				conditions: { subject: "invoice" },
				actions: { place: "archive", read: true, star: true, labels: [work, bills] },
			},
		]);
		const row = await arrives("Your INVOICE for May");
		expect(row).toMatchObject({ folder_id: "archive", read: 1, starred: 1 });
		expect(await labelsOf(row.id)).toEqual(["Bills", "Work"]);
		// What the rule does not match is left alone.
		const other = await arrives("A postcard");
		expect(other).toMatchObject({ folder_id: "inbox", read: 0, starred: 0 });
		expect(await labelsOf(other.id)).toEqual([]);
	});

	it("moves to Trash and to Spam, and gives no label there", async () => {
		const work = await label("Hidden");
		await setRules([
			{ conditions: { subject: "lottery" }, actions: { place: "spam", labels: [work] } },
			{ conditions: { subject: "newsletter" }, actions: { place: "trash", labels: [work] } },
		]);
		const spam = await arrives("You won the lottery");
		const trash = await arrives("Weekly newsletter");
		expect(spam.folder_id).toBe("spam");
		expect(trash.folder_id).toBe("trash");
		expect(await labelsOf(spam.id)).toEqual([]);
		expect(await labelsOf(trash.id)).toEqual([]);
	});

	it("matches the sender, a recipient, the words and an attachment", async () => {
		await setRules([
			{
				conditions: { from: { match: "is", value: "grace@sender.test" } },
				actions: { star: true },
			},
			{ conditions: { to: { match: "contains", value: "billing@" } }, actions: { read: true } },
			{ conditions: { words: "refund friday" }, actions: { place: "archive" } },
			{ conditions: { hasAttachment: true }, actions: { place: "trash" } },
		]);
		expect(await arrives("From Grace", { From: "Grace <GRACE@sender.test>" })).toMatchObject({
			folder_id: "inbox",
			starred: 1,
			read: 0,
		});
		expect(await arrives("Copied to billing", { Cc: "Billing@example.com" })).toMatchObject({
			read: 1,
			starred: 0,
		});
		expect(await arrives("Words", {}, { body: "Your REFUND arrives on\r\nFriday." })).toMatchObject(
			{ folder_id: "archive" },
		);
		expect(await arrives("One word", {}, { body: "Your refund arrives." })).toMatchObject({
			folder_id: "inbox",
		});
		const withFile = [
			"From: Ada <ada@sender.test>",
			`To: ${DESK}`,
			"Subject: With a file",
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
		expect(await deliver(withFile)).toEqual({ rejections: [], threw: null });
		expect(await stored("With a file")).toMatchObject({ folder_id: "trash" });
	});

	it("applies every rule that matches, and lets Trash win over Spam and Spam over Archive", async () => {
		const first = await label("First");
		const second = await label("Second");
		await setRules([
			{ conditions: { subject: "order" }, actions: { place: "archive", labels: [first] } },
			{ conditions: { subject: "order" }, actions: { star: true, labels: [second] } },
			{ conditions: { subject: "junk" }, actions: { place: "spam" } },
			{ conditions: { subject: "junk" }, actions: { place: "archive" } },
			{ conditions: { subject: "bin" }, actions: { place: "trash" } },
			{ conditions: { subject: "bin" }, actions: { place: "spam" } },
		]);
		const both = await arrives("An order");
		expect(both).toMatchObject({ folder_id: "archive", starred: 1 });
		expect(await labelsOf(both.id)).toEqual(["First", "Second"]);
		expect((await arrives("Some junk")).folder_id).toBe("spam");
		expect((await arrives("For the bin")).folder_id).toBe("trash");
	});

	it("never runs on mail that is already stored", async () => {
		await setRules([]);
		const before = await arrives("Stored before the rule");
		await setRules([{ conditions: { subject: "stored before" }, actions: { place: "trash" } }]);
		expect(await stored("Stored before the rule")).toMatchObject({
			id: before.id,
			folder_id: "inbox",
		});
		// The same words in a message that arrives now are filed.
		expect((await arrives("Stored before the rule, again")).folder_id).toBe("trash");
	});

	it("ignores a label that is gone, and one of another mailbox", async () => {
		const gone = await label("Gone soon");
		const foreign = await label("Foreign", OTHER);
		await setRules([
			{ conditions: { subject: "labelled" }, actions: { labels: [gone, foreign], star: true } },
		]);
		expect((await as("owner").fetch(`${M}/labels/${gone}`, { method: "DELETE" })).status).toBe(204);
		const row = await arrives("Labelled");
		expect(row).toMatchObject({ folder_id: "inbox", starred: 1 });
		expect(await labelsOf(row.id)).toEqual([]);
		expect(await rows(`SELECT 1 FROM email_labels WHERE label_id = ?1`, DESK, foreign)).toEqual([]);
	});
});

describe("a blocked sender", () => {
	it("goes to Spam by its address, whatever the case, and others at the domain do not", async () => {
		await setRules([]);
		const made = await block("Ada@Sender.test");
		expect(made.status).toBe(201);
		expect(await json(made)).toMatchObject({ sender: "ada@sender.test" });
		expect((await arrives("From the blocked one")).folder_id).toBe("spam");
		expect(
			(await arrives("From a colleague", { From: "Grace <grace@sender.test>" })).folder_id,
		).toBe("inbox");
		// Blocking the same sender again changes nothing and is no second rule.
		expect((await block("ada@sender.test")).status).toBe(200);
		expect((await getRules()).blocked.map((one) => one.sender)).toEqual(["ada@sender.test"]);
	});

	it("is unblocked, and then its mail arrives in the Inbox again", async () => {
		expect((await del("owner", `${M}/blocked-senders`, { sender: "ada@sender.test" })).status).toBe(
			204,
		);
		expect((await getRules()).blocked).toEqual([]);
		expect((await arrives("After unblocking")).folder_id).toBe("inbox");
		const again = await del("owner", `${M}/blocked-senders`, { sender: "ada@sender.test" });
		expect(again.status).toBe(404);
	});

	it("can be everything at a domain, and only that domain", async () => {
		expect((await block("bulk.test")).status).toBe(201);
		expect((await getRules()).blocked.map((one) => one.sender)).toEqual(["@bulk.test"]);
		expect((await arrives("Domain one", { From: "a@bulk.test" })).folder_id).toBe("spam");
		expect((await arrives("Domain two", { From: "Someone <b@BULK.test>" })).folder_id).toBe("spam");
		expect((await arrives("Under it", { From: "a@mail.bulk.test" })).folder_id).toBe("inbox");
		expect((await arrives("Ends in it", { From: "a@notbulk.test" })).folder_id).toBe("inbox");
	});

	it("is filed before the rules, and a rule that sends to Trash still wins", async () => {
		await setRules([
			{ conditions: { subject: "keep" }, actions: { place: "archive", star: true } },
			{ conditions: { subject: "bin" }, actions: { place: "trash" } },
		]);
		expect(await arrives("Keep this", { From: "a@bulk.test" })).toMatchObject({
			folder_id: "spam",
			starred: 1,
		});
		expect((await arrives("Bin this", { From: "a@bulk.test" })).folder_id).toBe("trash");
		await setRules([]);
	});

	it("is one whole address when the request says so, and never becomes a whole domain", async () => {
		const asked = (sender: string, kind: string) =>
			as("owner").post(`${M}/blocked-senders`, { sender, kind });
		const before = (await getRules()).blocked;
		// What a message's From gives when it has no @ in it.
		expect((await asked("sender.test", "address")).status).toBe(400);
		expect((await asked("@sender.test", "address")).status).toBe(400);
		expect((await asked("ada@sender.test", "domain")).status).toBe(400);
		expect((await getRules()).blocked).toEqual(before);
		expect((await asked("Grace@Sender.test", "address")).status).toBe(201);
		expect((await getRules()).blocked.map((one) => one.sender)).toContain("grace@sender.test");
		expect((await getRules()).blocked.map((one) => one.sender)).not.toContain("@sender.test");
		expect(
			(await del("owner", `${M}/blocked-senders`, { sender: "grace@sender.test" })).status,
		).toBe(204);
	});

	it("is known by the envelope sender when the message cannot be read", async () => {
		expect((await block("deep@nest.test")).status).toBe(201);
		// Nested deeper than the parser goes: filed with its original, by its envelope sender.
		const depth = 300;
		const open = Array.from(
			{ length: depth },
			(_one, n) => `Content-Type: multipart/mixed; boundary="b${n}"\r\n\r\n--b${n}\r\n`,
		).join("");
		const raw = `From: someone@else.test\r\nTo: ${DESK}\r\nSubject: Too deep\r\n${open}Content-Type: text/plain\r\n\r\nx\r\n`;
		expect(await deliver(raw, { from: "Deep@nest.test" })).toEqual({ rejections: [], threw: null });
		const row = (
			await rows<{ folder_id: string; unparsed: string | null }>(
				`SELECT folder_id, unparsed FROM emails WHERE sender = 'deep@nest.test'`,
			)
		)[0];
		expect(row).toEqual({ folder_id: "spam", unparsed: "parser" });
	});
});

describe("the assistant is told only of mail in the Inbox", () => {
	/** The environment with the assistant on, and an assistant of the test that counts wakes. */
	function withAssistant() {
		const woken: string[] = [];
		const agent = {
			idFromName: (name: string) => name,
			get: () => ({
				fetch: async (request: Request) => {
					woken.push(((await request.json()) as { subject: string }).subject);
					return new Response(null, { status: 204 });
				},
			}),
		};
		return { woken, env: { ...env, AGENT_ENABLED: "true", EMAIL_AGENT: agent } };
	}

	it("is never woken for mail a rule filed elsewhere, or from a blocked sender", async () => {
		await setRules([
			{ conditions: { subject: "receipt" }, actions: { place: "archive" } },
			{ conditions: { subject: "lottery" }, actions: { place: "spam" } },
			{ conditions: { subject: "newsletter" }, actions: { place: "trash" } },
		]);
		expect((await block("blocked@sender.test")).status).toBe(201);
		const assistant = withAssistant();
		const send = async (subject: string, from = "Ada <ada@sender.test>") => {
			const raw = mime({ From: from, To: DESK, Subject: subject });
			expect(await deliver(raw, { env: assistant.env })).toEqual({ rejections: [], threw: null });
		};
		await send("A receipt");
		await send("The lottery");
		await send("A newsletter");
		await send("From the blocked one", "blocked@sender.test");
		expect((await stored("A receipt"))?.folder_id).toBe("archive");
		expect((await stored("From the blocked one"))?.folder_id).toBe("spam");
		expect(assistant.woken).toEqual([]);
		// Control: mail the rules leave in the Inbox wakes it, once.
		await send("Lunch on Friday?");
		expect(assistant.woken).toEqual(["Lunch on Friday?"]);
		await setRules([]);
		expect(
			(await del("owner", `${M}/blocked-senders`, { sender: "blocked@sender.test" })).status,
		).toBe(204);
	});
});

describe("a rule cannot fail a delivery (decision 6)", () => {
	it("skips a stored rule that cannot be evaluated, and the next rule still runs", async () => {
		await setRules([{ conditions: { subject: "survives" }, actions: { star: true } }]);
		await inMailbox((sql) => {
			const add = (id: string, position: number, body: string) =>
				sql.exec(
					`INSERT INTO rules (id, kind, position, sender, body, set_at, set_by)
					 VALUES (?1, 'filter', ?2, NULL, ?3, '2026-11-18T00:00:00.000Z', 'test')`,
					id,
					position,
					body,
				);
			add("rul_broken_json", -3, "{not json");
			add("rul_broken_shape", -2, JSON.stringify({ conditions: { subject: 42 }, actions: {} }));
			add(
				"rul_broken_verb",
				-1,
				JSON.stringify({ conditions: { regex: ".*" }, actions: { place: "trash" } }),
			);
		});
		expect(await arrives("It survives")).toMatchObject({ folder_id: "inbox", starred: 1 });
		// What cannot be read is not shown as a rule either.
		expect((await getRules()).rules).toHaveLength(1);
		await setRules([]);
	});

	it("files the message in the Inbox when the rules cannot be read at all", async () => {
		await setRules([{ conditions: { subject: "table" }, actions: { place: "trash" } }]);
		await inMailbox((sql) => sql.exec(`ALTER TABLE rules RENAME TO rules_away`));
		try {
			expect(await arrives("The table is gone")).toMatchObject({ folder_id: "inbox", read: 0 });
		} finally {
			await inMailbox((sql) => sql.exec(`ALTER TABLE rules_away RENAME TO rules`));
		}
		expect((await arrives("The table is back")).folder_id).toBe("trash");
		await setRules([]);
	});

	it("reads what a stranger wrote as text: no pattern and no statement", async () => {
		await setRules([
			{ conditions: { subject: "%" }, actions: { place: "trash" } },
			{ conditions: { subject: ".*" }, actions: { place: "trash" } },
			{ conditions: { from: { match: "contains", value: "_da@" } }, actions: { place: "trash" } },
			{ conditions: { words: "'; DROP TABLE emails; --" }, actions: { star: true } },
		]);
		// A wildcard in a rule matches nothing but itself.
		expect((await arrives("An ordinary subject")).folder_id).toBe("inbox");
		expect((await arrives("100% true")).folder_id).toBe("trash");
		// A statement in a message, and in a rule, is words.
		const hostile = await arrives(
			"x'); DELETE FROM rules; --",
			{},
			{
				body: "'; DROP TABLE emails; -- and more",
			},
		);
		expect(hostile).toMatchObject({ folder_id: "inbox", starred: 1 });
		expect((await getRules()).rules).toHaveLength(4);
		expect((await block("x'); DELETE FROM rules; --@sender.test")).status).toBe(400);
		expect((await block("'OR'1'='1@sender.test")).status).toBe(201);
		// It is an address like any other: its own mail is blocked, and nobody else's.
		expect((await arrives("Quoted sender", { From: "\"'OR'1'='1\"@sender.test" })).folder_id).toBe(
			"spam",
		);
		expect((await arrives("Another sender", { From: "grace@sender.test" })).folder_id).toBe(
			"inbox",
		);
		await inMailbox((sql) => sql.exec(`DELETE FROM rules WHERE kind = 'block'`));
		await setRules([]);
	});
});

describe("who may see and change rules (decision 7)", () => {
	const RULES = { rules: [{ conditions: { subject: "x" }, actions: { read: true } }] };

	it("names the six routes of the record with their rights", () => {
		const rights = Object.fromEntries(
			ROUTE_TABLE.filter((route) => /\/(rules|blocked-senders|auto-reply)$/.test(route.path)).map(
				(route) => [
					`${route.method} ${route.path.replace("/api/v1/mailboxes/:mailboxId", "…")}`,
					`${route.right}${route.fresh === true ? " fresh" : ""}`,
				],
			),
		);
		expect(rights).toEqual({
			"GET …/rules": "mailbox.read",
			"PUT …/rules": "mailbox.manage",
			"POST …/blocked-senders": "mailbox.manage",
			"DELETE …/blocked-senders": "mailbox.manage",
			"GET …/auto-reply": "mailbox.read",
			"PUT …/auto-reply": "mailbox.manage fresh",
		});
	});

	it("lets a reader and a sender see them and change nothing", async () => {
		await setRules(RULES.rules);
		expect((await block("bulk.test")).status).toBe(201);
		for (const who of ["reader", "sender"]) {
			expect((await as(who).fetch(`${M}/rules`)).status, who).toBe(200);
			expect((await getRules(who)).rules).toHaveLength(1);
			expect((await put(who, `${M}/rules`, { rules: [] })).status, who).toBe(403);
			expect((await block("blocked-by@nobody.test", who)).status, who).toBe(403);
			expect((await del(who, `${M}/blocked-senders`, { sender: "@bulk.test" })).status, who).toBe(
				403,
			);
		}
		const after = await getRules();
		expect(after.rules).toHaveLength(1);
		expect(after.blocked.map((one) => one.sender)).toContain("@bulk.test");
		expect(after.blocked.map((one) => one.sender)).not.toContain("blocked-by@nobody.test");
		await inMailbox((sql) => sql.exec(`DELETE FROM rules WHERE kind = 'block'`));
	});

	it("tells someone without a membership nothing, whatever they manage", async () => {
		for (const who of ["outsider", "admin"]) {
			expect((await as(who).fetch(`${M}/rules`)).status, who).toBe(404);
			expect((await put(who, `${M}/rules`, RULES)).status, who).toBe(404);
			expect((await block("x@y.test", who)).status, who).toBe(404);
			expect((await del(who, `${M}/blocked-senders`, { sender: "x@y.test" })).status, who).toBe(
				404,
			);
		}
	});

	it("serves nobody without a session or from another origin", async () => {
		const { request } = await import("./helpers.ts");
		expect((await request(`${M}/rules`)).status).toBe(401);
		const foreign = await as("owner").fetch(`${M}/rules`, {
			method: "PUT",
			body: JSON.stringify(RULES),
			headers: { origin: "https://elsewhere.test" },
		});
		expect(foreign.status).toBe(403);
		const blocked = await as("owner").fetch(`${M}/blocked-senders`, {
			method: "POST",
			body: JSON.stringify({ sender: "x@y.test" }),
			headers: { origin: "https://elsewhere.test" },
		});
		expect(blocked.status).toBe(403);
	});

	it("keeps one mailbox's rules out of another", async () => {
		await setRules([{ conditions: { subject: "only here" }, actions: { place: "trash" } }]);
		expect(await getRules("owner", OTHER)).toEqual({ rules: [], blocked: [] });
		const elsewhere = await arrives(
			"Only here, they say",
			{ From: "a@bulk.test", To: OTHER },
			{ to: OTHER },
		);
		expect(elsewhere.folder_id).toBe("inbox");
		// A rule id of another mailbox is a new rule here, not a way to its rule.
		const [mine] = (await getRules()).rules;
		const copied = await put("owner", `${path(OTHER)}/rules`, {
			rules: [{ id: mine?.id, conditions: { subject: "copied" }, actions: { read: true } }],
		});
		expect(copied.status).toBe(200);
		expect((await getRules()).rules[0]?.conditions).toEqual({ subject: "only here" });
		await put("owner", `${path(OTHER)}/rules`, { rules: [] });
		await setRules([]);
	});

	it("records every change with who, which mailbox and how many, never a word of a rule", async () => {
		await setRules([
			{
				conditions: { from: { match: "is", value: "secret-correspondent@private.test" } },
				actions: { read: true },
			},
			{ conditions: { subject: "secret project" }, actions: { star: true } },
		]);
		expect((await block("secret-correspondent@private.test")).status).toBe(201);
		expect(
			(await del("owner", `${M}/blocked-senders`, { sender: "secret-correspondent@private.test" }))
				.status,
		).toBe(204);
		const changed = await audited("mailbox.rules_changed");
		expect(changed.at(-1)).toMatchObject({ target: DESK });
		expect(JSON.parse(changed.at(-1)?.detail ?? "{}")).toEqual({ before: 0, after: 2 });
		const blocked = await audited("mailbox.sender_blocked");
		expect(JSON.parse(blocked.at(-1)?.detail ?? "{}")).toEqual({ kind: "address" });
		expect((await audited("mailbox.sender_unblocked")).length).toBeGreaterThan(0);
		const all = JSON.stringify([
			...changed,
			...blocked,
			...(await audited("mailbox.sender_unblocked")),
		]);
		expect(all).not.toContain("secret");
		expect(all).not.toContain("private.test");
		await setRules([]);
	});
});

describe("what a request may say (decisions 2, 3 and 11)", () => {
	const good = { conditions: { subject: "x" }, actions: { read: true } };

	it.each([
		// Each beside something the vocabulary has: the unknown word alone refuses the request.
		[
			"a rule that forwards",
			{ rules: [{ ...good, actions: { read: true, forward: "x@y.test" } }] },
		],
		["a rule that rejects", { rules: [{ ...good, actions: { read: true, reject: true } }] }],
		[
			"a rule with a pattern field",
			{ rules: [{ ...good, conditions: { subject: "x", regex: ".*" } }] },
		],
		["a rule with a name of its own", { rules: [{ ...good, name: "mine" }] }],
		["a rule without a condition", { rules: [{ ...good, conditions: {} }] }],
		["a rule without an action", { rules: [{ ...good, actions: {} }] }],
		[
			"a condition of 201 characters",
			{ rules: [{ ...good, conditions: { subject: "s".repeat(201) } }] },
		],
		["a label that is not an id", { rules: [{ ...good, actions: { labels: ["Work"] } }] }],
		["something that is no list", { rules: "all" }],
		["nothing", null],
	])("refuses %s and changes nothing", async (_what, body) => {
		await setRules([good]);
		const res = await put("owner", `${M}/rules`, body);
		expect(res.status).toBe(400);
		expect((await getRules()).rules).toHaveLength(1);
	});

	it("takes 100 rules and refuses 101", async () => {
		const many = (count: number) =>
			Array.from({ length: count }, (_one, n) => ({
				conditions: { subject: `n${n}` },
				actions: { read: true },
			}));
		expect((await put("owner", `${M}/rules`, { rules: many(RULE_LIMITS.rules + 1) })).status).toBe(
			409,
		);
		const saved = await setRules(many(RULE_LIMITS.rules));
		expect(saved.rules).toHaveLength(RULE_LIMITS.rules);
		// The order is the order they were given in, and an id is kept when it is given back.
		expect(saved.rules.map((rule) => rule.conditions.subject)).toEqual(
			many(RULE_LIMITS.rules).map((rule) => rule.conditions.subject),
		);
		const turned = [...saved.rules].reverse();
		expect((await setRules(turned)).rules.map((rule) => rule.id)).toEqual(
			turned.map((rule) => rule.id),
		);
		await setRules([]);
	});

	it("blocks 500 senders and refuses the next", async () => {
		await inMailbox((sql) => {
			sql.exec(`DELETE FROM rules WHERE kind = 'block'`);
			for (let n = 0; n < RULE_LIMITS.blocked - 1; n++) {
				sql.exec(
					`INSERT INTO rules (id, kind, position, sender, body, set_at, set_by)
					 VALUES (?1, 'block', 0, ?2, '{}', '2026-11-18T00:00:00.000Z', 'test')`,
					`blk_test_${n}`,
					`n${n}@many.test`,
				);
			}
		});
		expect((await block("last@many.test")).status).toBe(201);
		const over = await block("one-more@many.test");
		expect(over.status).toBe(409);
		expect(await json(over)).toMatchObject({ code: "BLOCKED_LIMIT" });
		// One that is blocked already is still answered: it is no further rule.
		expect((await block("last@many.test")).status).toBe(200);
		expect((await getRules()).blocked).toHaveLength(RULE_LIMITS.blocked);
		await inMailbox((sql) => sql.exec(`DELETE FROM rules WHERE kind = 'block'`));
	});

	it.each(["", "ada", "ada@", "@", "two@addresses.test, more@addresses.test", "a b@c.test"])(
		"refuses to block %j",
		async (sender) => {
			expect((await block(sender)).status).toBe(400);
			expect((await del("owner", `${M}/blocked-senders`, { sender })).status).toBe(400);
		},
	);

	it("reads the sender from the body and never from the address of the request", async () => {
		expect((await block("in-the-body@sender.test")).status).toBe(201);
		const byQuery = await as("owner").fetch(
			`${M}/blocked-senders?sender=${encodeURIComponent("in-the-body@sender.test")}`,
			{ method: "DELETE", body: "{}" },
		);
		expect(byQuery.status).toBe(400);
		expect((await getRules()).blocked.map((one) => one.sender)).toEqual([
			"in-the-body@sender.test",
		]);
		await inMailbox((sql) => sql.exec(`DELETE FROM rules WHERE kind = 'block'`));
	});

	it("reads a body up to 256 KiB and refuses a larger one, at every route that takes one", async () => {
		const KIB = 1024;
		/** The JSON of `body`, padded with spaces to `size` bytes: still the same JSON. */
		const padded = (body: unknown, size: number) => {
			const text = JSON.stringify(body);
			return text + " ".repeat(size - new TextEncoder().encode(text).length);
		};
		const send = (method: string, at: string, body: unknown, size: number) =>
			as("owner").fetch(at, { method, body: padded(body, size) });
		await signedInAgain("owner");
		const routes: [string, string, unknown, number][] = [
			["PUT", `${M}/rules`, { rules: [good] }, 200],
			["POST", `${M}/blocked-senders`, { sender: "padded@sender.test" }, 201],
			["DELETE", `${M}/blocked-senders`, { sender: "padded@sender.test" }, 204],
			[
				"PUT",
				`${M}/auto-reply`,
				{
					isEnabled: false,
					fromDate: null,
					toDate: null,
					subject: null,
					textBody: null,
					htmlBody: null,
				},
				200,
			],
		];
		for (const [method, at, body, taken] of routes) {
			await setRules([]);
			// One byte over the limit is refused, and changes nothing.
			const over = await send(method, at, body, 256 * KIB + 1);
			expect(over.status, `${method} ${at} over the limit`).toBe(400);
			// The same request at the limit is taken.
			expect((await send(method, at, body, 256 * KIB)).status, `${method} ${at}`).toBe(taken);
		}
		expect((await getRules()).rules).toEqual([]);
		expect((await getRules()).blocked).toEqual([]);
	});
});

describe("the mailbox's database", () => {
	it("gets the two tables from the release before it, empty, and files nothing again", async () => {
		await setRules([]);
		const before = await arrives("Here before the release");
		await inMailbox((sql, storage) => {
			sql.exec(`DROP TABLE rules`);
			sql.exec(`DROP TABLE auto_reply_log`);
			sql.exec(`DELETE FROM d1_migrations WHERE name = '18_rules'`);
			applyMigrations(sql, mailboxMigrations, storage);
		});
		expect(mailboxMigrations.at(-1)?.name).toBe("18_rules");
		expect(await getRules()).toEqual({ rules: [], blocked: [] });
		expect(await rows(`SELECT * FROM auto_reply_log`)).toEqual([]);
		expect(await stored("Here before the release")).toMatchObject({
			id: before.id,
			folder_id: "inbox",
		});
		const columns = async (table: string) =>
			(await rows<{ name: string }>(`SELECT name FROM pragma_table_info('${table}')`)).map(
				(column) => column.name,
			);
		expect(await columns("rules")).toEqual([
			"id",
			"kind",
			"position",
			"sender",
			"body",
			"set_at",
			"set_by",
		]);
		expect(await columns("auto_reply_log")).toEqual(["sender", "at"]);
	});

	it("holds no rule after the mailbox is deleted", async () => {
		const GONE = "gone@example.com";
		const { createMailbox } = await import("./helpers.ts");
		expect((await createMailbox(as("owner").cookie, GONE)).status).toBe(201);
		await setRules([{ conditions: { subject: "x" }, actions: { read: true } }], GONE);
		expect((await block("left@behind.test", "owner", GONE)).status).toBe(201);
		const fresh = await (await import("./rules-helpers.ts")).signedInAgain("owner");
		expect((await fresh.fetch(path(GONE), { method: "DELETE" })).status).toBe(204);
		expect(await rows(`SELECT * FROM rules`, GONE)).toEqual([]);
		expect((await as("owner").fetch(`${path(GONE)}/rules`)).status).toBe(404);
	});
});
