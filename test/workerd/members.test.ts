/**
 * Tier 3: the members of a mailbox, and what managing the instance reaches (rules S1 and S10).
 *
 * - a mailbox owner adds a person by address, changes roles and removes members; other members
 *   see the list and change nothing;
 * - an owner or administrator of the instance without a membership sees and changes the
 *   members, and nothing else: no mail, no settings, no storage. That is how they give
 *   themselves access, and the mailbox's owners see afterwards that they did;
 * - every change needs fresh proof and is recorded with who made it and in which capacity.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { ageSessions, Browser, json, migrate, seedUser, setupOwner, testEnv } from "./helpers.ts";

const MAILBOX = "team@example.com";
const M = `/api/v1/mailboxes/${encodeURIComponent(MAILBOX)}`;
const ids: Record<string, string> = {};
const browsers: Record<string, Browser> = {};

interface Member {
	userId: string;
	email: string;
	role: string;
	addedBy: string | null;
}
interface Change {
	change: string;
	by: string | null;
	person: string | null;
	role: string | null;
	self: boolean;
	asManager: boolean;
}

const as = (who: string) => browsers[who] as Browser;
const members = (who: string) => as(who).fetch(`${M}/members`);
const add = (who: string, email: string, role: string) =>
	as(who).post(`${M}/members`, { email, role });
const setRole = (who: string, target: string, role: string) =>
	as(who).fetch(`${M}/members/${ids[target]}`, { method: "PUT", body: JSON.stringify({ role }) });
const remove = (who: string, target: string) =>
	as(who).fetch(`${M}/members/${ids[target]}`, { method: "DELETE" });
const history = (who: string) => as(who).fetch(`${M}/members/history`);
const inbox = (who: string) => as(who).fetch(`${M}/emails?folder=inbox`);

async function signedIn(email: string): Promise<Browser> {
	const browser = new Browser();
	expect((await browser.signIn(email)).status).toBe(200);
	return browser;
}

beforeAll(async () => {
	await migrate();
	expect((await setupOwner()).status).toBe(201);
	// The mailbox belongs to a member of the instance, not to the instance owner.
	ids.lead = await seedUser("lead@example.com", "member", "Lea Lead");
	ids.admin = await seedUser("admin@example.com", "admin", "Ali Admin");
	ids.ada = await seedUser("ada@example.com", "member", "Ada");
	ids.bob = await seedUser("bob@example.com", "member", "Bob");
	ids.outsider = await seedUser("outsider@example.com", "member");
	browsers.owner = await signedIn("owner@example.com");
	ids.owner = (await browsers.owner.me()).id ?? "";
	const created = await browsers.owner.post("/api/v1/mailboxes", {
		email: MAILBOX,
		name: "Team",
		ownerUserId: ids.lead,
	});
	expect(created.status).toBe(201);
	for (const who of ["lead", "admin", "ada", "bob", "outsider"]) {
		browsers[who] = await signedIn(`${who}@example.com`);
	}
});

describe("a mailbox owner", () => {
	it("adds a person by their address", async () => {
		const res = await add("lead", "Ada@Example.com", "reader");
		expect(res.status).toBe(201);
		const list = await json<Member[]>(res);
		expect(list.map((m) => [m.email, m.role, m.addedBy])).toEqual([
			["ada@example.com", "reader", "lead@example.com"],
			["lead@example.com", "owner", expect.anything()],
		]);
		expect((await inbox("ada")).status).toBe(200);
	});

	it("is told when the address has no account here, or is a member already", async () => {
		expect((await add("lead", "nobody@example.com", "reader")).status).toBe(400);
		expect((await add("lead", "ada@example.com", "sender")).status).toBe(409);
		expect((await add("lead", "bob@example.com", "superuser")).status).toBe(400);
		expect((await add("lead", "not an address", "reader")).status).toBe(400);
	});

	it("changes a role and removes a member", async () => {
		expect((await setRole("lead", "ada", "sender")).status).toBe(200);
		expect((await add("lead", "bob@example.com", "reader")).status).toBe(201);
		expect((await remove("lead", "bob")).status).toBe(204);
		expect((await inbox("bob")).status).toBe(404);
		expect((await remove("lead", "bob")).status).toBe(404);
	});

	it("reads how the members changed", async () => {
		const changes = await json<Change[]>(await history("lead"));
		expect(changes.map((c) => [c.change, c.person, c.role, c.by, c.asManager])).toEqual([
			["removed", "bob@example.com", null, "lead@example.com", false],
			["set", "bob@example.com", "reader", "lead@example.com", false],
			["set", "ada@example.com", "sender", "lead@example.com", false],
			["set", "ada@example.com", "reader", "lead@example.com", false],
		]);
	});
});

describe("the other members and everyone else", () => {
	it("a member who is not an owner sees the members and changes nothing", async () => {
		expect((await members("ada")).status).toBe(200);
		expect((await add("ada", "bob@example.com", "reader")).status).toBe(403);
		expect((await setRole("ada", "ada", "owner")).status).toBe(403);
		expect((await remove("ada", "lead")).status).toBe(403);
		expect((await history("ada")).status).toBe(403);
	});

	it("a person who is not a member is told the mailbox does not exist", async () => {
		expect((await members("outsider")).status).toBe(404);
		expect((await add("outsider", "outsider@example.com", "owner")).status).toBe(404);
		expect((await history("outsider")).status).toBe(404);
		expect((await as("outsider").fetch("/api/v1/registry/mailboxes")).status).toBe(403);
	});
});

describe("whoever manages the instance", () => {
	it("sees every mailbox in the registry: who owns it, nothing of its mail or settings", async () => {
		const res = await as("admin").fetch("/api/v1/registry/mailboxes");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual([
			{ address: MAILBOX, name: "Team", members: 2, owners: ["lead@example.com"], role: null },
		]);
	});

	it("without a membership sees the members and still cannot open the mailbox", async () => {
		expect((await members("admin")).status).toBe(200);
		expect((await history("admin")).status).toBe(200);
		expect((await inbox("admin")).status).toBe(404);
		expect((await as("admin").fetch(M)).status).toBe(404);
		expect((await as("admin").fetch(`${M}/folders`)).status).toBe(404);
		const settings = await as("admin").fetch(M, {
			method: "PUT",
			body: JSON.stringify({ settings: { fromName: "Taken over" } }),
		});
		expect(settings.status).toBe(404);
		expect((await as("admin").fetch(M, { method: "DELETE" })).status).toBe(404);
	});

	it("gives themselves a membership, which opens the mailbox and is on record for its owners", async () => {
		expect((await add("admin", "admin@example.com", "reader")).status).toBe(201);
		expect((await inbox("admin")).status).toBe(200);

		const [latest] = await json<Change[]>(await history("lead"));
		expect(latest).toEqual(
			expect.objectContaining({
				change: "set",
				person: "admin@example.com",
				by: "admin@example.com",
				role: "reader",
				self: true,
				asManager: true,
			}),
		);
		const list = await json<Member[]>(await members("lead"));
		expect(list.find((m) => m.email === "admin@example.com")?.addedBy).toBe("admin@example.com");
	});

	it("leaves the record behind after removing themselves again", async () => {
		expect((await remove("admin", "admin")).status).toBe(204);
		expect((await inbox("admin")).status).toBe(404);
		const changes = await json<Change[]>(await history("lead"));
		expect(changes.slice(0, 2).map((c) => [c.change, c.person, c.self, c.asManager])).toEqual([
			["removed", "admin@example.com", true, true],
			["set", "admin@example.com", true, true],
		]);
	});

	it("cannot leave a mailbox without an owner", async () => {
		expect((await remove("admin", "lead")).status).toBe(409);
		expect((await setRole("admin", "lead", "reader")).status).toBe(409);
		expect((await inbox("lead")).status).toBe(200);
	});

	it("needs fresh proof for every change, and none to look", async () => {
		await ageSessions(ids.admin ?? "", 11);
		as("admin").forget("session_data");
		expect((await members("admin")).status).toBe(200);
		expect((await history("admin")).status).toBe(200);
		for (const res of [
			await add("admin", "admin@example.com", "owner"),
			await setRole("admin", "ada", "owner"),
			await remove("admin", "ada"),
		]) {
			expect(res.status).toBe(403);
			expect((await json<{ code: string }>(res)).code).toBe("SESSION_NOT_FRESH");
		}
		expect((await inbox("admin")).status).toBe(404);
	});

	it("writes every change to the audit log with the capacity it was made in", async () => {
		const rows = await testEnv.DB.prepare(
			`select "detail" from "audit" where "action" like 'membership.%' and "actor_user_id" = ?1 order by "at"`,
		)
			.bind(ids.admin)
			.all<{ detail: string }>();
		expect(rows.results.map((r) => r.detail)).toEqual([
			`self: ${ids.admin}, role: reader, as: manager`,
			`self: ${ids.admin}, as: manager`,
		]);
	});
});
