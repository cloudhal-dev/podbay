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
