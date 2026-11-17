/**
 * Tier 3: a person's sessions and password (rule S10).
 *
 * - a person sees their own sessions, and only with fresh proof;
 * - ending one session ends that one: the browser that held it is signed out, the others are
 *   not, and nobody ends a session that is not theirs;
 * - changing the password needs the current one and fresh proof, ends every other session and
 *   keeps the browser that made the change signed in; the old password no longer works.
 */
import { beforeAll, describe, expect, it } from "vitest";
import {
	AUTH,
	ageSessions,
	Browser,
	json,
	migrate,
	PASSWORD,
	seedUser,
	setupOwner,
} from "./helpers.ts";

interface SessionRow {
	id: string;
	token: string;
	ipAddress?: string | null;
	userAgent?: string | null;
	createdAt: string;
}

const ids: Record<string, string> = {};

async function signedIn(email: string, password = PASSWORD, agent = "Test/1.0"): Promise<Browser> {
	const browser = new Browser();
	const res = await browser.fetch(`${AUTH}/sign-in/email`, {
		method: "POST",
		headers: { "user-agent": agent },
		body: JSON.stringify({ email, password }),
	});
	expect(res.status).toBe(200);
	return browser;
}

/** Whether a browser is still signed in, asked without the minute-long copy in its cookie. */
async function stillIn(browser: Browser): Promise<boolean> {
	browser.forget("session_data");
	return (await browser.me()).status === 200;
}

const list = async (browser: Browser) =>
	json<SessionRow[]>(await browser.fetch(`${AUTH}/list-sessions`));

beforeAll(async () => {
	await migrate();
	expect((await setupOwner()).status).toBe(201);
	for (const who of ["ada", "grace", "pat", "stale"]) {
		ids[who] = await seedUser(`${who}@example.com`, "member");
	}
});

describe("a person's sessions", () => {
	it("are listed for the person themself, each with where it came from", async () => {
		const laptop = await signedIn("ada@example.com", PASSWORD, "Laptop/1.0");
		const phone = await signedIn("ada@example.com", PASSWORD, "Phone/2.0");
		const other = await signedIn("grace@example.com");

		const sessions = await list(laptop);
		expect(sessions.map((s) => s.userAgent).sort()).toEqual(["Laptop/1.0", "Phone/2.0"]);
		expect(sessions.map((s) => s.ipAddress).sort()).toEqual([laptop.address, phone.address].sort());
		// Another person's list holds nothing of these.
		expect((await list(other)).map((s) => s.userAgent)).toEqual(["Test/1.0"]);
	});

	it("are shown only with fresh proof", async () => {
		const browser = await signedIn("stale@example.com");
		await ageSessions(ids.stale ?? "", 11);
		browser.forget("session_data");
		const res = await browser.fetch(`${AUTH}/list-sessions`);
		expect(res.status).toBe(403);
		expect((await json<{ code: string }>(res)).code).toBe("SESSION_NOT_FRESH");
	});

	it("end one at a time: that browser is signed out and the others are not", async () => {
		const laptop = await signedIn("grace@example.com", PASSWORD, "Laptop/1.0");
		const phone = await signedIn("grace@example.com", PASSWORD, "Phone/2.0");
		const target = (await list(laptop)).find((s) => s.userAgent === "Phone/2.0");
		expect(target).toBeDefined();

		const ended = await laptop.post(`${AUTH}/revoke-session`, { token: target?.token });
		expect(ended.status).toBe(200);
		expect(await stillIn(phone)).toBe(false);
		expect(await stillIn(laptop)).toBe(true);
		expect((await list(laptop)).map((s) => s.userAgent)).not.toContain("Phone/2.0");
	});

	it("cannot be ended by someone else", async () => {
		const mine = await signedIn("ada@example.com", PASSWORD, "Mine/1.0");
		const token = (await list(mine)).find((s) => s.userAgent === "Mine/1.0")?.token;
		const stranger = await signedIn("pat@example.com");

		await stranger.post(`${AUTH}/revoke-session`, { token });
		expect(await stillIn(mine)).toBe(true);
	});

	it("end all at once, except the one that asks", async () => {
		const here = await signedIn("pat@example.com", PASSWORD, "Here/1.0");
		const there = await signedIn("pat@example.com", PASSWORD, "There/1.0");
		expect((await here.post(`${AUTH}/revoke-other-sessions`)).status).toBe(200);
		expect(await stillIn(there)).toBe(false);
		expect(await stillIn(here)).toBe(true);
		expect((await list(here)).map((s) => s.userAgent)).toEqual(["Here/1.0"]);
	});
});

describe("changing the password", () => {
	const NEW = "a different horse battery staple";

	it("needs the current password, and a new one that is long enough", async () => {
		const browser = await signedIn("ada@example.com");
		const wrong = await browser.post(`${AUTH}/change-password`, {
			currentPassword: "not the password at all",
			newPassword: NEW,
			revokeOtherSessions: true,
		});
		expect(wrong.status).toBeGreaterThanOrEqual(400);
		const short = await browser.post(`${AUTH}/change-password`, {
			currentPassword: PASSWORD,
			newPassword: "short",
			revokeOtherSessions: true,
		});
		expect(short.status).toBeGreaterThanOrEqual(400);
		// Nothing changed: the old password still signs in.
		expect(await stillIn(await signedIn("ada@example.com"))).toBe(true);
	});

	it("ends every other session, keeps this browser in, and retires the old password", async () => {
		const here = await signedIn("ada@example.com", PASSWORD, "Here/1.0");
		const there = await signedIn("ada@example.com", PASSWORD, "There/1.0");

		const changed = await here.post(`${AUTH}/change-password`, {
			currentPassword: PASSWORD,
			newPassword: NEW,
			revokeOtherSessions: true,
		});
		expect(changed.status).toBe(200);
		expect(await stillIn(here)).toBe(true);
		expect(await stillIn(there)).toBe(false);
		expect(await list(here)).toHaveLength(1);

		const old = new Browser();
		expect((await old.signIn("ada@example.com")).status).toBe(401);
		expect(await stillIn(await signedIn("ada@example.com", NEW))).toBe(true);
	});
});
