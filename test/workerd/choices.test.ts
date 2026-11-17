/**
 * Tier 3: a person's choices are kept with their account (ADR-0012, part A; boundaries B3, B4).
 *
 * - the table comes with the accounts database of the release before it;
 * - each person, whatever their instance role, reads and changes only their own document: no
 *   route names a person, and the list of people carries no choices;
 * - a request from another origin, without a session or with a program key is refused;
 * - writing is strict: an unknown key, an unknown value and a body over the limit are refused
 *   whole and change nothing;
 * - a change carries only the keys that changed, is merged in one write, and `null` takes a
 *   choice back to its default; two changes at once to different keys both stay;
 * - reading is lenient: a stored key this version does not know stays in the document and is
 *   not given on, and a document of a later version reads as the defaults and is not written;
 * - the row goes with the account.
 */
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { MAX_CHOICES_BYTES } from "../../shared/choices.ts";
import { ROUTE_TABLE } from "../../workers/auth/route-table.ts";
import { Browser, createMailbox, json, request, seedUser, setupOwner, testEnv } from "./helpers.ts";

const PATH = "/api/v1/me/choices";

interface Answer {
	choices: Record<string, unknown>;
	rev: number;
}

const browsers: Record<string, Browser> = {};
const ids: Record<string, string> = {};
const as = (who: string) => browsers[who] as Browser;
const put = (who: string, body: unknown) =>
	as(who).fetch(PATH, {
		method: "PUT",
		body: typeof body === "string" ? body : JSON.stringify(body),
	});
const mine = async (who: string) => json<Answer>(await as(who).fetch(PATH));
const row = (who: string) =>
	testEnv.DB.prepare(`select "choices", "rev" from "user_choices" where "user_id" = ?1`)
		.bind(ids[who])
		.first<{ choices: string; rev: number }>();
const rows = async () =>
	(await testEnv.DB.prepare(`select count(*) as "n" from "user_choices"`).first<{ n: number }>())
		?.n;
const store = (who: string, document: string) =>
	testEnv.DB.prepare(
		`insert into "user_choices" ("user_id", "choices", "rev", "updated_at") values (?1, ?2, 1, ?3)
		 on conflict ("user_id") do update set "choices" = ?2`,
	)
		.bind(ids[who], document, new Date().toISOString())
		.run();

beforeAll(async () => {
	// The accounts database as the release before this one left it: everything but the table.
	const before = testEnv.TEST_MIGRATIONS.filter((migration) => migration.name < "0007");
	expect(before).toHaveLength(6);
	await applyD1Migrations(testEnv.DB, before);
	expect((await setupOwner()).status).toBe(201);
	browsers.owner = new Browser();
	expect((await as("owner").signIn("owner@example.com")).status).toBe(200);
});

describe("the migration", () => {
	it("adds the table to the accounts database of the release before it, and loses nobody", async () => {
		const tables = async () =>
			(
				await testEnv.DB.prepare(
					`select "name" from "sqlite_master" where "type" = 'table' and "name" = 'user_choices'`,
				).all()
			).results.length;
		expect(await tables()).toBe(0);
		await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
		expect(await tables()).toBe(1);

		// The person who was there before signs in as before and has made no choice yet.
		const me = await as("owner").me();
		expect(me.status).toBe(200);
		ids.owner = me.id ?? "";
		expect(await mine("owner")).toEqual({ choices: { v: 1 }, rev: 0 });
		expect(await rows()).toBe(0);

		ids.admin = await seedUser("admin@example.com", "admin");
		ids.member = await seedUser("member@example.com", "member");
		for (const who of ["admin", "member"]) {
			browsers[who] = new Browser();
			expect((await as(who).signIn(`${who}@example.com`)).status).toBe(200);
		}
	});
});

describe("a person's choices are their own", () => {
	it("lets each instance role read and change its own document, and only that", async () => {
		const chosen = {
			owner: { pageSize: 50, appearance: "dark" },
			admin: { pageSize: 100, language: "tr" },
			member: { conversationView: false },
		} as const;
		for (const [who, change] of Object.entries(chosen)) {
			const res = await put(who, change);
			expect(res.status, who).toBe(200);
			expect(await json<Answer>(res), who).toEqual({ choices: { v: 1, ...change }, rev: 1 });
		}
		for (const [who, change] of Object.entries(chosen)) {
			expect(await mine(who), who).toEqual({ choices: { v: 1, ...change }, rev: 1 });
			expect(JSON.parse((await row(who))?.choices ?? "null"), who).toEqual({ v: 1, ...change });
		}
		expect(await rows()).toBe(3);
	});

	it("has no route that names a person, and takes none from the query or the body", async () => {
		// The table has the two routes, and neither has a parameter.
		expect(
			ROUTE_TABLE.filter((route) => route.path.includes("choices")).map(
				(route) => `${route.method} ${route.path} ${route.right}`,
			),
		).toEqual([`GET ${PATH} session`, `PUT ${PATH} session`]);

		// Whoever manages the instance finds no way to another person's choices.
		for (const who of ["owner", "admin"]) {
			for (const path of [
				`/api/v1/users/${ids.member}/choices`,
				`/api/v1/me/choices/${ids.member}`,
				`/api/v1/choices/${ids.member}`,
			]) {
				expect((await as(who).fetch(path)).status, path).toBe(404);
				expect(
					(await as(who).fetch(path, { method: "PUT", body: `{"pageSize":10}` })).status,
					path,
				).toBe(404);
			}
			// A person named in the query is not looked at: the answer is the caller's own.
			const asked = await json<Answer>(await as(who).fetch(`${PATH}?userId=${ids.member}`));
			expect(asked).toEqual(await mine(who));
			// A person named in the body is a key the schema does not know.
			for (const body of [
				{ userId: ids.member, pageSize: 10 },
				{ user_id: ids.member, pageSize: 10 },
			]) {
				expect((await put(who, body)).status).toBe(400);
			}
		}
		expect(await mine("member")).toEqual({ choices: { v: 1, conversationView: false }, rev: 1 });
	});

	it("is not in the list of people, in a person's own account, or in the registry", async () => {
		for (const path of ["/api/v1/users", "/api/v1/me", "/api/v1/registry/mailboxes"]) {
			const res = await as("owner").fetch(path);
			expect(res.status, path).toBe(200);
			const text = await res.text();
			for (const word of ["choices", "pageSize", "conversationView", "appearance"]) {
				expect(text, `${path} ${word}`).not.toContain(word);
			}
		}
	});

	it("refuses a request without a session, from another origin, or with a program key", async () => {
		expect((await request(PATH)).status).toBe(401);
		expect((await request(PATH, { method: "PUT", body: `{"pageSize":10}` })).status).toBe(401);

		const foreign = await as("owner").fetch(PATH, {
			method: "PUT",
			headers: { origin: "https://evil.test" },
			body: `{"pageSize":10}`,
		});
		expect(foreign.status).toBe(403);

		// A key for programs opens the MCP endpoint and nothing of the API.
		expect((await createMailbox(as("owner").cookie, "keys@example.com")).status).toBe(201);
		const made = await as("owner").post("/api/v1/keys", {
			name: "A program",
			access: "write",
			mailboxes: ["keys@example.com"],
		});
		expect(made.status).toBe(201);
		const { token } = await json<{ token: string }>(made);
		for (const method of ["GET", "PUT"]) {
			const res = await request(PATH, {
				method,
				headers: { authorization: `Bearer ${token}` },
				...(method === "PUT" ? { body: `{"pageSize":10}` } : {}),
			});
			expect(res.status, method).toBe(401);
		}
		expect(await mine("owner")).toEqual({
			choices: { v: 1, pageSize: 50, appearance: "dark" },
			rev: 1,
		});
	});
});

describe("writing is strict", () => {
	it("refuses an unknown key, an unknown value and a body over the limit, and changes nothing", async () => {
		const before = await row("owner");
		const refused: [unknown, number][] = [
			// A key the schema does not know, alone or beside a good one.
			[{ theme: "dark" }, 400],
			[{ pageSize: 10, theme: "dark" }, 400],
			// The version is not a choice, and a choice of the device does not travel.
			[{ v: 2 }, 400],
			[{ density: "compact" }, 400],
			[{ readingPane: "right" }, 400],
			[{ notifications: true }, 400],
			// A value its choice cannot take, beside a good one.
			[{ appearance: "dark", pageSize: 7 }, 400],
			[{ pageSize: "50" }, 400],
			[{ language: "xx" }, 400],
			[{ shortcuts: "yes" }, 400],
			[{ order: "oldest" }, 400],
			[{ appearance: { mode: "dark" } }, 400],
			// Not a change at all.
			[[{ pageSize: 10 }], 400],
			["null", 400],
			[`"pageSize"`, 400],
			["{not json", 400],
			["", 400],
		];
		for (const [body, status] of refused) {
			const res = await put("owner", body);
			expect(res.status, JSON.stringify(body)).toBe(status);
		}

		// A body over 4 KiB is refused before it is read as a change, whatever it says.
		const padded = `{"pageSize":10${" ".repeat(MAX_CHOICES_BYTES)}}`;
		expect(new TextEncoder().encode(padded).length).toBeGreaterThan(MAX_CHOICES_BYTES);
		const large = await put("owner", padded);
		expect(large.status).toBe(413);
		// The same change at the limit is taken, so it was the size that refused it.
		const fits = `{"shortcuts":false${" ".repeat(MAX_CHOICES_BYTES - 19)}}`;
		expect(new TextEncoder().encode(fits).length).toBe(MAX_CHOICES_BYTES);

		expect(await row("owner")).toEqual(before);
		expect((await put("owner", fits)).status).toBe(200);
		expect((await put("owner", { shortcuts: null })).status).toBe(200);
	});

	it("writes nothing for a change that names nothing", async () => {
		ids.quiet = await seedUser("quiet@example.com", "member");
		browsers.quiet = new Browser();
		expect((await as("quiet").signIn("quiet@example.com")).status).toBe(200);
		const res = await put("quiet", {});
		expect(res.status).toBe(200);
		expect(await json<Answer>(res)).toEqual({ choices: { v: 1 }, rev: 0 });
		expect(await row("quiet")).toBeNull();
	});
});

describe("a change is merged", () => {
	it("carries only what changed, and null takes a choice back to its default", async () => {
		const start = await mine("admin");
		expect(start.choices).toEqual({ v: 1, pageSize: 100, language: "tr" });

		const added = await json<Answer>(await put("admin", { snippets: false }));
		expect(added).toEqual({
			choices: { v: 1, pageSize: 100, language: "tr", snippets: false },
			rev: start.rev + 1,
		});
		const back = await json<Answer>(await put("admin", { pageSize: null, afterFiling: "older" }));
		expect(back).toEqual({
			choices: { v: 1, language: "tr", snippets: false, afterFiling: "older" },
			rev: start.rev + 2,
		});
		// The default is not stored: the key is gone from the document.
		expect(JSON.parse((await row("admin"))?.choices ?? "null")).toEqual({
			v: 1,
			language: "tr",
			snippets: false,
			afterFiling: "older",
		});
		// The same choice again from another device: the later write wins.
		await put("admin", { language: "en" });
		expect((await mine("admin")).choices.language).toBe("en");
	});

	it("keeps both of two changes made at once to different choices", async () => {
		const start = await mine("member");
		const [one, two, three] = await Promise.all([
			put("member", { pageSize: 10 }),
			put("member", { appearance: "light" }),
			put("member", { sendAndArchive: true }),
		]);
		for (const res of [one, two, three]) expect(res.status).toBe(200);
		expect(await mine("member")).toEqual({
			choices: {
				v: 1,
				conversationView: false,
				pageSize: 10,
				appearance: "light",
				sendAndArchive: true,
			},
			rev: start.rev + 3,
		});
	});
});

describe("reading is lenient", () => {
	it("keeps a stored key it does not know and does not give it on", async () => {
		await store("member", `{"v":1,"pageSize":50,"laterChoice":"wide","snippets":"sometimes"}`);
		// A value that is no longer known reads as the default: the key is not in the answer.
		expect((await mine("member")).choices).toEqual({ v: 1, pageSize: 50 });

		const res = await put("member", { hoverActions: false });
		expect(res.status).toBe(200);
		expect((await json<Answer>(res)).choices).toEqual({ v: 1, pageSize: 50, hoverActions: false });
		// Going back a version loses nothing: what this version does not know is still stored.
		expect(JSON.parse((await row("member"))?.choices ?? "null")).toEqual({
			v: 1,
			pageSize: 50,
			laterChoice: "wide",
			snippets: "sometimes",
			hoverActions: false,
		});
	});

	it("reads a document of a later version as the defaults and does not write it", async () => {
		const later = `{"v":2,"pageSize":50,"shape":"new"}`;
		await store("member", later);
		const before = await row("member");
		expect((await mine("member")).choices).toEqual({ v: 1 });

		const res = await put("member", { pageSize: 10 });
		expect(res.status).toBe(409);
		expect(await json<{ code: string }>(res)).toMatchObject({ code: "NEWER_VERSION" });
		expect(await row("member")).toEqual(before);
		expect(before?.choices).toBe(later);
	});

	it("reads a document that is not one as the defaults, and writes over it", async () => {
		await store("member", "not json at all");
		expect((await mine("member")).choices).toEqual({ v: 1 });
		const res = await put("member", { pageSize: 10 });
		expect(res.status).toBe(200);
		expect((await json<Answer>(res)).choices).toEqual({ v: 1, pageSize: 10 });
	});
});

describe("the row goes with the account", () => {
	it("is removed when the account is, and nobody else's is touched", async () => {
		expect(await row("member")).not.toBeNull();
		const others = { owner: await row("owner"), admin: await row("admin") };
		await testEnv.DB.prepare(`delete from "user" where "id" = ?1`).bind(ids.member).run();
		expect(await row("member")).toBeNull();
		expect({ owner: await row("owner"), admin: await row("admin") }).toEqual(others);
	});
});
