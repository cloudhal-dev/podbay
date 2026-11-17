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

import { runInDurableObject, SELF } from "cloudflare:test";
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

	it("changes a draft as it was given, and never a message that is not a draft", async () => {
		const key = (await newKey("sender", [TEAM], "write")).body.token;
		// A message in the inbox, put there directly: this test is about the tool.
		await runInDurableObject(
			testEnv.MAILBOX.get(testEnv.MAILBOX.idFromName(TEAM)),
			(_object, state) => {
				state.storage.sql.exec(
					`INSERT INTO emails (id, folder_id, subject, sender, recipient, date, body) VALUES ('kept-in-inbox', 'inbox', 'Kept in the inbox', 'ada@sender.test', ?, ?, 'Hello')`,
					TEAM,
					new Date().toISOString(),
				);
			},
		);

		// Changing a draft replaces it, and replacing deletes: a message that is not a draft is
		// refused and stays where it is.
		const refused = await tool(key, "update_draft", {
			mailboxId: TEAM,
			draftId: "kept-in-inbox",
			subject: "Gone",
		});
		expect(refused.isError).toBe(true);
		expect(refused.text).toContain("not a draft");
		expect((await folder(TEAM, "inbox")).map((m) => m.subject)).toContain("Kept in the inbox");

		// A draft is changed, and saved exactly as given: no model reads it on the way (this
		// configuration has none to ask, and the body is long enough that one would be asked).
		const made = (await tool(key, "create_draft", { ...draft(TEAM), subject: "To be changed" }))
			.value as { draftId: string };
		const body = "<p>A body that is long enough to be worth a second look by a model.</p>";
		const changed = await tool(key, "update_draft", {
			mailboxId: TEAM,
			draftId: made.draftId,
			bodyHtml: body,
		});
		expect(changed.isError).toBe(false);
		const { newDraftId } = changed.value as { newDraftId: string };
		// The draft keeps its id: it is changed in place (ADR-0011).
		expect(newDraftId).toBe(made.draftId);
		const read = (await tool(key, "get_email", { mailboxId: TEAM, emailId: newDraftId })).value as {
			body: string;
			subject: string;
		};
		expect(read.body).toBe(body);
		expect(read.subject).toBe("To be changed");

		// Once a person gave the draft a file, no tool changes it: a tool that could change its
		// recipient would be one click away from sending that file to a stranger.
		const declared = await request(
			`/api/v1/mailboxes/${encodeURIComponent(TEAM)}/drafts/${newDraftId}/attachments`,
			{
				method: "POST",
				cookie: cookies.owner,
				body: JSON.stringify({ filename: "contract.pdf", type: "application/pdf", size: 4 }),
			},
		);
		expect(declared.status).toBe(201);
		const held = await tool(key, "update_draft", {
			mailboxId: TEAM,
			draftId: newDraftId,
			to: "stranger@elsewhere.test",
		});
		expect(held.isError).toBe(true);
		expect(held.text).toContain("holds files");
		const still = (await tool(key, "get_email", { mailboxId: TEAM, emailId: newDraftId }))
			.value as { recipient: string };
		expect(still.recipient).toBe("someone@elsewhere.test");
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
		list_labels: { mailboxId: TEAM },
		label_email: { mailboxId: TEAM, emailId: "none", add: [], remove: [] },
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

describe("labels through a key (ADR-0007)", () => {
	const api = (mailbox: string) => `/api/v1/mailboxes/${encodeURIComponent(mailbox)}`;
	const makeLabel = async (mailbox: string, name: string) => {
		const res = await request(`${api(mailbox)}/labels`, {
			method: "POST",
			cookie: cookies.owner,
			body: JSON.stringify({ name }),
		});
		return ((await res.json()) as { id: string }).id;
	};

	it("a key sees the labels, labels a conversation in its own mailbox, and reaches no other", async () => {
		const mine = await makeLabel(TEAM, "For the team");
		const theirs = await makeLabel(PRIVATE, "Private matter");
		const key = (await newKey("sender", [TEAM], "write")).body.token;
		const saved = await tool(key, "create_draft", {
			mailboxId: TEAM,
			to: "someone@elsewhere.test",
			subject: "To be labelled",
			bodyHtml: "<p>B</p>",
		});
		const emailId = (saved.value as { draftId: string }).draftId;

		const listed = await tool(key, "list_labels", { mailboxId: TEAM });
		expect((listed.value as { name: string }[]).map((label) => label.name)).toEqual([
			"For the team",
		]);
		// A label of a mailbox the key cannot reach is not a label here, and its mailbox is not there.
		expect((await tool(key, "list_labels", { mailboxId: PRIVATE })).isError).toBe(true);
		const foreign = await tool(key, "label_email", { mailboxId: TEAM, emailId, add: [theirs] });
		expect(foreign.isError).toBe(true);
		expect(foreign.text).not.toContain("Private matter");

		const done = await tool(key, "label_email", { mailboxId: TEAM, emailId, add: [mine] });
		expect(done.isError).toBe(false);
		expect(done.value).toMatchObject({ status: "labelled", labels: [mine] });
		const after = await tool(key, "list_labels", { mailboxId: TEAM });
		expect((after.value as { total: number }[])[0]?.total).toBe(1);

		// Something that is not a label id never reaches the database.
		const junk = await tool(key, "label_email", {
			mailboxId: TEAM,
			emailId,
			add: ["inbox' OR 1=1"],
		});
		expect(junk.isError).toBe(true);
	});

	it("no tool makes, renames or deletes a label", () => {
		const names = MCP_TOOLS.map((t) => t.name).filter((name) => name.includes("label"));
		expect(names.sort()).toEqual(["label_email", "list_labels"]);
	});
});

describe("a tool gets nothing of the original (ADR-0015, decision 21)", () => {
	const KEY = "raw/0123456789abcdef0123456789abcdef";
	const STATEMENT = "mx.cloudflare.net; spf=pass; dkim=pass; dmarc=pass";
	const BYTES = "Subject: Kept whole\r\n\r\nTHE-ORIGINAL-BYTES";

	beforeAll(async () => {
		// A received message as an arrival leaves it, with a file: put there directly, because
		// this is about what a tool answers and the assistant must not be woken.
		await runInDurableObject(
			testEnv.MAILBOX.get(testEnv.MAILBOX.idFromName(TEAM)),
			(_object, state) => {
				state.storage.sql.exec(
					`INSERT INTO emails (id, folder_id, subject, sender, recipient, date, body, thread_id,
						raw_headers, raw_key, raw_size, unparsed, auth_results)
					 VALUES ('with-original', 'inbox', 'Kept whole', 'ada@sender.test', ?1, ?2, 'Parsed text',
						'thread-original', '[]', ?3, ?4, NULL, ?5)`,
					TEAM,
					new Date().toISOString(),
					KEY,
					BYTES.length,
					STATEMENT,
				);
				state.storage.sql.exec(
					`INSERT INTO attachments (id, email_id, filename, mimetype, size) VALUES ('file-1', 'with-original', 'a.txt', 'text/plain', 1)`,
				);
			},
		);
		await (testEnv as unknown as { BUCKET: R2Bucket }).BUCKET.put(KEY, BYTES);
	});

	it("answers about a message with a list of named fields, and nothing else", async () => {
		const key = (await newKey("owner", [TEAM], "read")).body.token;
		const one = await tool(key, "get_email", { mailboxId: TEAM, emailId: "with-original" });
		expect(one.isError).toBe(false);
		// Pinned: a new column of the mailbox's database does not reach a client by itself.
		expect(Object.keys(one.value as object).sort()).toEqual(
			[
				"attachments",
				"bcc",
				"body",
				"body_html",
				"body_text",
				"cc",
				"date",
				"email_references",
				"folder_id",
				"id",
				"in_reply_to",
				"labels",
				"message_id",
				"raw_headers",
				"read",
				"recipient",
				"sender",
				"starred",
				"subject",
				"thread_id",
			].sort(),
		);
		const files = (one.value as { attachments: object[] }).attachments;
		expect(files.map((file) => Object.keys(file).sort())).toEqual([
			["content_id", "disposition", "email_id", "filename", "id", "mimetype", "size"],
		]);

		const thread = await tool(key, "get_thread", { mailboxId: TEAM, threadId: "thread-original" });
		const lines = await tool(key, "list_emails", { mailboxId: TEAM, limit: 100 });
		const found = await tool(key, "search_emails", { mailboxId: TEAM, query: "Kept whole" });
		expect(thread.text).toContain("Kept whole");
		expect(lines.text).toContain("Kept whole");
		expect(found.text).toContain("Kept whole");
		const line = (lines.value as Record<string, unknown>[]).find(
			(row) => row.id === "with-original",
		);
		expect(Object.keys(line ?? {}).sort()).toEqual(
			[
				"bcc",
				"cc",
				"date",
				"email_references",
				"folder_id",
				"id",
				"in_reply_to",
				"labels",
				"read",
				"recipient",
				"sender",
				"snippet",
				"starred",
				"subject",
				"thread_id",
			].sort(),
		);

		// Neither the original, nor its key, nor what the platform said, nor that there is one.
		for (const answer of [one, thread, lines, found]) {
			expect(answer.isError).toBe(false);
			for (const kept of [
				"raw_key",
				KEY,
				KEY.slice(4),
				"raw_size",
				"has_original",
				"unparsed",
				"auth_results",
				"authentication",
				"mx.cloudflare.net",
				"THE-ORIGINAL-BYTES",
			]) {
				expect(answer.text, kept).not.toContain(kept);
			}
		}
	});

	it("has no tool that shows or downloads an original", () => {
		expect(
			MCP_TOOLS.map((t) => t.name).filter((name) => /original|raw|download/.test(name)),
		).toEqual([]);
	});
});

describe("a key and its tools reach neither the known addresses nor a person's choices (ADR-0012)", () => {
	const known = () =>
		runInDurableObject(testEnv.MAILBOX.get(testEnv.MAILBOX.idFromName(TEAM)), (_object, state) =>
			Number([...state.storage.sql.exec(`SELECT COUNT(*) AS n FROM known_addresses`)][0]?.n ?? -1),
		);

	it("teaches the mailbox no address, whatever a client drafts", async () => {
		const key = (await newKey("sender", [TEAM], "write")).body.token;
		const saved = await tool(key, "create_draft", {
			mailboxId: TEAM,
			to: "planted-by-a-client@elsewhere.test",
			subject: "A draft with a recipient",
			bodyHtml: "<p>Hello</p>",
		});
		expect(saved.isError).toBe(false);
		const drafts = (await tool(key, "list_emails", { mailboxId: TEAM, folder: "draft" })).value as {
			id: string;
		}[];
		expect(drafts.length).toBeGreaterThan(0);
		const changed = await tool(key, "update_draft", {
			mailboxId: TEAM,
			draftId: drafts[0]?.id,
			to: "planted-again@elsewhere.test",
			subject: "Changed",
			bodyHtml: "<p>Again</p>",
		});
		expect(changed.isError).toBe(false);
		// Nothing in this suite sent mail as a person, and nothing else teaches an address.
		expect(await known()).toBe(0);
		const offered = await request(
			`/api/v1/mailboxes/${encodeURIComponent(TEAM)}/known-addresses?q=planted`,
			{ cookie: cookies.owner },
		);
		expect(await offered.json()).toEqual({ addresses: [] });
	});

	it("has no tool for either, and a key opens neither route", async () => {
		expect(
			MCP_TOOLS.map((t) => t.name).filter((name) =>
				/known|address|contact|complet|choice|setting|preference/.test(name),
			),
		).toEqual([]);
		const key = (await newKey("owner", [TEAM], "write")).body.token;
		for (const [method, path] of [
			["GET", `/api/v1/mailboxes/${encodeURIComponent(TEAM)}/known-addresses?q=a`],
			["DELETE", `/api/v1/mailboxes/${encodeURIComponent(TEAM)}/known-addresses`],
			["GET", "/api/v1/me/choices"],
			["PUT", "/api/v1/me/choices"],
		] as const) {
			const res = await request(path, {
				method,
				headers: { authorization: `Bearer ${key}` },
				...(method === "PUT" ? { body: `{"pageSize":10}` } : {}),
			});
			expect(res.status, `${method} ${path}`).toBe(401);
		}
		expect(
			(
				await testEnv.DB.prepare(`select count(*) as "n" from "user_choices"`).first<{
					n: number;
				}>()
			)?.n,
		).toBe(0);
	});
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
