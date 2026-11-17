/**
 * Tier 3: the second step, passkeys and fresh proof (rule S10).
 *
 * - an authenticator app is enabled with the password and a first code, and from then on every
 *   password sign-in needs a code or a recovery code; there are no trusted devices and no codes
 *   by mail;
 * - a passkey is a complete sign-in, bound to this site, and must verify the person;
 * - sensitive changes need a session that signed in a few minutes ago, and signing in again
 *   replaces the session.
 *
 * The passkey and the authenticator app are software doubles (test/helpers/authenticator.ts);
 * the server's verification is the real one.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { createPasskey, type SoftwarePasskey, totpCode } from "../helpers/authenticator.ts";
import {
	ageSessions,
	Browser,
	createMailbox,
	migrate,
	ORIGIN,
	PASSWORD,
	seedMembership,
	seedUser,
	setupOwner,
	testEnv,
} from "./helpers.ts";

const AUTH = "/api/auth";
const MAILBOX = "team@example.com";
const ids: Record<string, string> = {};

async function signedIn(email: string): Promise<Browser> {
	const browser = new Browser();
	expect((await browser.signIn(email)).status).toBe(200);
	return browser;
}

async function json<T>(res: Response): Promise<T> {
	return (await res.json()) as T;
}

async function sessionsOf(userId: string): Promise<number> {
	const row = await testEnv.DB.prepare(`select count(*) as "n" from "session" where "userId" = ?1`)
		.bind(userId)
		.first<{ n: number }>();
	return row?.n ?? 0;
}

/** Enable the authenticator app for a signed-in browser. Returns what the person keeps. */
async function enableApp(browser: Browser): Promise<{ uri: string; codes: string[] }> {
	const enabled = await browser.post(`${AUTH}/two-factor/enable`, { password: PASSWORD });
	expect(enabled.status).toBe(200);
	const { totpURI, backupCodes } = await json<{ totpURI: string; backupCodes: string[] }>(enabled);
	const confirmed = await browser.post(`${AUTH}/two-factor/verify-totp`, {
		code: await totpCode(totpURI),
	});
	expect(confirmed.status).toBe(200);
	return { uri: totpURI, codes: backupCodes };
}

async function registerPasskey(browser: Browser, name = "Laptop"): Promise<SoftwarePasskey> {
	const passkey = await createPasskey();
	const options = await browser.fetch(`${AUTH}/passkey/generate-register-options`);
	expect(options.status).toBe(200);
	const verified = await browser.post(`${AUTH}/passkey/verify-registration`, {
		response: await passkey.register(await json(options), ORIGIN),
		name,
	});
	expect(verified.status).toBe(200);
	return passkey;
}

/** One passkey sign-in attempt in a browser. */
async function passkeySignIn(
	browser: Browser,
	passkey: SoftwarePasskey,
	how: { origin?: string; verified?: boolean; rpId?: string } = {},
): Promise<Response> {
	const options = await browser.fetch(`${AUTH}/passkey/generate-authenticate-options`);
	expect(options.status).toBe(200);
	return browser.post(`${AUTH}/passkey/verify-authentication`, {
		response: await passkey.assert(await json(options), how.origin ?? ORIGIN, how),
	});
}

beforeAll(async () => {
	await migrate();
	expect((await setupOwner()).status).toBe(201);
	const owner = await signedIn("owner@example.com");
	ids.owner = (await owner.me()).id ?? "";
	expect((await createMailbox(owner.cookie, MAILBOX)).status).toBe(201);
	for (const who of ["app", "codes", "limited", "key", "both", "stale", "outsider"]) {
		ids[who] = await seedUser(`${who}@example.com`, "member");
	}
	await seedMembership(MAILBOX, ids.stale ?? "", "owner");
});

describe("the authenticator app", () => {
	let uri: string;
	let codes: string[];

	it("is enabled with the password and a first code, and stores nothing readable", async () => {
		const browser = await signedIn("app@example.com");
		const wrong = await browser.post(`${AUTH}/two-factor/enable`, { password: "not the password" });
		expect(wrong.status).toBeGreaterThanOrEqual(400);

		({ uri, codes } = await enableApp(browser));
		expect(codes.length).toBeGreaterThanOrEqual(8);
		// Enabling replaced the session; the browser is still signed in.
		expect((await browser.me()).status).toBe(200);

		const stored = await testEnv.DB.prepare(`select * from "twoFactor" where "userId" = ?1`)
			.bind(ids.app)
			.first<Record<string, unknown>>();
		const text = JSON.stringify(stored);
		expect(text).not.toContain(new URL(uri).searchParams.get("secret"));
		for (const code of codes) expect(text).not.toContain(code);
	});

	it("is not in force before the first code confirms it", async () => {
		const browser = await signedIn("limited@example.com");
		expect((await browser.post(`${AUTH}/two-factor/enable`, { password: PASSWORD })).status).toBe(
			200,
		);
		const again = new Browser();
		const signIn = await json<{ twoFactorRedirect?: boolean }>(
			await again.signIn("limited@example.com"),
		);
		expect(signIn.twoFactorRedirect).toBeUndefined();
		expect((await again.me()).status).toBe(200);
	});

	it("then stands between the password and a session", async () => {
		const browser = new Browser();
		const first = await browser.signIn("app@example.com");
		expect(first.status).toBe(200);
		expect((await json<{ twoFactorRedirect: boolean }>(first)).twoFactorRedirect).toBe(true);
		expect((await browser.me()).status).toBe(401);

		const wrong = await browser.post(`${AUTH}/two-factor/verify-totp`, { code: "000000" });
		expect(wrong.status).toBe(401);
		expect((await browser.me()).status).toBe(401);

		const right = await browser.post(`${AUTH}/two-factor/verify-totp`, {
			code: await totpCode(uri),
		});
		expect(right.status).toBe(200);
		expect((await browser.me()).email).toBe("app@example.com");
	});

	it("cannot be answered without the password step", async () => {
		const browser = new Browser();
		const res = await browser.post(`${AUTH}/two-factor/verify-totp`, { code: await totpCode(uri) });
		expect(res.status).toBe(401);
		expect((await browser.me()).status).toBe(401);
	});

	it("accepts a recovery code once", async () => {
		const browser = new Browser();
		await browser.signIn("app@example.com");
		const used = await browser.post(`${AUTH}/two-factor/verify-backup-code`, { code: codes[0] });
		expect(used.status).toBe(200);
		expect((await browser.me()).status).toBe(200);

		const second = new Browser();
		await second.signIn("app@example.com");
		const reused = await second.post(`${AUTH}/two-factor/verify-backup-code`, { code: codes[0] });
		expect(reused.status).toBe(401);
		expect((await second.me()).status).toBe(401);
	});

	it("has no trusted devices: every sign-in passes the second step", async () => {
		const browser = new Browser();
		await browser.signIn("app@example.com");
		const asked = await browser.post(`${AUTH}/two-factor/verify-totp`, {
			code: await totpCode(uri),
			trustDevice: true,
		});
		expect(asked.status).toBe(400);
		expect((await browser.me()).status).toBe(401);

		expect(
			(await browser.post(`${AUTH}/two-factor/verify-totp`, { code: await totpCode(uri) })).status,
		).toBe(200);
		expect([...browser.jar.keys()].filter((name) => name.includes("trust"))).toEqual([]);

		// The same browser, with every cookie it has, is asked again.
		const again = await browser.signIn("app@example.com");
		expect((await json<{ twoFactorRedirect: boolean }>(again)).twoFactorRedirect).toBe(true);
	});

	it("does not offer codes by mail or text message", async () => {
		const browser = await signedIn("codes@example.com");
		const byMail = await browser.post(`${AUTH}/two-factor/enable`, {
			password: PASSWORD,
			method: "otp",
		});
		expect(byMail.status).toBe(400);
		expect((await browser.post(`${AUTH}/two-factor/send-otp`)).status).toBe(404);
		expect((await browser.post(`${AUTH}/two-factor/verify-otp`, { code: "123456" })).status).toBe(
			404,
		);
		const row = await testEnv.DB.prepare(
			`select "twoFactorEnabled" as "on" from "user" where "id" = ?1`,
		)
			.bind(ids.codes)
			.first<{ on: number | null }>();
		expect(row?.on ?? 0).toBe(0);
	});

	it("limits guesses from one address", async () => {
		const browser = new Browser();
		await browser.signIn("app@example.com");
		const statuses: number[] = [];
		for (let i = 0; i < 5; i++) {
			statuses.push(
				(await browser.post(`${AUTH}/two-factor/verify-totp`, { code: `11111${i}` })).status,
			);
		}
		expect(statuses).toContain(429);
		expect(statuses).not.toContain(200);
	});
});

describe("a passkey", () => {
	let passkey: SoftwarePasskey;

	it("is registered by a signed-in person and then signs them in by itself", async () => {
		const browser = await signedIn("key@example.com");
		passkey = await registerPasskey(browser);
		const listed = await json<{ name: string }[]>(
			await browser.fetch(`${AUTH}/passkey/list-user-passkeys`),
		);
		expect(listed.map((p) => p.name)).toEqual(["Laptop"]);

		const fresh = new Browser();
		expect((await passkeySignIn(fresh, passkey)).status).toBe(200);
		expect((await fresh.me()).email).toBe("key@example.com");
	});

	it("cannot be registered without a session", async () => {
		const browser = new Browser();
		const res = await browser.fetch(`${AUTH}/passkey/generate-register-options`);
		expect(res.status).toBe(401);
	});

	it("is refused when the person was not verified (a touch without PIN or biometrics)", async () => {
		const browser = new Browser();
		expect(
			(await passkeySignIn(browser, passkey, { verified: false })).status,
		).toBeGreaterThanOrEqual(400);
		expect((await browser.me()).status).toBe(401);
	});

	it("is refused when the answer was made for another site", async () => {
		const other = new Browser();
		expect(
			(await passkeySignIn(other, passkey, { origin: "https://podbay.example" })).status,
		).toBeGreaterThanOrEqual(400);
		expect((await other.me()).status).toBe(401);

		const otherId = new Browser();
		expect(
			(await passkeySignIn(otherId, passkey, { rpId: "podbay.example" })).status,
		).toBeGreaterThanOrEqual(400);
		expect((await otherId.me()).status).toBe(401);
	});

	it("is refused when it was never registered", async () => {
		const browser = new Browser();
		const unknown = await createPasskey();
		// A passkey that was made for this site and this person's id, but never stored here.
		await unknown.register(
			{ challenge: "unused", rp: { id: new URL(ORIGIN).hostname }, user: { id: "someone" } },
			ORIGIN,
		);
		expect((await passkeySignIn(browser, unknown)).status).toBeGreaterThanOrEqual(400);
		expect((await browser.me()).status).toBe(401);
	});

	it("answers one challenge once", async () => {
		const browser = new Browser();
		const options = await browser.fetch(`${AUTH}/passkey/generate-authenticate-options`);
		const response = await passkey.assert(await json(options), ORIGIN);
		expect((await browser.post(`${AUTH}/passkey/verify-authentication`, { response })).status).toBe(
			200,
		);

		// The same answer again: from the same browser, and from one that only saw the answer.
		const replay = new Browser();
		for (const [name, value] of browser.jar)
			if (!name.includes("session")) replay.jar.set(name, value);
		expect(
			(await replay.post(`${AUTH}/passkey/verify-authentication`, { response })).status,
		).toBeGreaterThanOrEqual(400);
		expect((await replay.me()).status).toBe(401);
	});

	it("is a complete sign-in for a person who also has an authenticator app", async () => {
		const browser = await signedIn("both@example.com");
		const mine = await registerPasskey(browser, "Phone");
		await enableApp(browser);

		const withPassword = new Browser();
		const first = await json<{ twoFactorRedirect?: boolean }>(
			await withPassword.signIn("both@example.com"),
		);
		expect(first.twoFactorRedirect).toBe(true);

		const withPasskey = new Browser();
		expect((await passkeySignIn(withPasskey, mine)).status).toBe(200);
		expect((await withPasskey.me()).email).toBe("both@example.com");
	});
});

describe("fresh proof for sensitive changes", () => {
	const NOT_FRESH = { error: "Confirm it is you to continue.", code: "SESSION_NOT_FRESH" };
	const M = `/api/v1/mailboxes/${encodeURIComponent(MAILBOX)}`;
	let browser: Browser;

	const put = (path: string, body: unknown) =>
		browser.fetch(path, { method: "PUT", body: JSON.stringify(body) });
	const settings = (forwardTo: string) => ({
		settings: {
			fromName: "Team",
			forwarding: { enabled: forwardTo !== "", email: forwardTo },
			signature: { enabled: true, text: "Regards" },
			autoReply: { enabled: false, subject: "", message: "" },
		},
	});

	beforeAll(async () => {
		browser = await signedIn("stale@example.com");
		expect((await put(M, settings(""))).status).toBe(200);
		await ageSessions(ids.stale ?? "", 11);
		// The copy of the session cached in the cookie has run out as well.
		browser.forget("session_data");
	});

	it("still lets an older session read and do ordinary work", async () => {
		expect((await browser.me()).status).toBe(200);
		expect((await browser.fetch(`${M}/emails?folder=inbox`)).status).toBe(200);
		expect((await put(M, settings(""))).status).toBe(200);
	});

	it.each([
		["creating a key", "POST", "/api/v1/keys", { name: "k", access: "read", mailboxes: [MAILBOX] }],
		["changing a member", "PUT", `${M}/members/someone`, { role: "reader" }],
		["removing a member", "DELETE", `${M}/members/someone`, undefined],
		["deleting the mailbox", "DELETE", M, undefined],
		["turning forwarding on", "PUT", M, settings("elsewhere@outside.test")],
	] as const)("refuses %s", async (_what, method, path, body) => {
		const res = await browser.fetch(path, {
			method,
			body: body === undefined ? undefined : JSON.stringify(body),
		});
		expect(res.status).toBe(403);
		expect(await res.json()).toEqual(NOT_FRESH);
	});

	it("left everything as it was", async () => {
		const mailbox = await json<{ settings: { forwarding: { enabled: boolean } } }>(
			await browser.fetch(M),
		);
		expect(mailbox.settings.forwarding.enabled).toBe(false);
		const keys = await json<unknown[]>(await browser.fetch("/api/v1/keys"));
		expect(keys).toEqual([]);
	});

	it.each([
		["enabling the authenticator app", "/two-factor/enable", { password: PASSWORD }],
		["turning it off", "/two-factor/disable", { password: PASSWORD }],
		["new recovery codes", "/two-factor/generate-backup-codes", { password: PASSWORD }],
		["reading the app's secret again", "/two-factor/get-totp-uri", { password: PASSWORD }],
		["removing a passkey", "/passkey/delete-passkey", { id: "any" }],
		[
			"changing the password",
			"/change-password",
			{ currentPassword: PASSWORD, newPassword: `${PASSWORD}!` },
		],
		["ending other sessions", "/revoke-other-sessions", {}],
	] as const)("refuses %s", async (_what, path, body) => {
		const res = await browser.post(`${AUTH}${path}`, body);
		expect(res.status).toBe(403);
		expect((await json<{ code: string }>(res)).code).toBe("SESSION_NOT_FRESH");
	});

	it("refuses registering a passkey", async () => {
		const res = await browser.fetch(`${AUTH}/passkey/generate-register-options`);
		expect(res.status).toBe(403);
		expect((await json<{ code: string }>(res)).code).toBe("SESSION_NOT_FRESH");
	});

	it("tells an older session nothing about a mailbox it may not manage", async () => {
		const outsider = await signedIn("outsider@example.com");
		await ageSessions(ids.outsider ?? "", 11);
		outsider.forget("session_data");
		const res = await outsider.fetch(M, { method: "DELETE" });
		expect(res.status).toBe(404);
	});

	it("is given by signing in again, which replaces the session", async () => {
		const before = browser.cookie;
		const count = await sessionsOf(ids.stale ?? "");
		expect((await browser.signIn("stale@example.com")).status).toBe(200);
		expect(await sessionsOf(ids.stale ?? "")).toBe(count);

		const old = new Browser();
		for (const pair of before.split("; ")) {
			const at = pair.indexOf("=");
			if (!pair.includes("session_data")) old.jar.set(pair.slice(0, at), pair.slice(at + 1));
		}
		expect((await old.me()).status).toBe(401);

		const key = await browser.post("/api/v1/keys", {
			name: "after signing in again",
			access: "read",
			mailboxes: [MAILBOX],
		});
		expect(key.status).toBe(201);
		expect((await put(M, settings("elsewhere@outside.test"))).status).toBe(200);
	});
});
