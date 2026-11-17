/**
 * Helpers for the Workers-runtime tests: a migrated index, seeded people and signed-in requests.
 *
 * People other than the first owner are seeded directly, because accounts are created by
 * invitation and the invitation routes are a later slice. The first owner always goes through
 * the real guarded setup call.
 */
import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { expect } from "vitest";
import type { InstanceRole, MailboxRole } from "../../workers/auth/authorize.ts";
import { authFor } from "../../workers/auth/instance.ts";
import { createPasskey, type SoftwarePasskey, totpCode } from "../helpers/authenticator.ts";

export const ORIGIN = "https://podbay.test";
export const PASSWORD = "correct horse battery staple";

interface TestEnv {
	DB: D1Database;
	TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1];
	SETUP_TOKEN: string;
	AUTH_SECRET: string;
}
export const testEnv = env as unknown as TestEnv;

export async function migrate(): Promise<void> {
	await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
}

/** A request from the app's own origin, as the browser sends it. */
export function request(
	path: string,
	init: RequestInit & { cookie?: string } = {},
): Promise<Response> {
	const headers = new Headers(init.headers);
	if (!headers.has("origin")) headers.set("origin", ORIGIN);
	if (init.cookie) headers.set("cookie", init.cookie);
	if (init.body !== undefined && !headers.has("content-type")) {
		headers.set("content-type", "application/json");
	}
	return SELF.fetch(`${ORIGIN}${path}`, { ...init, headers });
}

export async function setupOwner(email = "owner@example.com"): Promise<Response> {
	return request("/api/setup/owner", {
		method: "POST",
		body: JSON.stringify({
			token: testEnv.SETUP_TOKEN,
			name: "Olivia Owner",
			email,
			password: PASSWORD,
		}),
	});
}

/** Create an account on the server and admit it to the instance with a role. Returns its id. */
export async function seedUser(email: string, role: InstanceRole, name = email): Promise<string> {
	const auth = authFor(testEnv, new Request(`${ORIGIN}/`));
	const created = await auth.api.signUpEmail({ body: { name, email, password: PASSWORD } });
	await testEnv.DB.prepare(
		`insert into "instance_roles" ("user_id", "role", "created_at") values (?1, ?2, ?3)`,
	)
		.bind(created.user.id, role, new Date().toISOString())
		.run();
	return created.user.id;
}

export async function seedMembership(
	address: string,
	userId: string,
	role: MailboxRole,
): Promise<void> {
	await testEnv.DB.prepare(
		`insert into "memberships" ("mailbox_id", "user_id", "role", "created_at")
		 select "id", ?2, ?3, ?4 from "mailboxes" where "address" = ?1`,
	)
		.bind(address, userId, role, new Date().toISOString())
		.run();
}

/** Sign in over HTTP and return the Cookie header for later requests. */
export async function signIn(email: string, password = PASSWORD): Promise<string> {
	const res = await request("/api/auth/sign-in/email", {
		method: "POST",
		body: JSON.stringify({ email, password }),
	});
	expect(res.status, `sign-in of ${email}`).toBe(200);
	const cookies = res.headers.getSetCookie().map((c) => c.split(";")[0]);
	expect(cookies.length).toBeGreaterThan(0);
	return cookies.join("; ");
}

/**
 * A browser, as far as cookies go: it keeps what a response sets and sends it back. Every
 * browser has its own client address, so the per-address limits of the sign-in endpoints do not
 * couple one test to another.
 */
export class Browser {
	private static next = 0;
	readonly jar = new Map<string, string>();
	readonly address: string;

	constructor() {
		Browser.next += 1;
		this.address = `203.0.113.${(Browser.next % 250) + 1}`;
	}

	get cookie(): string {
		return [...this.jar].map(([name, value]) => `${name}=${value}`).join("; ");
	}

	/** Drop the cookies whose name contains `part` (for example the cached copy of the session). */
	forget(part: string): void {
		for (const name of [...this.jar.keys()]) if (name.includes(part)) this.jar.delete(name);
	}

	async fetch(path: string, init: RequestInit = {}): Promise<Response> {
		const headers = new Headers(init.headers);
		headers.set("cf-connecting-ip", this.address);
		const res = await request(path, { ...init, headers, cookie: this.cookie || undefined });
		for (const line of res.headers.getSetCookie()) {
			const [pair = "", ...attributes] = line.split(";");
			const at = pair.indexOf("=");
			const name = pair.slice(0, at).trim();
			const value = pair.slice(at + 1);
			const gone = value === "" || attributes.some((a) => /^\s*max-age=0\s*$/i.test(a));
			if (gone) this.jar.delete(name);
			else this.jar.set(name, value);
		}
		return res;
	}

	post(path: string, body: unknown = {}): Promise<Response> {
		return this.fetch(path, { method: "POST", body: JSON.stringify(body) });
	}

	/** Password sign-in. Returns the response: with a second step it holds no session yet. */
	signIn(email: string, password = PASSWORD): Promise<Response> {
		return this.post("/api/auth/sign-in/email", { email, password });
	}

	async me(): Promise<{ status: number; id?: string; email?: string }> {
		const res = await this.fetch("/api/v1/me");
		if (res.status !== 200) return { status: res.status };
		const body = (await res.json()) as { user: { id: string; email: string } };
		return { status: 200, id: body.user.id, email: body.user.email };
	}
}

/** Make every session of a person look as if it was created `minutes` ago. */
export async function ageSessions(userId: string, minutes: number): Promise<void> {
	await testEnv.DB.prepare(`update "session" set "createdAt" = ?1 where "userId" = ?2`)
		.bind(new Date(Date.now() - minutes * 60_000).toISOString(), userId)
		.run();
}

export async function createMailbox(
	cookie: string,
	email: string,
	extra: Record<string, unknown> = {},
): Promise<Response> {
	return request("/api/v1/mailboxes", {
		method: "POST",
		cookie,
		body: JSON.stringify({ email, name: email.split("@")[0], ...extra }),
	});
}

export function mime(headers: Record<string, string>, body = "Hello"): string {
	const lines = Object.entries({
		"MIME-Version": "1.0",
		"Content-Type": "text/plain; charset=utf-8",
		...headers,
	}).map(([key, value]) => `${key}: ${value}`);
	return `${lines.join("\r\n")}\r\n\r\n${body}\r\n`;
}

export function inbound(to: string, raw: string) {
	const bytes = new TextEncoder().encode(raw);
	const rejections: string[] = [];
	const message = {
		from: "ada@sender.test",
		to,
		headers: new Headers(),
		raw: new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(bytes);
				controller.close();
			},
		}),
		rawSize: bytes.length,
		setReject(reason: string) {
			rejections.push(reason);
		},
		async forward() {
			throw new Error("forward is not used");
		},
		async reply() {
			throw new Error("reply is not used");
		},
	};
	return { message: message as unknown as ForwardableEmailMessage, rejections };
}

// ── the second step and passkeys, as a person's browser and devices do them ──

export const AUTH = "/api/auth";

export async function json<T>(res: Response): Promise<T> {
	return (await res.json()) as T;
}

/** Enable the authenticator app for a signed-in browser. Returns what the person keeps. */
export async function enableApp(browser: Browser): Promise<{ uri: string; codes: string[] }> {
	const enabled = await browser.post(`${AUTH}/two-factor/enable`, { password: PASSWORD });
	expect(enabled.status).toBe(200);
	const { totpURI, backupCodes } = await json<{ totpURI: string; backupCodes: string[] }>(enabled);
	const confirmed = await browser.post(`${AUTH}/two-factor/verify-totp`, {
		code: await totpCode(totpURI),
	});
	expect(confirmed.status).toBe(200);
	return { uri: totpURI, codes: backupCodes };
}

export async function registerPasskey(browser: Browser, name = "Laptop"): Promise<SoftwarePasskey> {
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
export async function passkeySignIn(
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
