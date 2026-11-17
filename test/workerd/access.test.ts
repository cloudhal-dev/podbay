/**
 * Tier 3: sign-in and access, through the real guard, Better Auth on a real (local) D1 database
 * and real Durable Objects. This is the regression suite for rules S1, S10, S11 and S13.
 *
 * - a new instance is closed until the guarded first-owner call, which works once;
 * - accounts cannot be created over HTTP;
 * - every registered API route is in the route table, and the table names no missing route;
 * - a person who is not a member gets 404 on every mailbox route, whatever their instance role;
 * - a reader reads and nothing else; a sender cannot manage;
 * - a request that changes state from another origin is refused;
 * - deleting a mailbox deletes its mail and its attachments.
 */
import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { SECURITY_HEADERS } from "../../shared/security-headers.ts";
import worker from "../../workers/app.ts";
import { ROUTE_TABLE } from "../../workers/auth/route-table.ts";
import { app as api } from "../../workers/index.ts";
import {
	createMailbox,
	inbound,
	migrate,
	mime,
	ORIGIN,
	PASSWORD,
	request,
	seedMembership,
	seedUser,
	setupOwner,
	signIn,
	testEnv,
} from "./helpers.ts";

const MAILBOX = "team@example.com";
const cookies: Record<string, string> = {};

function concrete(path: string): string {
	return path
		.replace(":mailboxId", encodeURIComponent(MAILBOX))
		.replace(":emailId", "e-1")
		.replace(":attachmentId", "a-1")
		.replace(":threadId", "t-1")
		.replace(":userId", "user-1")
		.replace(":id", "x-1");
}

const mailboxRoutes = ROUTE_TABLE.filter((r) => r.path.includes(":mailboxId")).map(
	(r) => [r.method, concrete(r.path), r.right] as const,
);

async function deliver(to: string, raw: string) {
	const { message, rejections } = inbound(to, raw);
	const ctx = createExecutionContext();
	await worker.email(message, env, ctx);
	await waitOnExecutionContext(ctx);
	return rejections;
}

describe("a new instance is closed", () => {
	beforeAll(migrate);

	it("says it needs setup and refuses everything else", async () => {
		const status = await request("/api/setup/status");
		expect(await status.json()).toEqual({ needsSetup: true });
		for (const path of ["/api/v1/me", "/api/v1/config", "/api/v1/mailboxes"]) {
			expect((await request(path)).status, path).toBe(401);
		}
	});

	it("refuses the first-owner call without the setup token", async () => {
		const body = { name: "Mallory", email: "mallory@example.com", password: PASSWORD };
		const wrong = await request("/api/setup/owner", {
			method: "POST",
			body: JSON.stringify({ ...body, token: "not-the-token-not-the-token-xx" }),
		});
		expect(wrong.status).toBe(403);
		const missing = await request("/api/setup/owner", {
			method: "POST",
			body: JSON.stringify(body),
		});
		expect(missing.status).toBe(400);
		expect(await (await request("/api/setup/status")).json()).toEqual({ needsSetup: true });
	});

	it("refuses a weak password and a call from another origin, even with the token", async () => {
		const base = { token: testEnv.SETUP_TOKEN, name: "Olivia", email: "owner@example.com" };
		const weak = await request("/api/setup/owner", {
			method: "POST",
			body: JSON.stringify({ ...base, password: "short" }),
		});
		expect(weak.status).toBe(400);
		const foreign = await request("/api/setup/owner", {
			method: "POST",
			headers: { origin: "https://evil.test" },
			body: JSON.stringify({ ...base, password: PASSWORD }),
		});
		expect(foreign.status).toBe(403);
	});

	it("creates the first owner once", async () => {
		expect((await setupOwner()).status).toBe(201);
		expect(await (await request("/api/setup/status")).json()).toEqual({ needsSetup: false });
		expect((await setupOwner("second@example.com")).status).toBe(409);
	});

	it("records the setup in the audit log", async () => {
		const row = await testEnv.DB.prepare(
			`select count(*) as "n" from "audit" where "action" = 'setup.owner_created'`,
		).first<{ n: number }>();
		expect(row?.n).toBe(1);
	});
});

describe("sign-in", () => {
	it("cannot create an account over HTTP", async () => {
		const res = await request("/api/auth/sign-up/email", {
			method: "POST",
			body: JSON.stringify({ name: "Mallory", email: "mallory@example.com", password: PASSWORD }),
		});
		expect(res.status).toBe(403);
		const user = await testEnv.DB.prepare(`select count(*) as "n" from "user" where "email" = ?1`)
			.bind("mallory@example.com")
			.first<{ n: number }>();
		expect(user?.n).toBe(0);
	});

	it("refuses a wrong password and gives the owner a session for the right one", async () => {
		const wrong = await request("/api/auth/sign-in/email", {
			method: "POST",
			body: JSON.stringify({ email: "owner@example.com", password: "wrong wrong wrong" }),
		});
		expect(wrong.status).toBe(401);

		cookies.owner = await signIn("owner@example.com");
		const me = await request("/api/v1/me", { cookie: cookies.owner });
		expect(me.status).toBe(200);
		expect(await me.json()).toMatchObject({
			user: { email: "owner@example.com" },
			role: "owner",
			mailboxes: [],
		});
	});

	it("sets a session cookie that scripts cannot read", async () => {
		const res = await request("/api/auth/sign-in/email", {
			method: "POST",
			body: JSON.stringify({ email: "owner@example.com", password: PASSWORD }),
		});
		const session = res.headers.getSetCookie().find((c) => c.includes("session_token"));
		expect(session).toBeDefined();
		expect(session?.toLowerCase()).toContain("httponly");
		expect(session?.toLowerCase()).toContain("secure");
		expect(session?.toLowerCase()).toContain("samesite=lax");
	});

	it("refuses a forged or missing session", async () => {
		expect(
			(await request("/api/v1/me", { cookie: "podbay.session_token=forged.forged" })).status,
		).toBe(401);
		expect((await request("/api/v1/me")).status).toBe(401);
	});

	it("does not admit an account that has no role on this instance", async () => {
		const res = await request("/api/auth/sign-in/email", {
			method: "POST",
			body: JSON.stringify({ email: "second@example.com", password: PASSWORD }),
		});
		// The losing setup call never created this account.
		expect(res.status).toBe(401);
	});
});

describe("the route table covers the API", () => {
	const registered = api.routes
		.filter((r) => r.method !== "ALL" || r.path === "/api/auth/*")
		.filter((r) => r.path.startsWith("/api/"))
		.map((r) => `${r.method} ${r.path}`);
	const table = ROUTE_TABLE.map((r) => `${r.method} ${r.path}`);

	it("lists every registered route", () => {
		expect(registered.filter((r) => !table.includes(r))).toEqual([]);
	});

	it("lists no route that is not registered", () => {
		expect(table.filter((r) => !registered.includes(r))).toEqual([]);
	});

	it("refuses an API path that is not a route at all", async () => {
		expect((await request("/api/v1/everything", { cookie: cookies.owner })).status).toBe(404);
		expect((await request("/api/internal/debug", { cookie: cookies.owner })).status).toBe(404);
	});
});

describe("per-mailbox access", () => {
	beforeAll(async () => {
		const admin = await seedUser("admin@example.com", "admin");
		const reader = await seedUser("reader@example.com", "member");
		const sender = await seedUser("sender@example.com", "member");
		await seedUser("outsider@example.com", "member");
		expect(admin).toBeTruthy();

		// The owner creates the mailbox and owns it.
		expect((await createMailbox(cookies.owner ?? "", MAILBOX)).status).toBe(201);
		await seedMembership(MAILBOX, reader, "reader");
		await seedMembership(MAILBOX, sender, "sender");

		cookies.admin = await signIn("admin@example.com");
		cookies.reader = await signIn("reader@example.com");
		cookies.sender = await signIn("sender@example.com");
		cookies.outsider = await signIn("outsider@example.com");
	});

	it.each(mailboxRoutes)(
		"%s %s answers 404 to a signed-in person who is not a member",
		async (method, path) => {
			const res = await request(path, {
				method,
				cookie: cookies.outsider,
				...(method === "GET" ? {} : { body: "{}" }),
			});
			expect(res.status).toBe(404);
		},
	);

	// Who the members are is the one thing about a mailbox that managing the instance reaches.
	const memberRoutes = mailboxRoutes.filter(([, , right]) => right.startsWith("mailbox.members"));
	const mailRoutes = mailboxRoutes.filter(([, , right]) => !right.startsWith("mailbox.members"));

	it.each(mailRoutes)(
		"%s %s answers 404 to an administrator without a membership (managing is not reading)",
		async (method, path) => {
			const res = await request(path, {
				method,
				cookie: cookies.admin,
				...(method === "GET" ? {} : { body: "{}" }),
			});
			expect(res.status).toBe(404);
		},
	);

	it("leaves an administrator without a membership the member routes, and nothing else", () => {
		expect(
			memberRoutes.map(([method, path]) => `${method} ${path.split("/").slice(5).join("/")}`),
		).toEqual([
			"GET members",
			"GET members/history",
			"POST members",
			"PUT members/user-1",
			"DELETE members/user-1",
		]);
		expect(mailRoutes.length).toBe(mailboxRoutes.length - 5);
	});

	// Removing a member is in test/workerd/members.test.ts: its own answer for nobody to remove
	// is a 404 too, which says nothing about the guard here.
	it.each(memberRoutes.filter(([method]) => method !== "DELETE"))(
		"%s %s is not hidden from an administrator without a membership",
		async (method, path) => {
			const res = await request(path, {
				method,
				cookie: cookies.admin,
				...(method === "GET" ? {} : { body: "{}" }),
			});
			// Past the guard: the handler answers, with a list or with its own refusal of an empty body.
			expect([200, 400]).toContain(res.status);
		},
	);

	it.each(mailboxRoutes)("%s %s answers 401 without a session", async (method, path) => {
		const res = await request(path, { method, ...(method === "GET" ? {} : { body: "{}" }) });
		expect(res.status).toBe(401);
	});

	it("gives the same 404 for a mailbox that does not exist", async () => {
		const res = await request("/api/v1/mailboxes/ghost%40example.com/emails?folder=inbox", {
			cookie: cookies.outsider,
		});
		expect(res.status).toBe(404);
	});

	// A reader reads the mail and sees who the members are; everything else is refused.
	const READER_MAY = ["mailbox.read", "mailbox.members.read"];
	it.each(mailboxRoutes.filter(([, , right]) => !READER_MAY.includes(right)))(
		"%s %s answers 403 to a reader",
		async (method, path) => {
			const res = await request(path, {
				method,
				cookie: cookies.reader,
				...(method === "GET" ? {} : { body: "{}" }),
			});
			expect(res.status).toBe(403);
		},
	);

	it("lets a reader read", async () => {
		const list = await request(
			`/api/v1/mailboxes/${encodeURIComponent(MAILBOX)}/emails?folder=inbox`,
			{
				cookie: cookies.reader,
			},
		);
		expect(list.status).toBe(200);
		const me = (await (await request("/api/v1/me", { cookie: cookies.reader })).json()) as {
			mailboxes: { address: string; role: string }[];
		};
		expect(me.mailboxes).toEqual([{ address: MAILBOX, name: "team", role: "reader" }]);
	});

	const OWNERS_ONLY = ["mailbox.manage", "mailbox.members.manage"];
	it.each(mailboxRoutes.filter(([, , right]) => OWNERS_ONLY.includes(right)))(
		"%s %s answers 403 to a sender",
		async (method, path) => {
			const res = await request(path, {
				method,
				cookie: cookies.sender,
				...(method === "GET" ? {} : { body: "{}" }),
			});
			expect(res.status).toBe(403);
		},
	);

	it("lists only the caller's own mailboxes", async () => {
		const mine = async (who: string) =>
			(
				(await (await request("/api/v1/mailboxes", { cookie: cookies[who] })).json()) as {
					id: string;
				}[]
			).map((m) => m.id);
		expect(await mine("owner")).toEqual([MAILBOX]);
		expect(await mine("admin")).toEqual([]);
		expect(await mine("outsider")).toEqual([]);
	});

	it("accepts the address in any casing, and never a crafted one", async () => {
		const upper = await request(
			`/api/v1/mailboxes/${encodeURIComponent("Team@Example.com")}/folders`,
			{
				cookie: cookies.owner,
			},
		);
		expect(upper.status).toBe(200);
		const crafted = await request(
			`/api/v1/mailboxes/${encodeURIComponent("../team@example.com")}/folders`,
			{
				cookie: cookies.owner,
			},
		);
		expect(crafted.status).toBe(404);
	});
});

describe("creating a mailbox", () => {
	it("is refused to an ordinary member", async () => {
		expect((await createMailbox(cookies.outsider ?? "", "mine@example.com")).status).toBe(403);
	});

	it("is refused for a domain the instance does not handle", async () => {
		expect((await createMailbox(cookies.owner ?? "", "hello@elsewhere.test")).status).toBe(400);
	});

	it("is refused for an address that exists, and for a malformed one", async () => {
		expect((await createMailbox(cookies.owner ?? "", MAILBOX)).status).toBe(409);
		expect((await createMailbox(cookies.owner ?? "", "not an address")).status).toBe(400);
	});

	it("lets an administrator create a mailbox for someone else without getting access to it", async () => {
		const outsider = await testEnv.DB.prepare(`select "id" from "user" where "email" = ?1`)
			.bind("outsider@example.com")
			.first<{ id: string }>();
		const created = await createMailbox(cookies.admin ?? "", "personal@example.com", {
			ownerUserId: outsider?.id,
		});
		expect(created.status).toBe(201);

		const path = `/api/v1/mailboxes/${encodeURIComponent("personal@example.com")}/folders`;
		expect((await request(path, { cookie: cookies.outsider })).status).toBe(200);
		expect((await request(path, { cookie: cookies.admin })).status).toBe(404);
	});
});

describe("requests that change state", () => {
	it("are refused from another origin, and without an Origin header", async () => {
		const path = `/api/v1/mailboxes/${encodeURIComponent(MAILBOX)}/folders`;
		const body = JSON.stringify({ name: "From elsewhere" });
		const foreign = await request(path, {
			method: "POST",
			cookie: cookies.owner,
			headers: { origin: "https://evil.test" },
			body,
		});
		expect(foreign.status).toBe(403);
		const res = await SELF_FETCH_WITHOUT_ORIGIN(path, cookies.owner ?? "", body);
		expect(res.status).toBe(403);
	});
});

describe("response headers", () => {
	it.each([
		["a public answer", "/api/setup/status", undefined],
		["a refused answer", "/api/v1/me", undefined],
		["a signed-in answer", "/api/v1/me", "owner"],
		["a path that is no route", "/api/v1/everything", "owner"],
	])("%s carries the security headers and is never cached", async (_name, path, who) => {
		const res = await request(path, who ? { cookie: cookies[who] } : {});
		for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
			expect(res.headers.get(name), name).toBe(value);
		}
		expect(res.headers.get("cache-control")).toBe("no-store");
	});
});

describe("deleting a mailbox", () => {
	const DOOMED = "doomed@example.com";

	it("deletes its mail, its attachments and its index row", async () => {
		expect((await createMailbox(cookies.owner ?? "", DOOMED)).status).toBe(201);
		const boundary = "b-1";
		const raw = [
			"From: ada@sender.test",
			`To: ${DOOMED}`,
			"Subject: With a file",
			"Message-ID: <doomed-1@sender.test>",
			"MIME-Version: 1.0",
			`Content-Type: multipart/mixed; boundary="${boundary}"`,
			"",
			`--${boundary}`,
			"Content-Type: text/plain; charset=utf-8",
			"",
			"See attached.",
			`--${boundary}`,
			'Content-Type: text/plain; name="note.txt"',
			'Content-Disposition: attachment; filename="note.txt"',
			"",
			"the attachment",
			`--${boundary}--`,
			"",
		].join("\r\n");
		expect(await deliver(DOOMED, raw)).toEqual([]);

		const before = await env.BUCKET.list({ prefix: "attachments/" });
		const mine = before.objects.filter((o) => o.key.endsWith("/note.txt"));
		expect(mine.length).toBe(1);

		const path = `/api/v1/mailboxes/${encodeURIComponent(DOOMED)}`;
		expect((await request(path, { method: "DELETE", cookie: cookies.owner })).status).toBe(204);

		const after = await env.BUCKET.list({ prefix: "attachments/" });
		expect(after.objects.filter((o) => o.key.endsWith("/note.txt"))).toEqual([]);
		expect((await request(path, { cookie: cookies.owner })).status).toBe(404);
		const row = await testEnv.DB.prepare(
			`select count(*) as "n" from "mailboxes" where "address" = ?1`,
		)
			.bind(DOOMED)
			.first<{ n: number }>();
		expect(row?.n).toBe(0);
		const memberships = await testEnv.DB.prepare(
			`select count(*) as "n" from "memberships" s where not exists (select 1 from "mailboxes" m where m."id" = s."mailbox_id")`,
		).first<{ n: number }>();
		expect(memberships?.n).toBe(0);

		// Mail for the address is refused again.
		expect(await deliver(DOOMED, mime({ From: "ada@sender.test", Subject: "Too late" }))).toEqual([
			"Unknown recipient",
		]);

		// A new mailbox at the same address starts empty: the old mail is really gone.
		expect((await createMailbox(cookies.owner ?? "", DOOMED)).status).toBe(201);
		const inbox = (await (
			await request(`${path}/emails?folder=inbox`, { cookie: cookies.owner })
		).json()) as { emails: unknown[] };
		expect(inbox.emails).toEqual([]);
	});
});

/** `request` always sets Origin; this one leaves it out, as a non-browser client would. */
async function SELF_FETCH_WITHOUT_ORIGIN(
	path: string,
	cookie: string,
	body: string,
): Promise<Response> {
	const { SELF } = await import("cloudflare:test");
	return SELF.fetch(`${ORIGIN}${path}`, {
		method: "POST",
		headers: { cookie, "content-type": "application/json" },
		body,
	});
}
