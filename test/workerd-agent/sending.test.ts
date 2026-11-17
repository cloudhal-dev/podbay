/**
 * Tier 3, with the assistant and MCP switched on: they get nothing of outgoing mail (ADR-0016,
 * decision 20; rule S9; boundary B5).
 *
 * - no tool sends later, sends now, takes a message back or changes its time: scheduling is
 *   sending. The tool lists are the ones they were;
 * - the environment the tools run with cannot reach the handover: its send binding refuses,
 *   and its handle on a mailbox has none of the methods by which mail is sent. The second is
 *   needed since the working send binding sits in the mailbox object every tool can reach;
 * - a tool reads Scheduled as it reads any place and changes nothing in it: `update_draft`,
 *   `discard_draft`, the move tools, marking and labelling refuse a waiting message.
 *
 * No test here calls a model, and the send binding is the test's own.
 */
import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { MCP_TOOLS } from "../../shared/mcp-tools.ts";
import {
	AGENT_TOOL_NAMES,
	AgentSendRefused,
	createAgentTools,
	SENDING_METHODS,
	withoutSend,
} from "../../workers/agent/tools.ts";
import { getMailboxStub } from "../../workers/lib/email-helpers.ts";
import { TOOL_LINE_FIELDS, TOOL_MESSAGE_FIELDS } from "../../workers/lib/tools.ts";
import { MCP_TOOL_NAMES } from "../../workers/mcp/server.ts";
import type { Env } from "../../workers/types.ts";
import { Browser, createMailbox, json, migrate, ORIGIN, setupOwner } from "../workerd/helpers.ts";
import {
	age,
	alarmOf,
	type FakeSender,
	fakeSender,
	HOUR,
	inMailbox,
	MINUTE,
	placeOf,
	submissionOf,
	wake,
	wakeNow,
} from "../workerd/sending-helpers.ts";

const MAILBOX = "guarded@example.com";
const M = `/api/v1/mailboxes/${encodeURIComponent(MAILBOX)}`;
const LABEL = "lbl_000000000000000000000001";
const SENDS = /send|schedul|resched|unsend|undo|later|cancel|deliver|forward|dispatch|outbox/i;

const owner = new Browser();
let token = "";
let fake: FakeSender;
let waiting = "";

interface ToolAnswer {
	isError: boolean;
	body: Record<string, unknown> | unknown[];
}

/** One tool call of an MCP client: what the tool answered, and whether it was a refusal. */
async function mcp(name: string, args: Record<string, unknown> = {}): Promise<ToolAnswer> {
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
	const answer = JSON.parse(payload) as {
		result?: { content: { text: string }[]; isError?: boolean };
		error?: { message: string };
	};
	if (answer.result === undefined) return { isError: true, body: { error: answer.error?.message } };
	let body: ToolAnswer["body"] = {};
	try {
		body = JSON.parse(answer.result.content[0]?.text ?? "{}") as ToolAnswer["body"];
	} catch {
		body = { error: answer.result.content[0]?.text };
	}
	return { isError: answer.result.isError === true, body };
}

/** One tool call of the assistant, as the model's answer makes it. */
async function assistant(name: (typeof AGENT_TOOL_NAMES)[number], input: Record<string, unknown>) {
	const tools = createAgentTools(env as unknown as Env, MAILBOX);
	const execute = tools[name].execute as
		| ((input: unknown, options: unknown) => Promise<unknown>)
		| undefined;
	if (execute === undefined) throw new Error(`the tool ${name} runs nothing`);
	return (await execute(input, { toolCallId: "call-1", messages: [] })) as
		| Record<string, unknown>
		| Record<string, unknown>[];
}

/** Everything of the waiting message that a tool could have changed. */
const stateOf = (id: string) =>
	inMailbox(MAILBOX, (sql) => ({
		row: [...sql.exec(`SELECT * FROM emails WHERE id = ?1`, id)][0],
		labels: [...sql.exec(`SELECT label_id FROM email_labels WHERE email_id = ?1`, id)],
		submission: [...sql.exec(`SELECT * FROM submissions WHERE email_id = ?1`, id)][0],
		files: [...sql.exec(`SELECT id FROM attachments WHERE email_id = ?1`, id)],
	}));

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
	token = (await json<{ token: string }>(key)).token;
	fake = await fakeSender(MAILBOX);
	await inMailbox(MAILBOX, (sql) => {
		sql.exec(
			`INSERT INTO labels (id, name, color, created_at) VALUES (?1, 'Kept', 0, ?2)`,
			LABEL,
			new Date().toISOString(),
		);
		sql.exec(
			`INSERT INTO emails (id, folder_id, subject, sender, recipient, date, body, thread_id, message_id)
			 VALUES ('asked', 'inbox', 'A question', 'ada@sender.test', ?1, ?2, 'q', 'talk', 'question@sender.test')`,
			MAILBOX,
			new Date().toISOString(),
		);
	});
	// A person's answer, sent for later: it waits in Scheduled, in the conversation it answers.
	const sent = await owner.post(`${M}/emails/asked/reply`, {
		to: "ada@sender.test",
		from: MAILBOX,
		subject: "Re: A question",
		html: "<p>The answer a person wrote</p>",
		send_at: new Date(Date.now() + HOUR).toISOString(),
	});
	expect(sent.status).toBe(202);
	waiting = (await json<{ id: string }>(sent)).id;
});

describe("no tool sends, schedules, takes back or changes a time", () => {
	it("the tool lists are what they were, and none of them is about sending", () => {
		expect([...MCP_TOOL_NAMES]).toEqual([
			"list_mailboxes",
			"list_emails",
			"get_email",
			"get_thread",
			"search_emails",
			"list_labels",
			"draft_reply",
			"create_draft",
			"update_draft",
			"mark_email_read",
			"move_email",
			"move_to_trash",
			"label_email",
		]);
		expect([...AGENT_TOOL_NAMES]).toEqual([
			"list_emails",
			"get_email",
			"get_thread",
			"search_emails",
			"draft_email",
			"draft_reply",
			"mark_email_read",
			"move_email",
			"discard_draft",
			"list_labels",
			"label_email",
		]);
		for (const name of [...MCP_TOOL_NAMES, ...AGENT_TOOL_NAMES]) expect(name).not.toMatch(SENDS);
		for (const tool of MCP_TOOLS) expect(tool.summary, tool.name).not.toMatch(SENDS);
		// What a tool answers about a message has no word about its way out.
		for (const field of [...TOOL_MESSAGE_FIELDS, ...TOOL_LINE_FIELDS]) {
			expect(field).not.toMatch(/submission|send_at|service|retry/);
		}
	});

	it("a tool name a client makes up reaches nothing", async () => {
		for (const name of ["send_email", "schedule_email", "unsend_email", "reschedule_email"]) {
			const made = await mcp(name, { emailId: waiting, send_at: new Date().toISOString() });
			expect(made.isError, name).toBe(true);
		}
		expect((await submissionOf(MAILBOX, waiting))?.state).toBe("waiting");
		expect(fake.calls).toHaveLength(0);
	});
});

describe("the environment the tools run with", () => {
	it("cannot reach the methods by which mail is sent", async () => {
		expect([...SENDING_METHODS].sort()).toEqual(["alarm", "reschedule", "submit", "unsend"]);
		const before = await stateOf(waiting);
		const alarm = await alarmOf(MAILBOX);
		const guarded = withoutSend(env as unknown as Env);
		const handles = [
			getMailboxStub(guarded, MAILBOX),
			guarded.MAILBOX.get(guarded.MAILBOX.idFromName(MAILBOX)),
			guarded.MAILBOX.getByName(MAILBOX),
		] as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>[];
		const taken = {
			id: "by-a-tool",
			fromDraft: false,
			sendAt: Date.now(),
			later: false,
			by: "a-tool",
			fields: {
				subject: "From a tool",
				sender: MAILBOX,
				recipient: "victim@elsewhere.test",
				cc: null,
				bcc: null,
				date: new Date().toISOString(),
				body: "x",
				email_references: null,
				message_id: "by-a-tool@example.com",
				raw_headers: "[]",
			},
		};
		for (const handle of handles) {
			const tried: [string, Promise<unknown> | undefined][] = [
				["submit", handle.submit?.(taken)],
				["unsend", handle.unsend?.(waiting)],
				["reschedule", handle.reschedule?.(waiting, Date.now(), "a-tool")],
				["alarm", handle.alarm?.()],
			];
			for (const [name, attempt] of tried) {
				await expect(attempt, name).rejects.toBeInstanceOf(AgentSendRefused);
			}
			// Everything else is the mailbox's own: the handle reads as it always did.
			const places = ((await handle.getFolders?.()) ?? []) as { id: string }[];
			expect(places.map((place) => place.id)).toContain("scheduled");
			const read = ((await handle.getEmail?.(waiting)) ?? {}) as { id?: string };
			expect(read.id).toBe(waiting);
		}
		// The send binding of that environment refuses as before.
		await expect(
			guarded.EMAIL.send({ to: "x@elsewhere.test", from: MAILBOX, subject: "x", text: "x" }),
		).rejects.toBeInstanceOf(AgentSendRefused);

		expect(await stateOf(waiting)).toEqual(before);
		expect(await alarmOf(MAILBOX)).toBe(alarm);
		expect(await placeOf(MAILBOX, "by-a-tool")).toBeUndefined();
		expect(fake.calls).toHaveLength(0);

		// The test can fail: the mailbox's own handle has the methods, and they do what they say.
		const real = getMailboxStub(env as unknown as Env, MAILBOX) as unknown as {
			reschedule(id: string, at: number, by: string): Promise<unknown>;
		};
		const by = (await submissionOf(MAILBOX, waiting))?.requested_by ?? "";
		const at = Date.now() + 2 * HOUR;
		expect(await real.reschedule(waiting, at, by)).toEqual({
			send_at: new Date(at).toISOString(),
		});
	});
});

describe("a tool reads Scheduled and changes nothing in it", () => {
	it("an MCP client sees what waits and is refused every change", async () => {
		const before = await stateOf(waiting);
		const listed = await mcp("list_emails", { folder: "scheduled" });
		expect(listed.isError).toBe(false);
		expect((listed.body as { id: string }[]).map((line) => line.id)).toEqual([waiting]);
		const read = await mcp("get_email", { emailId: waiting });
		expect(read.isError).toBe(false);
		expect(Object.keys(read.body).sort()).toEqual(
			[...TOOL_MESSAGE_FIELDS, "attachments"].filter((field) => field in read.body).sort(),
		);
		expect(read.body).not.toHaveProperty("submission");
		expect((read.body as { folder_id: string }).folder_id).toBe("scheduled");

		const refused: [string, Record<string, unknown>][] = [
			["update_draft", { draftId: waiting, to: "victim@elsewhere.test", subject: "Changed" }],
			["update_draft", { draftId: waiting, bodyHtml: "<p>Changed by a client</p>" }],
			["move_email", { emailId: waiting, folderId: "trash" }],
			["move_email", { emailId: waiting, folderId: "inbox" }],
			["move_email", { emailId: waiting, folderId: "archive" }],
			["move_to_trash", { emailId: waiting }],
			["mark_email_read", { emailId: waiting, read: false }],
			["label_email", { emailId: waiting, add: [LABEL] }],
			// Scheduled is no target either.
			["move_email", { emailId: "asked", folderId: "scheduled" }],
		];
		for (const [name, args] of refused) {
			const answer = await mcp(name, args);
			expect(answer.isError, `${name} ${JSON.stringify(args)}`).toBe(true);
		}
		expect(await stateOf(waiting)).toEqual(before);
		expect(await placeOf(MAILBOX, "asked")).toBe("inbox");
		// The conversation is labelled from its other message: the waiting one is passed over.
		const labelled = await mcp("label_email", { emailId: "asked", add: [LABEL] });
		expect(labelled.isError).toBe(false);
		expect(await stateOf(waiting)).toEqual(before);
		expect(fake.calls).toHaveLength(0);
	});

	it("the assistant sees what waits and is refused every change", async () => {
		const before = await stateOf(waiting);
		const listed = (await assistant("list_emails", {
			folder: "scheduled",
			limit: 20,
			page: 1,
		})) as {
			id: string;
		}[];
		expect(listed.map((line) => line.id)).toEqual([waiting]);
		const read = (await assistant("get_email", { emailId: waiting })) as Record<string, unknown>;
		expect(read).not.toHaveProperty("submission");

		const refused: [(typeof AGENT_TOOL_NAMES)[number], Record<string, unknown>][] = [
			["discard_draft", { draftId: waiting }],
			["move_email", { emailId: waiting, folderId: "trash" }],
			["move_email", { emailId: waiting, folderId: "archive" }],
			["move_email", { emailId: "asked", folderId: "scheduled" }],
			["mark_email_read", { emailId: waiting, read: false }],
			["label_email", { emailId: waiting, add: [LABEL], remove: [] }],
		];
		for (const [name, input] of refused) {
			const output = (await assistant(name, input)) as Record<string, unknown>;
			expect(typeof output.error, `${name} ${JSON.stringify(input)}`).toBe("string");
		}
		expect(await stateOf(waiting)).toEqual(before);
		expect(fake.calls).toHaveLength(0);
	});

	it("what the person wrote is what leaves, and nothing a tool did changed it", async () => {
		await age(MAILBOX, 3 * HOUR + MINUTE);
		expect(await wake(MAILBOX)).toBe(true);
		expect(fake.calls).toHaveLength(1);
		expect(fake.calls[0]).toMatchObject({
			to: ["ada@sender.test"],
			subject: "Re: A question",
			html: "<p>The answer a person wrote</p>",
		});
		expect(await placeOf(MAILBOX, waiting)).toBe("sent");
		// Nothing else ever leaves this mailbox: a draft a tool saved waits for a person.
		const made = await mcp("create_draft", {
			to: "victim@elsewhere.test",
			subject: "Not sent",
			bodyHtml: "<p>x</p>",
		});
		expect(made.isError).toBe(false);
		await wakeNow(MAILBOX);
		expect(fake.calls).toHaveLength(1);
	});
});
