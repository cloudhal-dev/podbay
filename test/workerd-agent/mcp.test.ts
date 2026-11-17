/**
 * Tier 3, with MCP switched on: the MCP endpoint end to end (rules S1 and S9).
 *
 * - a request needs a key; a browser session is not enough;
 * - a key reaches only the mailboxes it was made for, and only while its owner is a member;
 * - a read-only key, and the key of a reader, change nothing;
 * - no tool sends, and a draft is all a client can leave behind;
 * - a revoked or expired key stops working at once, and a key is stored only as a digest.
 *
 * No test here calls a model.
 */

import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { MCP_TOOLS, type McpToolName } from "../../shared/mcp-tools.ts";
import { MCP_TOOL_NAMES } from "../../workers/mcp/server.ts";
import {
	createMailbox,
	migrate,
	ORIGIN,
	request,
	seedMembership,
	seedUser,
	setupOwner,
	signIn,
	testEnv,
} from "../workerd/helpers.ts";

const TEAM = "team@example.com";
const PRIVATE = "private@example.com";
const cookies: Record<string, string> = {};
const userIds: Record<string, string> = {};

interface ToolAnswer {
	isError: boolean;
	value: unknown;
	text: string;
}

/** One JSON-RPC call to the MCP endpoint. Returns the HTTP status and the JSON-RPC result. */
async function rpc(token: string | null, method: string, params: Record<string, unknown> = {}) {
	const headers: Record<string, string> = {
		"content-type": "application/json",
		accept: "application/json, text/event-stream",
	};
	if (token !== null) headers.authorization = `Bearer ${token}`;
	const res = await SELF.fetch(`${ORIGIN}/mcp`, {
		method: "POST",
		headers,
		body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
	});
	const text = await res.text();
	// The answer is JSON, or one JSON message in an event stream.
	const payload = text.startsWith("{")
		? text
		: (text
				.split("\n")
				.filter((line) => line.startsWith("data:"))
				.map((line) => line.slice(5).trim())
				.pop() ?? "");
	const body =
		payload === "" ? null : (JSON.parse(payload) as { result?: unknown; error?: unknown });
	return { status: res.status, headers: res.headers, body };
}

async function tool(
	token: string,
	name: string,
	args: Record<string, unknown> = {},
): Promise<ToolAnswer> {
	const { status, body } = await rpc(token, "tools/call", { name, arguments: args });
	expect(status, `${name} HTTP status`).toBe(200);
	const result = body?.result as { content: { text: string }[]; isError?: boolean };
	const text = result.content[0]?.text ?? "";
	return { isError: result.isError === true, value: JSON.parse(text), text };
}

async function newKey(
	who: string,
	mailboxes: string[],
	access: "read" | "write",
	extra: Record<string, unknown> = {},
) {
	const res = await request("/api/v1/keys", {
		method: "POST",
		cookie: cookies[who],
		body: JSON.stringify({ name: `${who} ${access}`, access, mailboxes, ...extra }),
	});
	return {
		status: res.status,
		body: (await res.json()) as { id: string; token: string; endpoint: string },
	};
}

async function folder(mailbox: string, name: string): Promise<{ subject: string }[]> {
	const res = await request(
		`/api/v1/mailboxes/${encodeURIComponent(mailbox)}/emails?folder=${name}`,
		{
			cookie: cookies.owner,
		},
	);
	return ((await res.json()) as { emails: { subject: string }[] }).emails;
}

beforeAll(async () => {
	await migrate();
	expect((await setupOwner()).status).toBe(201);
	cookies.owner = await signIn("owner@example.com");
	expect((await createMailbox(cookies.owner ?? "", TEAM)).status).toBe(201);
	expect((await createMailbox(cookies.owner ?? "", PRIVATE)).status).toBe(201);

	userIds.admin = await seedUser("admin@example.com", "admin");
	userIds.reader = await seedUser("reader@example.com", "member");
	userIds.sender = await seedUser("sender@example.com", "member");
	await seedMembership(TEAM, userIds.reader ?? "", "reader");
	await seedMembership(TEAM, userIds.sender ?? "", "sender");
	for (const who of ["admin", "reader", "sender"])
		cookies[who] = await signIn(`${who}@example.com`);
});

describe("the MCP endpoint needs a key", () => {
	it("refuses a request without one, and says which scheme it wants", async () => {
		const res = await rpc(null, "tools/list");
		expect(res.status).toBe(401);
		expect(res.headers.get("www-authenticate")).toContain("Bearer");
	});

	it("refuses a key that does not exist and a value that is not a key", async () => {
		expect(
			(await rpc("pbk_not-a-real-key-not-a-real-key-not-a-real-key", "tools/list")).status,
		).toBe(401);
		expect((await rpc("anything", "tools/list")).status).toBe(401);
	});

	it("answers with the security headers and is never cached, key or no key", async () => {
		const key = await newKey("owner", [TEAM], "read");
		for (const res of [await rpc(null, "tools/list"), await rpc(key.body.token, "tools/list")]) {
			expect(res.headers.get("cache-control")).toBe("no-store");
			expect(res.headers.get("x-content-type-options")).toBe("nosniff");
			expect(res.headers.get("access-control-allow-origin")).toBeNull();
		}
	});

	it("does not accept a browser session instead", async () => {
		const res = await SELF.fetch(`${ORIGIN}/mcp`, {
			method: "POST",
			headers: {
				cookie: cookies.owner ?? "",
				origin: ORIGIN,
				"content-type": "application/json",
				accept: "application/json, text/event-stream",
			},
			body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
		});
		expect(res.status).toBe(401);
	});
});

describe("making a key", () => {
	it("gives the token once, with the endpoint, and stores only a digest", async () => {
		const created = await newKey("owner", [TEAM], "write");
		expect(created.status).toBe(201);
		expect(created.body.token).toMatch(/^pbk_[A-Za-z0-9_-]{40,}$/);
		expect(created.body.endpoint).toBe(`${ORIGIN}/mcp`);

		const rows =
			await testEnv.DB.prepare(`select * from "api_keys"`).all<Record<string, unknown>>();
		expect(JSON.stringify(rows.results)).not.toContain(created.body.token);
		const listed = await (await request("/api/v1/keys", { cookie: cookies.owner })).text();
		expect(listed).not.toContain(created.body.token);
		expect(listed).toContain(created.body.token.slice(-4));
	});

	it("is refused for a mailbox the person is not a member of, whatever their role", async () => {
		expect((await newKey("sender", [PRIVATE], "read")).status).toBe(400);
		expect((await newKey("sender", [TEAM, PRIVATE], "read")).status).toBe(400);
		expect((await newKey("admin", [TEAM], "read")).status).toBe(400);
		expect((await newKey("sender", ["ghost@example.com"], "read")).status).toBe(400);
	});

	it("refuses a malformed request", async () => {
		expect((await newKey("owner", [], "read")).status).toBe(400);
		expect((await newKey("owner", [TEAM], "read", { access: "admin" })).status).toBe(400);
	});

	it("lets a person revoke only their own key", async () => {
		const mine = await newKey("sender", [TEAM], "read");
		const other = await request(`/api/v1/keys/${mine.body.id}`, {
			method: "DELETE",
			cookie: cookies.reader,
		});
		expect(other.status).toBe(404);
		expect((await rpc(mine.body.token, "tools/list")).status).toBe(200);
	});
});

describe("the tools", () => {
	it("are exactly the listed ones, and none of them sends, forwards or deletes for good", async () => {
		const key = await newKey("owner", [TEAM], "read");
		const { status, body } = await rpc(key.body.token, "tools/list");
		expect(status).toBe(200);
		const listed = (body?.result ?? { tools: [] }) as { tools: { name: string }[] };
		const names = listed.tools.map((t) => t.name).sort();
		expect(names).toEqual([...MCP_TOOL_NAMES].sort());
		expect(names.filter((n) => /send|forward|delete/.test(n))).toEqual([]);
	});
});

describe("a key reaches only what it was made for", () => {
	let scoped: string;

	beforeAll(async () => {
		scoped = (await newKey("owner", [TEAM], "write")).body.token;
	});

	it("lists only its own mailboxes", async () => {
		const answer = await tool(scoped, "list_mailboxes");
		expect(answer.value).toEqual([{ id: TEAM, email: TEAM, canChange: true }]);
	});

	it("gives the same answer for a mailbox outside its scope and one that does not exist", async () => {
		const outside = await tool(scoped, "list_emails", { mailboxId: PRIVATE });
		const missing = await tool(scoped, "list_emails", { mailboxId: "ghost@example.com" });
		const crafted = await tool(scoped, "list_emails", { mailboxId: "../team@example.com" });
		expect(outside.isError).toBe(true);
		expect(outside.text).toBe(missing.text);
		expect(crafted.text).toBe(missing.text);
		expect(outside.text).not.toContain(PRIVATE);
	});

	it("cannot change a mailbox outside its scope either", async () => {
		const answer = await tool(scoped, "create_draft", {
			mailboxId: PRIVATE,
			to: "someone@elsewhere.test",
			subject: "Hello",
			bodyHtml: "<p>Hi</p>",
		});
		expect(answer.isError).toBe(true);
		expect(await folder(PRIVATE, "draft")).toEqual([]);
	});
});

describe("a key never does more than its access and its owner's membership allow", () => {
	const draft = (mailbox: string) => ({
		mailboxId: mailbox,
		to: "someone@elsewhere.test",
		subject: "From an AI client",
		bodyHtml: "<p>Hello</p>",
	});

	it("a read-only key reads and changes nothing", async () => {
		const key = (await newKey("sender", [TEAM], "read")).body.token;
		expect((await tool(key, "list_emails", { mailboxId: TEAM })).isError).toBe(false);
		expect((await tool(key, "list_mailboxes")).value).toEqual([
			{ id: TEAM, email: TEAM, canChange: false },
		]);
		const refused = await tool(key, "create_draft", draft(TEAM));
		expect(refused.isError).toBe(true);
		expect(refused.text).toContain("not change");
		expect(await folder(TEAM, "draft")).toEqual([]);
	});

	it("a reader's key changes nothing, even when made with write access", async () => {
		const key = (await newKey("reader", [TEAM], "write")).body.token;
		expect((await tool(key, "list_emails", { mailboxId: TEAM })).isError).toBe(false);
		expect((await tool(key, "create_draft", draft(TEAM))).isError).toBe(true);
		expect((await tool(key, "move_to_trash", { mailboxId: TEAM, emailId: "x" })).isError).toBe(
			true,
		);
		expect(await folder(TEAM, "draft")).toEqual([]);
	});

	it("a sender's write key saves a draft, and nothing is sent", async () => {
		const key = (await newKey("sender", [TEAM], "write")).body.token;
		const saved = await tool(key, "create_draft", draft(TEAM));
		expect(saved.isError).toBe(false);
		expect(saved.text).toContain("Nothing was sent");

		expect((await folder(TEAM, "draft")).map((m) => m.subject)).toEqual(["From an AI client"]);
		expect(await folder(TEAM, "sent")).toEqual([]);
	});

	it("cannot make a message look sent", async () => {
		const key = (await newKey("sender", [TEAM], "write")).body.token;
		const drafts = (await tool(key, "list_emails", { mailboxId: TEAM, folder: "draft" })).value as {
			id: string;
		}[];
		const moved = await tool(key, "move_email", {
			mailboxId: TEAM,
			emailId: drafts[0]?.id,
			folderId: "sent",
		});
		expect(moved.isError).toBe(true);
		expect(await folder(TEAM, "sent")).toEqual([]);
	});
});

describe("the shared tool list and the server agree on what changes a mailbox", () => {
	const draftFields = { to: "someone@elsewhere.test", subject: "S", bodyHtml: "<p>B</p>" };
	const ARGUMENTS: Record<McpToolName, Record<string, unknown>> = {
		list_mailboxes: {},
		list_emails: { mailboxId: TEAM },
		get_email: { mailboxId: TEAM, emailId: "none" },
		get_thread: { mailboxId: TEAM, threadId: "none" },
		search_emails: { mailboxId: TEAM, query: "nothing" },
		draft_reply: { mailboxId: TEAM, originalEmailId: "none", ...draftFields },
		create_draft: { mailboxId: TEAM, ...draftFields },
		update_draft: { mailboxId: TEAM, draftId: "none", subject: "S" },
		mark_email_read: { mailboxId: TEAM, emailId: "none", read: true },
		move_email: { mailboxId: TEAM, emailId: "none", folderId: "archive" },
		move_to_trash: { mailboxId: TEAM, emailId: "none" },
	};
	let readOnly: string;

	beforeAll(async () => {
		readOnly = (await newKey("owner", [TEAM], "read")).body.token;
	});

	it.each(MCP_TOOLS.filter((t) => t.changes))("a read-only key is refused by $name", async (t) => {
		const refused = await tool(readOnly, t.name, ARGUMENTS[t.name]);
		expect(refused.isError).toBe(true);
		expect(refused.text).toContain("not change");
	});

	it.each(MCP_TOOLS.filter((t) => !t.changes))(
		"a read-only key is not refused by $name",
		async (t) => {
			const served = await tool(readOnly, t.name, ARGUMENTS[t.name]);
			expect(served.text).not.toContain("not change");
			expect(served.text).not.toContain("No such mailbox");
		},
	);
});

describe("a key stops working when what it was made from goes away", () => {
	it("at once when its owner loses the membership", async () => {
		const key = (await newKey("sender", [TEAM], "write")).body.token;
		expect((await tool(key, "list_emails", { mailboxId: TEAM })).isError).toBe(false);

		const removed = await request(
			`/api/v1/mailboxes/${encodeURIComponent(TEAM)}/members/${userIds.sender}`,
			{
				method: "DELETE",
				cookie: cookies.owner,
			},
		);
		expect(removed.status).toBe(204);

		expect((await tool(key, "list_mailboxes")).value).toEqual([]);
		expect((await tool(key, "list_emails", { mailboxId: TEAM })).isError).toBe(true);
	});

	it("when it is revoked", async () => {
		const key = await newKey("owner", [TEAM], "read");
		expect((await rpc(key.body.token, "tools/list")).status).toBe(200);
		const revoked = await request(`/api/v1/keys/${key.body.id}`, {
			method: "DELETE",
			cookie: cookies.owner,
		});
		expect(revoked.status).toBe(204);
		expect((await rpc(key.body.token, "tools/list")).status).toBe(401);
	});

	it("when it expires", async () => {
		const key = await newKey("owner", [TEAM], "read", { expiresInDays: 1 });
		expect((await rpc(key.body.token, "tools/list")).status).toBe(200);
		await testEnv.DB.prepare(`update "api_keys" set "expires_at" = ?1 where "id" = ?2`)
			.bind(new Date(Date.now() - 1000).toISOString(), key.body.id)
			.run();
		expect((await rpc(key.body.token, "tools/list")).status).toBe(401);
	});

	it("when the mailbox is deleted", async () => {
		const key = (await newKey("owner", [PRIVATE], "read")).body.token;
		expect((await tool(key, "list_mailboxes")).value).toEqual([
			{ id: PRIVATE, email: PRIVATE, canChange: false },
		]);
		const deleted = await request(`/api/v1/mailboxes/${encodeURIComponent(PRIVATE)}`, {
			method: "DELETE",
			cookie: cookies.owner,
		});
		expect(deleted.status).toBe(204);
		expect((await tool(key, "list_mailboxes")).value).toEqual([]);
	});
});
