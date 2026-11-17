/**
 * Tier 3: a mailbox remembers the addresses it has written to (ADR-0012, part B; boundaries B1,
 * B4 and B6; rule S13).
 *
 * - mail that arrives teaches nothing, whatever its From, Reply-To and Cc say, in the inbox
 *   and in Spam; neither does a draft;
 * - each of the three sending routes, with and without a draft, records To, Cc and Bcc once,
 *   and never the mailbox's own address; a recording that fails still sends;
 * - an address is learned when the message has left (ADR-0016): not when it is taken, taken
 *   back or refused;
 * - completing is part of writing: 404 to someone without a membership, whatever they manage,
 *   403 to a reader; forgetting them all is the owner's and is on the record without an address;
 * - one mailbox never shows another's addresses;
 * - the completion completes and does not list: what is typed must begin the address, the part
 *   after its `@` or the name, is never a pattern, and gets at most 8 answers;
 * - an address is forgotten one at a time, all at once, after two years and above the limit;
 * - deleting the mailbox leaves no row.
 */
import {
	createExecutionContext,
	env,
	runInDurableObject,
	waitOnExecutionContext,
} from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { KNOWN_LIMITS } from "../../shared/known-addresses.ts";
import worker from "../../workers/app.ts";
import { applyMigrations, mailboxMigrations } from "../../workers/durableObject/migrations.ts";
import {
	Browser,
	createMailbox,
	inbound,
	json,
	migrate,
	mime,
	request,
	seedMembership,
	seedUser,
	setupOwner,
	testEnv,
} from "./helpers.ts";
import { fakeSender, letLeave } from "./sending-helpers.ts";

const DESK = "desk@example.com";
const OTHER = "other@example.com";
const GONE = "gone@example.com";
const path = (mailbox: string) => `/api/v1/mailboxes/${encodeURIComponent(mailbox)}`;
const M = path(DESK);
const DAY = 86_400_000;

interface Known {
	id: string;
	address: string;
	name: string | null;
}
interface Row {
	address: string;
	name: string | null;
	use_count: number;
}

const browsers: Record<string, Browser> = {};
const as = (who: string) => browsers[who] as Browser;

function inMailbox<T>(
	run: (sql: SqlStorage, storage: DurableObjectStorage) => T,
	mailbox = DESK,
): Promise<T> {
	const stub = testEnv.MAILBOX.get(testEnv.MAILBOX.idFromName(mailbox));
	return runInDurableObject(stub, (_object, state) => run(state.storage.sql, state.storage));
}

/** Everything the mailbox knows, as its table has it. */
const known = (mailbox = DESK) =>
	inMailbox(
		(sql) =>
			[
				...sql.exec(`SELECT address, name, use_count FROM known_addresses ORDER BY address`),
			] as unknown as Row[],
		mailbox,
	);
const forgetEverything = (mailbox = DESK) =>
	inMailbox((sql) => {
		sql.exec(`DELETE FROM known_addresses`);
		// The sending limit counts what left; this test is not about it.
		sql.exec(`DELETE FROM emails WHERE folder_id = 'sent'`);
		sql.exec(`DELETE FROM send_log`);
	}, mailbox);

/** A row put there directly, for what no route can make today (a name, an old date). */
function remember(
	rows: { address: string; name?: string; uses?: number; daysAgo?: number }[],
	mailbox = DESK,
) {
	return inMailbox((sql) => {
		for (const row of rows) {
			const at = new Date(Date.now() - (row.daysAgo ?? 0) * DAY).toISOString();
			sql.exec(
				`INSERT INTO known_addresses (id, address, name, name_key, use_count, last_used_at, created_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?)`,
				crypto.randomUUID(),
				row.address,
				row.name ?? null,
				row.name?.toLowerCase() ?? null,
				row.uses ?? 1,
				at,
				at,
			);
		}
	}, mailbox);
}

async function complete(who: string, typed: string, mailbox = DESK): Promise<Known[]> {
	const res = await as(who).fetch(
		`${path(mailbox)}/known-addresses?q=${encodeURIComponent(typed)}`,
	);
	expect(res.status, `completing "${typed}"`).toBe(200);
	return (await json<{ addresses: Known[] }>(res)).addresses;
}
const offered = async (who: string, typed: string, mailbox = DESK) =>
	(await complete(who, typed, mailbox)).map((one) => one.address);

interface Sending {
	to: string | string[];
	cc?: string | string[];
	bcc?: string | string[];
	draft_id?: string;
}

/**
 * Sends, answers or forwards as a person does, lets the message leave, and gives its id. A
 * mailbox learns an address when the message has left, not when it is taken (ADR-0016).
 */
async function send(
	who: string,
	message: Sending,
	how: { route?: string; mailbox?: string; wait?: boolean } = {},
): Promise<string> {
	const mailbox = how.mailbox ?? DESK;
	const res = await as(who).post(`${path(mailbox)}/${how.route ?? "emails"}`, {
		from: mailbox,
		subject: "Written by a person",
		text: "Hello",
		...message,
	});
	expect(res.status, `sending by ${how.route ?? "emails"}`).toBe(202);
	const { id } = await json<{ id: string }>(res);
	if (how.wait !== true) await letLeave(mailbox);
	return id;
}

async function draft(to: string, mailbox = DESK): Promise<string> {
	const res = await as("owner").post(`${path(mailbox)}/drafts`, {
		to,
		subject: "A draft",
		body: "<p>x</p>",
	});
	expect(res.status).toBe(201);
	return (await json<{ id: string }>(res)).id;
}

async function deliver(to: string, raw: string, from: string) {
	const { message, rejections } = inbound(to, raw, { from });
	const ctx = createExecutionContext();
	await worker.email(message, env, ctx);
	await waitOnExecutionContext(ctx);
	expect(rejections).toEqual([]);
}

const received = (subject: string) =>
	inMailbox((sql) =>
		String([...sql.exec(`SELECT id FROM emails WHERE subject = ?`, subject)][0]?.id ?? ""),
	);
const placeOf = (id: string) =>
	inMailbox((sql) =>
		String([...sql.exec(`SELECT folder_id FROM emails WHERE id = ?`, id)][0]?.folder_id ?? ""),
	);

beforeAll(async () => {
	await migrate();
	expect((await setupOwner()).status).toBe(201);
	browsers.owner = new Browser();
	expect((await as("owner").signIn("owner@example.com")).status).toBe(200);
	for (const mailbox of [DESK, OTHER, GONE]) {
		expect((await createMailbox(as("owner").cookie, mailbox)).status).toBe(201);
	}
	const sender = await seedUser("sender@example.com", "member");
	const reader = await seedUser("reader@example.com", "member");
	await seedUser("outsider@example.com", "member");
	await seedUser("admin@example.com", "admin");
	await seedMembership(DESK, sender, "sender");
	await seedMembership(DESK, reader, "reader");
	for (const who of ["sender", "reader", "outsider", "admin"]) {
		browsers[who] = new Browser();
		expect((await as(who).signIn(`${who}@example.com`)).status).toBe(200);
	}
});

describe("what teaches a mailbox nothing", () => {
	it("is mail that arrives, in the inbox and in Spam, whatever its From, Reply-To and Cc say", async () => {
		for (const subject of ["Planted: stays", "Planted: unwanted"]) {
			await deliver(
				DESK,
				mime({
					From: "Mallory Planted <planted@evil.test>",
					"Reply-To": "Answer Here <reply-here@evil.test>",
					To: DESK,
					Cc: "Copied One <copied1@evil.test>, copied2@evil.test",
					Subject: subject,
					"Message-ID": `<${subject.replace(/\W/g, "")}@evil.test>`,
				}),
				"envelope@evil.test",
			);
		}
		const unwanted = await received("Planted: unwanted");
		const moved = await as("owner").post(`${M}/emails/${unwanted}/move`, { folderId: "spam" });
		expect(moved.status).toBe(200);
		expect(await placeOf(unwanted)).toBe("spam");
		expect(await placeOf(await received("Planted: stays"))).toBe("inbox");

		expect(await known()).toEqual([]);
		for (const typed of [
			"planted",
			"mallory",
			"reply-here",
			"answer",
			"copied",
			"envelope",
			"evil.test",
			"e",
		]) {
			expect(await complete("owner", typed), typed).toEqual([]);
		}
	});

	it("is a draft, however often it is saved", async () => {
		const id = await draft("drafted@elsewhere.test");
		const saved = await as("owner").fetch(`${M}/drafts/${id}`, {
			method: "PUT",
			body: JSON.stringify({
				to: "drafted@elsewhere.test",
				cc: "drafted-cc@elsewhere.test",
				subject: "A draft, again",
				body: "<p>y</p>",
			}),
		});
		expect(saved.status).toBe(200);
		expect(await known()).toEqual([]);
		expect(await complete("owner", "drafted")).toEqual([]);
	});
});

describe("when a mailbox learns (ADR-0016)", () => {
	it("is when the message has left, once: not when it is taken, taken back or refused", async () => {
		await forgetEverything();
		const fake = await fakeSender(DESK);
		const later = { send_at: new Date(Date.now() + 3_600_000).toISOString() };
		const send_ = (to: string, more: Record<string, unknown> = {}) =>
			as("owner").post(`${M}/emails`, { from: DESK, subject: "Later", text: "x", to, ...more });

		// Taken, and waiting: nothing is learned yet.
		const waiting = await json<{ id: string }>(await send_("waiting@later.test", later));
		expect(await placeOf(waiting.id)).toBe("scheduled");
		expect(await known()).toEqual([]);
		// Taken back: nothing was ever learned.
		const back = await json<{ id: string }>(await send_("taken-back@later.test", later));
		expect((await as("owner").post(`${M}/emails/${back.id}/unsend`)).status).toBe(200);
		// Refused for good, and without any answer: the mailbox does not know that it wrote.
		fake.next = [{ code: "E_RECIPIENT_SUPPRESSED" }, "no-code"];
		await send_("refused@later.test");
		await send_("unanswered@later.test");
		await inMailbox((sql) =>
			sql.exec(
				`UPDATE submissions SET send_at = ?1 WHERE state = 'waiting' AND email_id != ?2`,
				new Date(Date.now() - 1000).toISOString(),
				waiting.id,
			),
		);
		const stub = testEnv.MAILBOX.get(testEnv.MAILBOX.idFromName(DESK));
		await runInDurableObject(stub, (instance) =>
			(instance as unknown as { alarm(): Promise<void> }).alarm(),
		);
		expect(fake.calls).toHaveLength(2);
		expect(await known()).toEqual([]);

		// It leaves: now the mailbox has written to the address, once, however often it wakes.
		await letLeave(DESK);
		expect(await placeOf(waiting.id)).toBe("sent");
		expect(await known()).toEqual([{ address: "waiting@later.test", name: null, use_count: 1 }]);
		for (let run = 0; run < 2; run++) {
			await runInDurableObject(stub, (instance) =>
				(instance as unknown as { alarm(): Promise<void> }).alarm(),
			);
		}
		expect(await known()).toEqual([{ address: "waiting@later.test", name: null, use_count: 1 }]);
		await inMailbox((sql) => sql.exec(`DELETE FROM emails WHERE folder_id = 'draft'`));
		await forgetEverything();
	});
});

describe("what teaches a mailbox an address", () => {
	it("is each of the three sending routes, with and without a draft: its To, Cc and Bcc, once", async () => {
		const answered = await received("Planted: stays");
		const routes = ["emails", `emails/${answered}/reply`, `emails/${answered}/forward`];
		for (const [index, route] of routes.entries()) {
			// Without a draft: the message is a new row in Sent. The mailbox's own address, here in
			// Cc as a reply to all leaves it, is not recorded; an address named twice counts once.
			await send(
				"owner",
				{
					to: [`to-${index}@plain.test`, `Both-${index}@plain.test`],
					cc: [`cc-${index}@plain.test`, DESK, `both-${index}@plain.test`],
					bcc: `bcc-${index}@plain.test`,
				},
				{ route },
			);
			// From a draft: the draft's row becomes the sent message.
			const id = await draft(`to-${index}@drafted.test`);
			expect(await complete("owner", `to-${index}@drafted`), "a draft teaches nothing").toEqual([]);
			await send(
				"owner",
				{
					to: `to-${index}@drafted.test`,
					cc: [DESK.toUpperCase(), `cc-${index}@drafted.test`],
					bcc: [`bcc-${index}@drafted.test`],
					draft_id: id,
				},
				{ route },
			);
			expect(await placeOf(id)).toBe("sent");
		}

		const expected = [0, 1, 2]
			.flatMap((index) => [
				`bcc-${index}@drafted.test`,
				`bcc-${index}@plain.test`,
				`both-${index}@plain.test`,
				`cc-${index}@drafted.test`,
				`cc-${index}@plain.test`,
				`to-${index}@drafted.test`,
				`to-${index}@plain.test`,
			])
			.sort();
		const rows = await known();
		expect(rows.map((row) => row.address)).toEqual(expected);
		// Each message recorded its recipients once, and nobody has a name: the sending bodies
		// carry none (decision 16).
		for (const row of rows) expect(row, row.address).toMatchObject({ use_count: 1, name: null });
		expect(rows.map((row) => row.address)).not.toContain(DESK);
		expect(await complete("owner", "desk")).toEqual([]);
		// A sender is offered what the owner wrote to: the addresses are the mailbox's.
		expect(await offered("sender", "to-1")).toEqual(["to-1@drafted.test", "to-1@plain.test"]);
	});

	it("counts an address once more each time a message goes to it, and offers it first", async () => {
		await send("sender", { to: "to-2@plain.test" });
		await send("sender", { to: "other@new.test", bcc: "to-2@plain.test" });
		const rows = await known();
		expect(rows.find((row) => row.address === "to-2@plain.test")?.use_count).toBe(3);
		const first = await offered("owner", "to-");
		expect(first[0]).toBe("to-2@plain.test");
		expect(first).toHaveLength(6);
	});

	it("still sends when the recording fails, and skips what it cannot keep", async () => {
		await forgetEverything();
		// The table is gone: every recording fails.
		await inMailbox((sql) => sql.exec(`DROP TABLE known_addresses`));
		const id = await send("owner", { to: "unrecorded@plain.test" });
		expect(await placeOf(id)).toBe("sent");
		const viaDraft = await draft("unrecorded-too@plain.test");
		await send("owner", { to: "unrecorded-too@plain.test", draft_id: viaDraft });
		expect(await placeOf(viaDraft)).toBe("sent");

		// The table is back, as a later release would bring it; what was sent meanwhile is not
		// read back from Sent.
		await inMailbox((sql, storage) => {
			sql.exec(`DELETE FROM d1_migrations WHERE name = '15_known_addresses'`);
			applyMigrations(sql, mailboxMigrations, storage);
		});
		expect(await known()).toEqual([]);

		// What is no whole address, or is longer than an address may be, is skipped; the rest of
		// the message is recorded and the message is stored.
		const long = `${"a".repeat(KNOWN_LIMITS.address)}@plain.test`;
		await fakeSender(DESK);
		const owner = await testEnv.DB.prepare(`select "id" from "user" where "email" = ?1`)
			.bind("owner@example.com")
			.first<{ id: string }>();
		await inMailbox((sql) => {
			const now = new Date().toISOString();
			sql.exec(
				`INSERT INTO emails (id, folder_id, subject, sender, recipient, cc, date, body, read)
				 VALUES ('odd-recipients', 'scheduled', 'Odd', ?1, ?2, 'also-kept@plain.test', ?3, 'x', 1)`,
				DESK,
				`kept@plain.test, ${long}, not-an-address, Named <named@plain.test>`,
				now,
			);
			sql.exec(
				`INSERT INTO submissions (email_id, state, send_at, requested_at, requested_by)
				 VALUES ('odd-recipients', 'waiting', ?1, ?1, ?2)`,
				now,
				owner?.id ?? "",
			);
		});
		await letLeave(DESK);
		expect(await placeOf("odd-recipients")).toBe("sent");
		expect((await known()).map((row) => row.address)).toEqual([
			"also-kept@plain.test",
			"kept@plain.test",
		]);
	});
});

describe("who may ask", () => {
	const one = "00000000-0000-4000-8000-000000000000";
	const calls: [string, string][] = [
		["GET", `${M}/known-addresses?q=kept`],
		["DELETE", `${M}/known-addresses/${one}`],
		["DELETE", `${M}/known-addresses`],
	];

	it.each(["outsider", "admin"])(
		"%s, who is no member, gets 404 on every route (managing is not reading)",
		async (who) => {
			for (const [method, route] of calls) {
				expect((await as(who).fetch(route, { method })).status, `${method} ${route}`).toBe(404);
			}
		},
	);

	it("a reader gets 403 on every route: completing an address is part of writing", async () => {
		for (const [method, route] of calls) {
			expect((await as("reader").fetch(route, { method })).status, `${method} ${route}`).toBe(403);
		}
	});

	it("nobody gets anything without a session or from another origin", async () => {
		for (const [method, route] of calls) {
			expect((await request(route, { method })).status, `${method} ${route}`).toBe(401);
		}
		for (const [method, route] of calls.filter(([method]) => method === "DELETE")) {
			const foreign = await as("owner").fetch(route, {
				method,
				headers: { origin: "https://evil.test" },
			});
			expect(foreign.status, `${method} ${route}`).toBe(403);
		}
		expect((await known()).length).toBe(2);
	});

	it("a sender completes and forgets one; only an owner forgets them all, on the record", async () => {
		expect(await offered("sender", "kept")).toEqual(["kept@plain.test"]);
		expect((await as("sender").fetch(`${M}/known-addresses`, { method: "DELETE" })).status).toBe(
			403,
		);
		expect((await known()).length).toBe(2);

		const [kept] = await complete("sender", "kept");
		const forgotten = await as("sender").fetch(`${M}/known-addresses/${kept?.id}`, {
			method: "DELETE",
		});
		expect(forgotten.status).toBe(204);
		expect(await complete("sender", "kept")).toEqual([]);
		// It is gone: a second time there is nothing to forget, and an id that is not one is nothing.
		for (const id of [kept?.id, one, "not-an-id", "%", "1 OR 1=1"]) {
			const res = await as("sender").fetch(`${M}/known-addresses/${encodeURIComponent(id ?? "")}`, {
				method: "DELETE",
			});
			expect(res.status, id).toBe(404);
		}
		expect((await known()).map((row) => row.address)).toEqual(["also-kept@plain.test"]);

		// Writing to a forgotten address again makes it known again, from the start.
		await send("sender", { to: "kept@plain.test" });
		expect((await known()).find((row) => row.address === "kept@plain.test")?.use_count).toBe(1);

		const all = await as("owner").fetch(`${M}/known-addresses`, { method: "DELETE" });
		expect(all.status).toBe(204);
		expect(await known()).toEqual([]);
		const audit = await testEnv.DB.prepare(
			`select "action", "target", "detail" from "audit" where "action" = 'mailbox.known_addresses_forgotten'`,
		).all<{ action: string; target: string; detail: string }>();
		// By the mailbox and how many; never an address of a correspondent.
		expect(audit.results).toEqual([
			{
				action: "mailbox.known_addresses_forgotten",
				target: DESK,
				detail: JSON.stringify({ forgotten: 2 }),
			},
		]);
	});
});

describe("one mailbox never shows another's addresses", () => {
	it("offers and forgets only its own", async () => {
		await forgetEverything();
		await send("owner", { to: "only-desk@plain.test" });
		await send("owner", { to: "only-other@plain.test" }, { mailbox: OTHER });

		expect(await offered("owner", "only")).toEqual(["only-desk@plain.test"]);
		expect(await offered("owner", "only", OTHER)).toEqual(["only-other@plain.test"]);
		expect(await offered("owner", "plain")).toEqual(["only-desk@plain.test"]);
		// A sender of one mailbox is nobody in the other.
		expect((await as("sender").fetch(`${path(OTHER)}/known-addresses?q=only`)).status).toBe(404);

		// An id of the other mailbox is nothing here, and stays known there.
		const [theirs] = await complete("owner", "only", OTHER);
		const res = await as("owner").fetch(`${M}/known-addresses/${theirs?.id}`, { method: "DELETE" });
		expect(res.status).toBe(404);
		expect(await offered("owner", "only", OTHER)).toEqual(["only-other@plain.test"]);
	});
});

describe("the completion completes and does not list", () => {
	beforeAll(async () => {
		await forgetEverything();
		await remember([
			{ address: "ada@sender.test", uses: 5 },
			{ address: "adam@example.org", uses: 2 },
			{ address: "grace@navy.test", name: "Grace Hopper", uses: 1 },
			{ address: "gh@navy.test", name: "Élodie Durand", uses: 1 },
			{ address: "percent%sign@odd.test" },
			{ address: "under_score@odd.test" },
			{ address: "underxscore@odd.test" },
		]);
	});

	it("matches the beginning of the address, of the part after the @, or of the name", async () => {
		// The beginning of the address, more used first.
		expect(await offered("owner", "ad")).toEqual(["ada@sender.test", "adam@example.org"]);
		expect(await offered("owner", "ada@s")).toEqual(["ada@sender.test"]);
		// The part after the @.
		expect(await offered("owner", "navy")).toEqual(["gh@navy.test", "grace@navy.test"].sort());
		expect(await offered("owner", "example.o")).toEqual(["adam@example.org"]);
		// The name, and the answer gives it beside the whole address.
		expect(await complete("owner", "grace h")).toEqual([
			{ id: expect.any(String), address: "grace@navy.test", name: "Grace Hopper" },
		]);
		expect(await offered("owner", "élo")).toEqual(["gh@navy.test"]);
		// Without regard to case.
		expect(await offered("owner", "ADA@SENDER")).toEqual(["ada@sender.test"]);
		expect(await offered("owner", "ÉLODIE")).toEqual(["gh@navy.test"]);
		expect(await offered("owner", "  ada  ")).toEqual(["ada@sender.test", "adam@example.org"]);
		// Not the middle of anything.
		for (const middle of ["da", "ender", "hopper", "test", "@sender", "race"]) {
			expect(await offered("owner", middle), middle).toEqual([]);
		}
	});

	it("never takes what is typed as a pattern", async () => {
		// A sign that stands for anything in a pattern stands only for itself.
		for (const typed of ["%", "_", "a%", "ad_", "%@", "a*", "*", "under%"]) {
			expect(await offered("owner", typed), typed).toEqual([]);
		}
		expect(await offered("owner", "under_")).toEqual(["under_score@odd.test"]);
		expect(await offered("owner", "percent%")).toEqual(["percent%sign@odd.test"]);
		// Longer than a pattern may be (50 bytes), and still only a comparison.
		const long = `${"é".repeat(40)}@long.test`;
		await remember([{ address: long }]);
		expect(new TextEncoder().encode(long.slice(0, 45)).length).toBeGreaterThan(50);
		expect(await offered("owner", long.slice(0, 45))).toEqual([long]);
		expect(await offered("owner", `${"É".repeat(40)}@LONG`)).toEqual([long]);
	});

	it("takes between 1 and 64 characters, and nothing else", async () => {
		const ask = (query: string) => as("owner").fetch(`${M}/known-addresses${query}`);
		for (const query of ["", "?q=", "?q=%20%20", "?typed=ada", `?q=${"a".repeat(65)}`]) {
			const res = await ask(query);
			expect(res.status, query).toBe(400);
			expect(await res.text(), query).not.toContain("@");
		}
		expect((await ask(`?q=${"a".repeat(64)}`)).status).toBe(200);
		// A letter outside the basic plane is one character.
		expect((await ask(`?q=${encodeURIComponent("𝒜".repeat(64))}`)).status).toBe(200);
		expect((await ask(`?q=${encodeURIComponent("𝒜".repeat(65))}`)).status).toBe(400);
	});

	it("answers with at most 8, best first, and no way to the rest", async () => {
		await remember(
			Array.from({ length: 12 }, (_value, n) => ({
				address: `many-${String(n).padStart(2, "0")}@bulk.test`,
				uses: n < 2 ? 9 : 1,
				daysAgo: n,
			})),
		);
		const res = await as("owner").fetch(`${M}/known-addresses?q=many`);
		const body = await json<Record<string, unknown>>(res);
		// One list, and nothing that says how many there are or when they were used.
		expect(Object.keys(body)).toEqual(["addresses"]);
		const list = body.addresses as Record<string, unknown>[];
		expect(list).toHaveLength(KNOWN_LIMITS.suggestions);
		expect(KNOWN_LIMITS.suggestions).toBe(8);
		for (const one of list) expect(Object.keys(one).sort()).toEqual(["address", "id", "name"]);
		// More used first, then more recent.
		expect(list.map((one) => one.address)).toEqual(
			[0, 1, 2, 3, 4, 5, 6, 7].map((n) => `many-0${n}@bulk.test`),
		);
		// Paging is not a thing: the same 8, whatever is asked.
		for (const more of ["&page=2", "&offset=8", "&limit=100", "&cursor=8", "&after=many-07"]) {
			const again = await json<{ addresses: Known[] }>(
				await as("owner").fetch(`${M}/known-addresses?q=many${more}`),
			);
			expect(
				again.addresses.map((one) => one.address),
				more,
			).toEqual(list.map((one) => one.address));
		}
		expect((await offered("owner", "bulk")).length).toBe(8);
	});
});

describe("forgetting by time and by number", () => {
	it("forgets an address not written to for two years, at the next send", async () => {
		await forgetEverything();
		const twoYears = KNOWN_LIMITS.forgottenAfterMs / DAY;
		expect(twoYears).toBe(730);
		await remember([
			{ address: "long-ago@old.test", uses: 40, daysAgo: twoYears + 1 },
			{ address: "not-yet@old.test", daysAgo: twoYears - 1 },
		]);
		// Nothing is forgotten by asking.
		expect(await offered("owner", "long")).toEqual(["long-ago@old.test"]);
		await send("owner", { to: "today@new.test" });
		expect((await known()).map((row) => row.address)).toEqual([
			"not-yet@old.test",
			"today@new.test",
		]);
	});

	it("keeps at most 5,000, and forgets the least recently used first", async () => {
		await forgetEverything();
		expect(KNOWN_LIMITS.addresses).toBe(5000);
		await inMailbox((sql) => {
			for (let n = 0; n < KNOWN_LIMITS.addresses; n++) {
				const at = new Date(Date.now() - (n + 1) * 60_000).toISOString();
				sql.exec(
					`INSERT INTO known_addresses (id, address, use_count, last_used_at, created_at) VALUES (?, ?, ?, ?, ?)`,
					crypto.randomUUID(),
					`filler-${n}@full.test`,
					// The oldest are also the most used: it is recency that decides.
					n,
					at,
					at,
				);
			}
		});
		await send("owner", { to: ["new-1@full.test", "new-2@full.test", "filler-4999@full.test"] });
		const rows = await known();
		expect(rows).toHaveLength(KNOWN_LIMITS.addresses);
		const addresses = new Set(rows.map((row) => row.address));
		// Two new ones came, so the two least recently used went; the oldest of all was written
		// to again and stays.
		for (const kept of [
			"new-1@full.test",
			"new-2@full.test",
			"filler-4999@full.test",
			"filler-0@full.test",
		]) {
			expect(addresses.has(kept), kept).toBe(true);
		}
		for (const gone of ["filler-4998@full.test", "filler-4997@full.test"]) {
			expect(addresses.has(gone), gone).toBe(false);
		}
		expect(addresses.has("filler-4996@full.test")).toBe(true);
	});

	it("does not forget the recipients of a sent message that is deleted for good", async () => {
		await forgetEverything();
		const id = await send("owner", { to: "remembered@plain.test" });
		expect((await as("owner").post(`${M}/emails/${id}/move`, { folderId: "trash" })).status).toBe(
			200,
		);
		expect((await as("owner").fetch(`${M}/emails/${id}`, { method: "DELETE" })).status).toBe(204);
		expect(await placeOf(id)).toBe("");
		expect(await offered("owner", "remembered")).toEqual(["remembered@plain.test"]);
	});
});

describe("the mailbox's database", () => {
	it("gets the table from the release before it, empty, and fills from the next message sent", async () => {
		await forgetEverything();
		const before = await send("owner", { to: "before@release.test" });
		// The state of the previous release: no table of known addresses, and mail in Sent.
		await inMailbox((sql, storage) => {
			sql.exec(`DROP TABLE known_addresses`);
			sql.exec(`DELETE FROM d1_migrations WHERE name = '15_known_addresses'`);
			applyMigrations(sql, mailboxMigrations, storage);
		});
		expect(await placeOf(before)).toBe("sent");
		// Mail already in Sent is not read back.
		expect(await known()).toEqual([]);
		expect(await complete("owner", "before")).toEqual([]);
		await send("owner", { to: "after@release.test" });
		expect((await known()).map((row) => row.address)).toEqual(["after@release.test"]);
	});

	it("holds no known address after the mailbox is deleted", async () => {
		await send("owner", { to: ["left@behind.test", "also@behind.test"] }, { mailbox: GONE });
		expect((await known(GONE)).length).toBe(2);
		const deleted = await as("owner").fetch(path(GONE), { method: "DELETE" });
		expect(deleted.status).toBe(204);
		expect(await known(GONE)).toEqual([]);
		// The address is no mailbox any more: there is nothing to ask.
		expect((await as("owner").fetch(`${path(GONE)}/known-addresses?q=left`)).status).toBe(404);
	});
});
