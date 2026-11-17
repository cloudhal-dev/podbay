/**
 * Tier 3, with the assistant and MCP switched on: what they write is told to the open app like
 * any other write, and nothing of it is on the connection (ADR-0013, decisions 2 and 6).
 *
 * - a tool of an MCP client and a tool of the assistant move the same counters a route moves:
 *   the write raises the signal inside the mailbox object, whoever asked for it;
 * - a tool that reads moves nothing;
 * - marked content given to every tool that writes appears in no message;
 * - a program's key opens no connection: the route takes a session from the app's own page.
 *
 * No test here calls a model.
 */
import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { LIVE_KINDS, LIVE_LIMITS, type LiveKind } from "../../shared/live.ts";
import { AGENT_TOOL_NAMES, createAgentTools } from "../../workers/agent/tools.ts";
import { MCP_TOOL_NAMES } from "../../workers/mcp/server.ts";
import type { Env } from "../../workers/types.ts";
import { Browser, createMailbox, migrate, ORIGIN, setupOwner } from "../workerd/helpers.ts";
import {
	counters,
	inObject,
	livePath,
	open,
	quiet,
	settled,
	type Tab,
} from "../workerd/live-helpers.ts";

const MAILBOX = "told@example.com";
const MARK = "QZXMARKQZX";
const SHAPE =
	/^\{"v":1,"type":"state","state":\{"delivery":"\d+","mail":"\d+","labels":"\d+","settings":"\d+"\}\}$/;
const LABEL = "lbl_000000000000000000000001";

const owner = new Browser();
let token = "";
let tab: Tab;

/** One tool call of an MCP client. Returns what the tool answered. */
async function mcp(name: string, args: Record<string, unknown> = {}) {
	const res = await SELF.fetch(`${ORIGIN}/mcp`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
			authorization: `Bearer ${token}`,
		},
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "tools/call",
			params: { name, arguments: { mailboxId: MAILBOX, ...args } },
		}),
	});
	expect(res.status, name).toBe(200);
	const text = await res.text();
	const payload = text.startsWith("{")
		? text
		: (text
				.split("\n")
				.filter((line) => line.startsWith("data:"))
				.map((line) => line.slice(5).trim())
				.pop() ?? "");
	const result = (
		JSON.parse(payload) as { result: { content: { text: string }[]; isError?: boolean } }
	).result;
	expect(result.isError === true, `${name}: ${result.content[0]?.text}`).toBe(false);
	return JSON.parse(result.content[0]?.text ?? "null") as Record<string, unknown>;
}

/** One tool call of the assistant, as the model's answer makes it. */
async function assistant(name: (typeof AGENT_TOOL_NAMES)[number], input: Record<string, unknown>) {
	const tools = createAgentTools(env as unknown as Env, MAILBOX);
	const execute = tools[name].execute as
		| ((input: unknown, options: unknown) => Promise<unknown>)
		| undefined;
	if (execute === undefined) throw new Error(`the tool ${name} runs nothing`);
	const output = (await execute(input, { toolCallId: "call-1", messages: [] })) as Record<
		string,
		unknown
	>;
	expect(output.error, `${name}`).toBeUndefined();
	return output;
}

/** Does one thing and holds the counters to exactly what it should move. */
async function step(what: string, moves: LiveKind[], act: () => Promise<unknown>) {
	const before = await counters(MAILBOX);
	const told = tab.texts.length;
	await act();
	const after = await counters(MAILBOX);
	expect(
		LIVE_KINDS.filter((kind) => after[kind] !== before[kind]),
		what,
	).toEqual(LIVE_KINDS.filter((kind) => moves.includes(kind)));
	if (moves.length === 0) {
		await quiet();
		expect(tab.texts.length, `${what}: nothing is told`).toBe(told);
		return;
	}
	const now = JSON.stringify(
		Object.fromEntries(LIVE_KINDS.map((kind) => [kind, String(after[kind])])),
	);
	await settled(() => JSON.stringify(tab.last) === now, `${what}: being told`);
}

async function seed(id: string, subject: string) {
	await inObject(MAILBOX, (state) => {
		state.storage.sql.exec(
			`INSERT INTO emails (id, folder_id, subject, sender, recipient, date, body, thread_id, message_id)
				VALUES (?1, 'inbox', ?2, ?3, ?4, ?5, ?6, ?1, ?7)`,
			id,
			`${MARK} ${subject}`,
			`${MARK}@sender.test`,
			MAILBOX,
			new Date().toISOString(),
			`${MARK} body`,
			`<${id}@sender.test>`,
		);
		state.storage.sql.exec(
			`INSERT OR IGNORE INTO labels (id, name, color, created_at) VALUES (?, ?, 0, ?)`,
			LABEL,
			`${MARK} label`,
			new Date().toISOString(),
		);
	});
}

beforeAll(async () => {
	await migrate();
	expect((await setupOwner()).status).toBe(201);
	expect((await owner.signIn("owner@example.com")).status).toBe(200);
	expect((await createMailbox(owner.cookie, MAILBOX)).status).toBe(201);
	const key = await owner.post("/api/v1/keys", {
		name: "writes",
		access: "write",
		mailboxes: [MAILBOX],
	});
	expect(key.status).toBe(201);
	token = ((await key.json()) as { token: string }).token;
	await seed("one", "for the client");
	await seed("two", "for the assistant");
	tab = await open(owner, MAILBOX);
});

describe("what an MCP client writes", () => {
	it("is told like any other write, and what it reads is not", async () => {
		await step("reading", [], async () => {
			await mcp("list_emails", { folder: "inbox" });
			await mcp("get_email", { emailId: "one" });
			await mcp("get_thread", { threadId: "one" });
			await mcp("search_emails", { query: MARK });
			await mcp("list_labels");
			await mcp("list_mailboxes");
		});
		let draft = "";
		await step("create_draft", ["mail"], async () => {
			const made = await mcp("create_draft", {
				to: `${MARK}@elsewhere.test`,
				subject: `${MARK} draft`,
				bodyHtml: `<p>${MARK}</p>`,
			});
			draft = String(made.draftId);
		});
		await step("update_draft", ["mail"], () =>
			mcp("update_draft", { draftId: draft, subject: `${MARK} changed` }),
		);
		await step("draft_reply", ["mail"], () =>
			mcp("draft_reply", {
				originalEmailId: "one",
				to: `${MARK}@sender.test`,
				subject: `Re: ${MARK}`,
				bodyHtml: `<p>${MARK}</p>`,
			}),
		);
		await step("mark_email_read", ["mail"], () => mcp("mark_email_read", { emailId: "one" }));
		await step("label_email", ["mail"], () =>
			mcp("label_email", { emailId: "one", add: [LABEL], remove: [] }),
		);
		await step("move_email", ["mail"], () =>
			mcp("move_email", { emailId: "one", folderId: "archive" }),
		);
		await step("move_to_trash", ["mail"], () => mcp("move_to_trash", { emailId: "one" }));
	});

	it("names every tool that changes something here", () => {
		// A tool added to the endpoint is tried above, or this list says why not.
		expect([...MCP_TOOL_NAMES].sort()).toEqual(
			[
				"create_draft",
				"draft_reply",
				"get_email",
				"get_thread",
				"label_email",
				"list_emails",
				"list_labels",
				"list_mailboxes",
				"mark_email_read",
				"move_email",
				"move_to_trash",
				"search_emails",
				"update_draft",
			].sort(),
		);
	});
});

describe("what the assistant writes", () => {
	it("is told like any other write, and what it reads is not", async () => {
		await step("reading", [], async () => {
			await assistant("list_emails", { folder: "inbox", limit: 20, page: 1 });
			await assistant("get_email", { emailId: "two" });
			await assistant("get_thread", { threadId: "two" });
			await assistant("search_emails", { query: MARK });
			await assistant("list_labels", {});
		});
		let draft = "";
		await step("draft_email", ["mail"], async () => {
			const made = await assistant("draft_email", {
				to: `${MARK}@elsewhere.test`,
				subject: `${MARK} drafted`,
				body: `${MARK} text`,
			});
			draft = String(made.draftId);
		});
		await step("draft_reply", ["mail"], () =>
			assistant("draft_reply", {
				originalEmailId: "two",
				to: `${MARK}@sender.test`,
				subject: `Re: ${MARK}`,
				body: `${MARK} answer`,
			}),
		);
		await step("mark_email_read", ["mail"], () =>
			assistant("mark_email_read", { emailId: "two", read: true }),
		);
		await step("label_email", ["mail"], () =>
			assistant("label_email", { emailId: "two", add: [LABEL], remove: [] }),
		);
		await step("move_email", ["mail"], () =>
			assistant("move_email", { emailId: "two", folderId: "archive" }),
		);
		await step("discard_draft", ["mail"], () => assistant("discard_draft", { draftId: draft }));
	});

	it("names every tool of the assistant here", () => {
		expect([...AGENT_TOOL_NAMES].sort()).toEqual(
			[
				"discard_draft",
				"draft_email",
				"draft_reply",
				"get_email",
				"get_thread",
				"label_email",
				"list_emails",
				"list_labels",
				"mark_email_read",
				"move_email",
				"search_emails",
			].sort(),
		);
	});
});

describe("the connection", () => {
	it("carried nothing of what the tools wrote", () => {
		expect(tab.texts.length).toBeGreaterThan(10);
		for (const text of tab.texts) {
			expect(text).toMatch(SHAPE);
			expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(LIVE_LIMITS.messageBytes);
			expect(text).not.toContain(MARK);
			expect(text).not.toContain("@");
		}
		expect(new Set(tab.texts).size).toBe(tab.texts.length);
		expect(tab.closed).toBeNull();
	});

	it("is not opened by a program's key", async () => {
		const headers = { upgrade: "websocket", authorization: `Bearer ${token}` };
		// A program names no origin, and the route has no way in without one.
		const plain = await SELF.fetch(`${ORIGIN}${livePath(MAILBOX)}`, { headers });
		expect(plain.status).toBe(403);
		// Naming the app's origin does not make a key a session.
		const named = await SELF.fetch(`${ORIGIN}${livePath(MAILBOX)}`, {
			headers: { ...headers, origin: ORIGIN },
		});
		expect(named.status).toBe(401);
		expect(named.webSocket).toBeNull();
		const inAddress = await SELF.fetch(`${ORIGIN}${livePath(MAILBOX)}?key=${token}`, {
			headers: { upgrade: "websocket", origin: ORIGIN },
		});
		expect(inAddress.status).toBe(401);
	});
});
