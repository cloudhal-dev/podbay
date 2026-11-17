/**
 * Tier 3: invitations and mailbox members, end to end on a local D1 database.
 *
 * - only owners and administrators invite, and only an owner invites an administrator;
 * - an invitation link works once, for the invited address, until it expires or is revoked;
 * - the token is never stored;
 * - a mailbox owner gives, changes and removes memberships, and a mailbox always keeps an owner;
 * - none of this lets a manager read a mailbox they are not a member of.
 */
import { beforeAll, describe, expect, it } from "vitest";
import {
	createMailbox,
	migrate,
	PASSWORD,
	request,
	setupOwner,
	signIn,
	testEnv,
} from "./helpers.ts";

const MAILBOX = "team@example.com";
const cookies: Record<string, string> = {};
const ids: Record<string, string> = {};

interface Invitation {
	id: string;
	email: string;
	role: string;
	link: string;
}

async function invite(who: string, email: string, role = "member"): Promise<Response> {
	return request("/api/v1/invitations", {
		method: "POST",
		cookie: cookies[who],
		body: JSON.stringify({ email, role }),
	});
}

function tokenOf(invitation: Invitation): string {
	return invitation.link.split("/accept/")[1] ?? "";
}

async function accept(token: string, name: string, password = PASSWORD): Promise<Response> {
	return request(`/api/invitations/${token}/accept`, {
		method: "POST",
		body: JSON.stringify({ name, password }),
	});
}

/** Invite, accept and sign in. Returns the new person's id. */
async function admit(who: string, email: string, key: string, role = "member"): Promise<void> {
	const res = await invite(who, email, role);
	expect(res.status).toBe(201);
	expect((await accept(tokenOf((await res.json()) as Invitation), key)).status).toBe(201);
	cookies[key] = await signIn(email);
	const me = (await (await request("/api/v1/me", { cookie: cookies[key] })).json()) as {
		user: { id: string };
	};
	ids[key] = me.user.id;
}

const members = (who: string) =>
	request(`/api/v1/mailboxes/${encodeURIComponent(MAILBOX)}/members`, { cookie: cookies[who] });
const setMember = (who: string, userId: string, role: string) =>
	request(`/api/v1/mailboxes/${encodeURIComponent(MAILBOX)}/members/${userId}`, {
		method: "PUT",
		cookie: cookies[who],
		body: JSON.stringify({ role }),
	});
const folders = (who: string) =>
	request(`/api/v1/mailboxes/${encodeURIComponent(MAILBOX)}/folders`, { cookie: cookies[who] });

beforeAll(async () => {
	await migrate();
	expect((await setupOwner()).status).toBe(201);
	cookies.owner = await signIn("owner@example.com");
	const me = (await (await request("/api/v1/me", { cookie: cookies.owner })).json()) as {
		user: { id: string };
	};
	ids.owner = me.user.id;
	expect((await createMailbox(cookies.owner ?? "", MAILBOX)).status).toBe(201);
});

describe("invitations", () => {
	it("lets the owner invite a person, who accepts once and signs in", async () => {
		const res = await invite("owner", "Ada@Example.org");
		expect(res.status).toBe(201);
		const invitation = (await res.json()) as Invitation;
		expect(invitation.email).toBe("ada@example.org");
		expect(invitation.link).toMatch(/^https:\/\/podbay\.test\/accept\/[A-Za-z0-9_-]{40,}$/);

		const token = tokenOf(invitation);
		const seen = await request(`/api/invitations/${token}`);
		expect(await seen.json()).toEqual({ email: "ada@example.org" });

		expect((await accept(token, "Ada", "too short")).status).toBe(400);
		expect((await accept(token, "Ada")).status).toBe(201);

		cookies.ada = await signIn("ada@example.org");
		const me = (await (await request("/api/v1/me", { cookie: cookies.ada })).json()) as {
			user: { id: string; email: string };
			role: string;
			mailboxes: unknown[];
		};
		expect(me).toMatchObject({ user: { email: "ada@example.org" }, role: "member", mailboxes: [] });
		ids.ada = me.user.id;

		// The link is spent.
		expect((await accept(token, "Mallory")).status).toBe(404);
		expect((await request(`/api/invitations/${token}`)).status).toBe(404);
	});

	it("never stores the token", async () => {
		const res = await invite("owner", "probe@example.org");
		const token = tokenOf((await res.json()) as Invitation);
		const rows = await testEnv.DB.prepare(`select * from "invitations"`).all<
			Record<string, unknown>
		>();
		expect(rows.results.length).toBeGreaterThan(0);
		expect(JSON.stringify(rows.results)).not.toContain(token);
	});

	it("gives the same answer for an unknown, a revoked and an expired link", async () => {
		expect((await accept("not-a-real-token-not-a-real-token-not-a-real", "X")).status).toBe(404);

		const revoked = (await (await invite("owner", "revoked@example.org")).json()) as Invitation;
		const del = await request(`/api/v1/invitations/${revoked.id}`, {
			method: "DELETE",
			cookie: cookies.owner,
		});
		expect(del.status).toBe(204);
		expect((await accept(tokenOf(revoked), "X")).status).toBe(404);

		const expired = (await (await invite("owner", "expired@example.org")).json()) as Invitation;
		await testEnv.DB.prepare(`update "invitations" set "expires_at" = ?1 where "id" = ?2`)
			.bind(new Date(Date.now() - 1000).toISOString(), expired.id)
			.run();
		expect((await accept(tokenOf(expired), "X")).status).toBe(404);
		for (const email of ["revoked@example.org", "expired@example.org"]) {
			const user = await testEnv.DB.prepare(`select count(*) as "n" from "user" where "email" = ?1`)
				.bind(email)
				.first<{ n: number }>();
			expect(user?.n, email).toBe(0);
		}
	});

	it("revokes the earlier link when a person is invited again", async () => {
		const first = (await (await invite("owner", "twice@example.org")).json()) as Invitation;
		const second = (await (await invite("owner", "twice@example.org")).json()) as Invitation;
		expect((await accept(tokenOf(first), "Twice")).status).toBe(404);
		expect((await accept(tokenOf(second), "Twice")).status).toBe(201);
	});

	it("refuses an address that already has an account, and a malformed request", async () => {
		expect((await invite("owner", "ada@example.org")).status).toBe(409);
		expect((await invite("owner", "not an address")).status).toBe(400);
		expect((await invite("owner", "x@example.org", "owner")).status).toBe(400);
	});

	it("is for owners and administrators, and only an owner invites an administrator", async () => {
		expect((await invite("ada", "friend@example.org")).status).toBe(403);
		await admit("owner", "admin@example.org", "admin", "admin");
		expect((await invite("admin", "colleague@example.org")).status).toBe(201);
		expect((await invite("admin", "boss@example.org", "admin")).status).toBe(403);
		expect((await request("/api/v1/invitations", { cookie: cookies.ada })).status).toBe(403);
		expect((await request("/api/v1/users", { cookie: cookies.ada })).status).toBe(403);
	});

	it("lists people and invitations for managers, without any token", async () => {
		const peopleList = (await (
			await request("/api/v1/users", { cookie: cookies.admin })
		).json()) as {
			email: string;
			role: string;
		}[];
		expect(peopleList.map((p) => `${p.email}:${p.role}`)).toEqual(
			expect.arrayContaining([
				"owner@example.com:owner",
				"ada@example.org:member",
				"admin@example.org:admin",
			]),
		);
		const list = await request("/api/v1/invitations", { cookie: cookies.admin });
		const text = await list.text();
		expect(text).not.toContain("token");
		expect(text).not.toContain("/accept/");
		const states = (JSON.parse(text) as { email: string; state: string }[]).map(
			(i) => `${i.email}:${i.state}`,
		);
		expect(states).toEqual(
			expect.arrayContaining([
				"ada@example.org:accepted",
				"revoked@example.org:revoked",
				"expired@example.org:expired",
			]),
		);
	});

	it("records invitations in the audit log", async () => {
		const rows = await testEnv.DB.prepare(
			`select "action", count(*) as "n" from "audit" where "action" like 'invitation.%' group by "action"`,
		).all<{ action: string; n: number }>();
		const counts = Object.fromEntries(rows.results.map((r) => [r.action, r.n]));
		expect(counts["invitation.created"]).toBeGreaterThanOrEqual(6);
		expect(counts["invitation.accepted"]).toBe(3);
		expect(counts["invitation.revoked"]).toBe(1);
	});
});

describe("mailbox members", () => {
	it("starts with the creator as the only owner", async () => {
		const list = (await (await members("owner")).json()) as { email: string; role: string }[];
		expect(list).toEqual([expect.objectContaining({ email: "owner@example.com", role: "owner" })]);
	});

	it("an invited person has no access until a mailbox owner gives it", async () => {
		expect((await folders("ada")).status).toBe(404);
		expect((await setMember("owner", ids.ada ?? "", "reader")).status).toBe(200);
		expect((await folders("ada")).status).toBe(200);
	});

	it("a reader sees the members but cannot change them or the mail", async () => {
		expect((await members("ada")).status).toBe(200);
		expect((await setMember("ada", ids.ada ?? "", "owner")).status).toBe(403);
		const write = await request(`/api/v1/mailboxes/${encodeURIComponent(MAILBOX)}/folders`, {
			method: "POST",
			cookie: cookies.ada,
			body: JSON.stringify({ name: "Mine" }),
		});
		expect(write.status).toBe(403);
	});

	it("the owner changes a role and removes a member", async () => {
		expect((await setMember("owner", ids.ada ?? "", "sender")).status).toBe(200);
		const me = (await (await request("/api/v1/me", { cookie: cookies.ada })).json()) as {
			mailboxes: { address: string; role: string }[];
		};
		expect(me.mailboxes).toEqual([expect.objectContaining({ address: MAILBOX, role: "sender" })]);

		const remove = await request(
			`/api/v1/mailboxes/${encodeURIComponent(MAILBOX)}/members/${ids.ada}`,
			{
				method: "DELETE",
				cookie: cookies.owner,
			},
		);
		expect(remove.status).toBe(204);
		expect((await folders("ada")).status).toBe(404);
	});

	it("a mailbox always keeps an owner", async () => {
		expect((await setMember("owner", ids.owner ?? "", "reader")).status).toBe(409);
		const remove = await request(
			`/api/v1/mailboxes/${encodeURIComponent(MAILBOX)}/members/${ids.owner}`,
			{
				method: "DELETE",
				cookie: cookies.owner,
			},
		);
		expect(remove.status).toBe(409);
		expect((await folders("owner")).status).toBe(200);
	});

	it("refuses a role that does not exist and a person who is not on the instance", async () => {
		expect((await setMember("owner", ids.ada ?? "", "superuser")).status).toBe(400);
		expect((await setMember("owner", "no-such-user", "reader")).status).toBe(400);
	});

	it("an administrator without a membership cannot open the mailbox (members.test.ts has the rest)", async () => {
		expect((await folders("admin")).status).toBe(404);
	});

	it("records membership changes in the audit log", async () => {
		const rows = await testEnv.DB.prepare(
			`select "action", count(*) as "n" from "audit" where "action" like 'membership.%' group by "action"`,
		).all<{ action: string; n: number }>();
		const counts = Object.fromEntries(rows.results.map((r) => [r.action, r.n]));
		expect(counts["membership.set"]).toBe(2);
		expect(counts["membership.removed"]).toBe(1);
	});
});
