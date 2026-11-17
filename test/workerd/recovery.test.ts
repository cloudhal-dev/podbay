/**
 * Tier 3: recovery links (rule S10).
 *
 * - a link is issued by someone else: an owner for anyone, an administrator for members, the
 *   operator for an owner; never for oneself, never without fresh proof;
 * - it works once, for a limited time, and only its digest is stored;
 * - using it sets a new password and takes the account back to that password alone: sessions
 *   end, the authenticator app and passkeys are removed, keys for programs are revoked.
 */
import { beforeAll, describe, expect, it } from "vitest";
import {
	AUTH,
	ageSessions,
	Browser,
	createMailbox,
	enableApp,
	json,
	migrate,
	ORIGIN,
	PASSWORD,
	passkeySignIn,
	registerPasskey,
	request,
	seedMembership,
	seedUser,
	setupOwner,
	testEnv,
} from "./helpers.ts";

const MAILBOX = "team@example.com";
const NEW_PASSWORD = "a brand new passphrase";
const ids: Record<string, string> = {};
const browsers: Record<string, Browser> = {};

interface Issued {
	email: string;
	expiresAt: string;
	link: string;
}

const tokenOf = (issued: Issued) => issued.link.split("/recover/")[1] ?? "";
const issue = (who: string, target: string) =>
	(browsers[who] as Browser).post(`/api/v1/users/${ids[target]}/recovery`);
const redeem = (token: string, password = NEW_PASSWORD) =>
	request(`/api/recovery/${token}`, { method: "POST", body: JSON.stringify({ password }) });
const operator = (body: Record<string, unknown>, init: RequestInit = {}) =>
	request("/api/setup/recovery", { method: "POST", body: JSON.stringify(body), ...init });

async function signedIn(email: string, password = PASSWORD): Promise<Browser> {
	const browser = new Browser();
	expect((await browser.signIn(email, password)).status).toBe(200);
	return browser;
}

beforeAll(async () => {
	await migrate();
	expect((await setupOwner()).status).toBe(201);
	browsers.owner = await signedIn("owner@example.com");
	ids.owner = (await browsers.owner.me()).id ?? "";
	expect((await createMailbox(browsers.owner.cookie, MAILBOX)).status).toBe(201);

	ids.owner2 = await seedUser("owner2@example.com", "owner");
	ids.admin = await seedUser("admin@example.com", "admin");
	ids.admin2 = await seedUser("admin2@example.com", "admin");
	for (const who of ["member", "lost", "twice", "weak", "stale"]) {
		ids[who] = await seedUser(`${who}@example.com`, "member");
	}
	await seedMembership(MAILBOX, ids.lost ?? "", "sender");
	browsers.admin = await signedIn("admin@example.com");
	browsers.member = await signedIn("member@example.com");
});

describe("issuing a recovery link", () => {
	it("gives the link once, and stores only a digest", async () => {
		const res = await issue("owner", "member");
		expect(res.status).toBe(201);
		const issued = await json<Issued>(res);
		expect(issued.email).toBe("member@example.com");
		expect(issued.link).toMatch(/^https:\/\/podbay\.test\/recover\/[A-Za-z0-9_-]{40,}$/);
		expect(Date.parse(issued.expiresAt) - Date.now()).toBeLessThanOrEqual(24 * 3_600_000);

		const rows = await testEnv.DB.prepare(`select * from "recoveries"`).all();
		expect(JSON.stringify(rows.results)).not.toContain(tokenOf(issued));
	});

	it("lets an owner recover anyone else, and an administrator only members", async () => {
		expect((await issue("owner", "admin")).status).toBe(201);
		expect((await issue("owner", "owner2")).status).toBe(201);
		expect((await issue("admin", "member")).status).toBe(201);
		expect((await issue("admin", "admin2")).status).toBe(403);
		expect((await issue("admin", "owner")).status).toBe(403);
	});

	it("is refused for oneself, to a member, without a session and for nobody", async () => {
		expect((await issue("owner", "owner")).status).toBe(403);
		expect((await issue("admin", "admin")).status).toBe(403);
		expect((await issue("member", "lost")).status).toBe(403);
		expect((await new Browser().post(`/api/v1/users/${ids.member}/recovery`)).status).toBe(401);
		expect((await browsers.owner?.post("/api/v1/users/nobody/recovery"))?.status).toBe(404);
	});

	it("needs fresh proof", async () => {
		const browser = await signedIn("owner2@example.com");
		await ageSessions(ids.owner2 ?? "", 11);
		const res = await browser.post(`/api/v1/users/${ids.member}/recovery`);
		expect(res.status).toBe(403);
		expect((await json<{ code: string }>(res)).code).toBe("SESSION_NOT_FRESH");
	});

	it("is written to the audit log, without the token", async () => {
		const issued = await json<Issued>(await issue("owner", "member"));
		const rows = await testEnv.DB.prepare(
			`select "actor_user_id", "target", "detail" from "audit" where "action" = 'recovery.issued' and "target" = ?1`,
		)
			.bind(ids.member)
			.all<{ actor_user_id: string; target: string; detail: string }>();
		expect(rows.results.length).toBeGreaterThan(0);
		expect(rows.results.some((r) => r.actor_user_id === ids.owner)).toBe(true);
		expect(JSON.stringify(rows.results)).not.toContain(tokenOf(issued));
	});
});

describe("using a recovery link", () => {
	it("takes the account back to a new password alone", async () => {
		// A person with everything: a session, a passkey, an authenticator app and a key.
		const before = await signedIn("lost@example.com");
		const passkey = await registerPasskey(before);
		await enableApp(before);
		const key = await before.post("/api/v1/keys", {
			name: "client",
			access: "read",
			mailboxes: [MAILBOX],
		});
		expect(key.status).toBe(201);

		const issued = await json<Issued>(await issue("owner", "lost"));
		const token = tokenOf(issued);
		expect(await (await request(`/api/recovery/${token}`)).json()).toEqual({
			email: "lost@example.com",
		});
		const used = await redeem(token);
		expect(used.status).toBe(200);
		// The link signs nobody in.
		expect(used.headers.getSetCookie()).toEqual([]);

		// Every session ended (the copy cached in the cookie runs out within a minute).
		before.forget("session_data");
		expect((await before.me()).status).toBe(401);
		// The old password is gone, the new one works, and no code is asked.
		expect((await new Browser().signIn("lost@example.com")).status).toBe(401);
		const after = new Browser();
		const signIn = await after.signIn("lost@example.com", NEW_PASSWORD);
		expect(signIn.status).toBe(200);
		expect((await json<{ twoFactorRedirect?: boolean }>(signIn)).twoFactorRedirect).toBeUndefined();
		expect((await after.me()).email).toBe("lost@example.com");

		// The passkey no longer signs in, and the key no longer works.
		expect((await passkeySignIn(new Browser(), passkey)).status).toBeGreaterThanOrEqual(400);
		const keys = await json<{ state: string }[]>(await after.fetch("/api/v1/keys"));
		expect(keys.map((k) => k.state)).toEqual(["revoked"]);
		expect(await json(await after.fetch(`${AUTH}/passkey/list-user-passkeys`))).toEqual([]);

		const audit = await testEnv.DB.prepare(
			`select count(*) as "n" from "audit" where "action" = 'recovery.used' and "target" = ?1`,
		)
			.bind(ids.lost)
			.first<{ n: number }>();
		expect(audit?.n).toBe(1);
	});

	it("works once, even for two requests at once", async () => {
		const token = tokenOf(await json<Issued>(await issue("owner", "twice")));
		const [a, b] = await Promise.all([redeem(token, "the first new passphrase"), redeem(token)]);
		expect([a.status, b.status].sort()).toEqual([200, 404]);
		expect((await redeem(token)).status).toBe(404);
		expect((await request(`/api/recovery/${token}`)).status).toBe(404);
	});

	it("does not use the link up on a password that is too short", async () => {
		const token = tokenOf(await json<Issued>(await issue("owner", "weak")));
		expect((await redeem(token, "short")).status).toBe(400);
		expect((await request(`/api/recovery/${token}`)).status).toBe(200);
		expect((await new Browser().signIn("weak@example.com")).status).toBe(200);
	});

	it("gives one answer for an unknown, a replaced and an expired link", async () => {
		const first = tokenOf(await json<Issued>(await issue("owner", "weak")));
		const second = tokenOf(await json<Issued>(await issue("owner", "weak")));
		const unknown = await request("/api/recovery/not-a-real-token");
		const answer = await unknown.text();
		const replaced = await request(`/api/recovery/${first}`);
		expect(unknown.status).toBe(404);
		expect(replaced.status).toBe(404);
		expect(await replaced.text()).toBe(answer);
		expect((await redeem(first)).status).toBe(404);

		await testEnv.DB.prepare(
			`update "recoveries" set "expires_at" = ?1 where "user_id" = ?2 and "revoked_at" is null`,
		)
			.bind(new Date(Date.now() - 1000).toISOString(), ids.weak)
			.run();
		const expired = await request(`/api/recovery/${second}`);
		expect(expired.status).toBe(404);
		expect(await expired.text()).toBe(answer);
		expect((await redeem(second)).status).toBe(404);
		expect((await new Browser().signIn("weak@example.com")).status).toBe(200);
	});

	it("must come from the app's own origin", async () => {
		const token = tokenOf(await json<Issued>(await issue("owner", "weak")));
		const res = await request(`/api/recovery/${token}`, {
			method: "POST",
			headers: { origin: "https://elsewhere.test" },
			body: JSON.stringify({ password: NEW_PASSWORD }),
		});
		expect(res.status).toBe(403);
		expect((await request(`/api/recovery/${token}`)).status).toBe(200);
	});
});

describe("the operator path", () => {
	it("gives an owner a link with the setup token, and only an owner", async () => {
		const res = await operator({ token: testEnv.SETUP_TOKEN, email: "Owner@Example.com" });
		expect(res.status).toBe(201);
		const issued = await json<Issued>(res);
		expect(issued.email).toBe("owner@example.com");

		for (const email of ["admin@example.com", "member@example.com", "nobody@example.com"]) {
			const refused = await operator({ token: testEnv.SETUP_TOKEN, email });
			expect(refused.status, email).toBe(404);
		}

		expect((await redeem(tokenOf(issued))).status).toBe(200);
		expect((await new Browser().signIn("owner@example.com", NEW_PASSWORD)).status).toBe(200);
		const audit = await testEnv.DB.prepare(
			`select "actor_user_id", "detail" from "audit" where "action" = 'recovery.issued' and "target" = ?1 order by "at" desc`,
		)
			.bind(ids.owner)
			.first<{ actor_user_id: string | null; detail: string }>();
		expect(audit).toEqual({ actor_user_id: null, detail: "by: operator" });
	});

	it("is refused without the right token, and from another origin", async () => {
		const email = "owner2@example.com";
		expect((await operator({ token: "not the setup token at all, not it", email })).status).toBe(
			403,
		);
		expect((await operator({ email })).status).toBe(400);
		const elsewhere = await operator(
			{ token: testEnv.SETUP_TOKEN, email },
			{ headers: { origin: "https://elsewhere.test" } },
		);
		expect(elsewhere.status).toBe(403);
		const rows = await testEnv.DB.prepare(
			`select count(*) as "n" from "recoveries" where "user_id" = ?1 and "issued_by" is null`,
		)
			.bind(ids.owner2)
			.first<{ n: number }>();
		expect(rows?.n).toBe(0);
	});

	it("is a link like any other: it is not a session", async () => {
		const res = await operator({ token: testEnv.SETUP_TOKEN, email: "owner2@example.com" });
		expect(res.headers.getSetCookie()).toEqual([]);
		expect(ORIGIN).toBe(new URL((await json<Issued>(res)).link).origin);
	});
});
