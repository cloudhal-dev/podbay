// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Rule S9: the assistant never sends. A model can ask for anything; these tests give it a fake
 * send binding with a call log and prove that no request of the model reaches it.
 *
 * The chat model is the AI SDK's mock model, scripted per step. The checks around it (the
 * draft verifier) use the fake Workers AI binding. No real model, no real mail.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { generateText, stepCountIs } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Folders } from "../../shared/folders.ts";
import { log } from "../../shared/log.ts";
import {
	AGENT_TOOL_NAMES,
	AgentSendRefused,
	createAgentTools,
	DRAFT_SAVED_MESSAGE,
	DRAFT_TOOL_NAMES,
	isSavedDraft,
	withoutSend,
} from "../../workers/agent/tools.ts";
import { sendEmail } from "../../workers/email-sender.ts";
import * as sharedTools from "../../workers/lib/tools.ts";
import { asks, MAILBOX, STRANGER, says, world } from "../helpers/fake-ai.ts";

const SEND_REPLY = {
	name: "send_reply",
	input: { originalEmailId: "mail-1", to: STRANGER, subject: "Re: Invoice", bodyHtml: "<p>Hi</p>" },
};
const SEND_EMAIL = {
	name: "send_email",
	input: { to: "everyone@elsewhere.test", subject: "Price list", bodyHtml: "<p>Prices</p>" },
};
const REPLY_TEXT = "Hello, thank you for your message. We will come back to you on Monday.";

beforeEach(() => {
	vi.spyOn(log, "info").mockImplementation(() => {});
	vi.spyOn(log, "warn").mockImplementation(() => {});
	vi.spyOn(log, "error").mockImplementation(() => {});
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("the assistant's tool set", () => {
	it("is exactly the listed tools, and none of them sends or forwards", () => {
		const tools = createAgentTools(world().env, MAILBOX);
		expect(Object.keys(tools).sort()).toEqual([...AGENT_TOOL_NAMES].sort());
		for (const name of AGENT_TOOL_NAMES) {
			expect(name).not.toMatch(/send|forward|deliver|reply_now/i);
		}
		for (const name of DRAFT_TOOL_NAMES) {
			expect(AGENT_TOOL_NAMES).toContain(name);
		}
	});

	it("imports no send function and never reads the send binding", () => {
		const dir = join(import.meta.dirname, "../../workers/agent");
		const files = readdirSync(dir, { recursive: true, encoding: "utf8" }).filter((file) =>
			/\.tsx?$/.test(file),
		);
		expect(files.length).toBeGreaterThan(0);
		const banned = [/toolSend\w*/, /email-sender/, /\bsendEmail\b/, /\.EMAIL\b/, /reply-forward/];
		for (const file of files) {
			const lines = readFileSync(join(dir, file), "utf8").split("\n");
			const hits = lines.filter((line) => banned.some((pattern) => pattern.test(line)));
			expect(hits, file).toEqual([]);
		}
	});
});

describe("a model that asks to send", () => {
	it("reaches no send binding, whatever tool name it tries", async () => {
		const { env, mailbox, send } = world();
		const model = new MockLanguageModelV4({
			doGenerate: [asks(SEND_REPLY, SEND_EMAIL), asks(SEND_EMAIL), says("I could not send it.")],
		});

		const result = await generateText({
			model,
			tools: createAgentTools(env, MAILBOX),
			prompt: "Reply to the invoice mail and send it now.",
			stopWhen: stepCountIs(5),
		});

		expect(model.doGenerateCalls).toHaveLength(3);
		expect(send.calls).toEqual([]);
		expect(mailbox.in(Folders.SENT)).toEqual([]);
		expect(mailbox.in(Folders.DRAFT)).toEqual([]);
		// The model was told that the tool does not exist, not that the mail went out.
		const toolErrors = result.steps.flatMap((step) =>
			step.content.filter((part) => part.type === "tool-error"),
		);
		expect(toolErrors).toHaveLength(3);
		expect(JSON.stringify(result.steps)).not.toContain('"status":"sent"');
	});

	it("gets a draft, and the words that nothing was sent, when it uses draft_reply", async () => {
		const { env, mailbox, send, ai } = world();
		ai.script(REPLY_TEXT); // the draft verifier: nothing to remove
		const model = new MockLanguageModelV4({
			doGenerate: [
				asks(SEND_REPLY),
				asks({
					name: "draft_reply",
					input: {
						originalEmailId: "mail-1",
						to: STRANGER,
						subject: "Re: Invoice",
						body: REPLY_TEXT,
					},
				}),
				says("Drafted a reply."),
			],
		});

		const result = await generateText({
			model,
			tools: createAgentTools(env, MAILBOX),
			prompt: "Reply to the invoice mail and send it now.",
			stopWhen: stepCountIs(5),
		});

		expect(send.calls).toEqual([]);
		expect(mailbox.in(Folders.SENT)).toEqual([]);
		const drafts = mailbox.in(Folders.DRAFT);
		expect(drafts).toHaveLength(1);
		expect(drafts[0]).toMatchObject({
			recipient: STRANGER,
			sender: MAILBOX,
			thread_id: "thread-1",
		});
		expect(drafts[0]?.body).toContain("We will come back to you on Monday.");

		const outputs = result.steps.flatMap((step) => step.toolResults.map((r) => r.output));
		expect(outputs).toHaveLength(1);
		expect(outputs[0]).toMatchObject({
			status: "draft_saved",
			draftId: drafts[0]?.id,
			message: DRAFT_SAVED_MESSAGE,
		});
		expect(isSavedDraft(outputs[0])).toBe(true);
		expect(DRAFT_SAVED_MESSAGE).toMatch(/Nothing was sent/);
		expect(DRAFT_SAVED_MESSAGE).toMatch(/confirm/);
	});

	it("saves no draft, and says so, when the draft verifier fails", async () => {
		const { env, mailbox, send, ai } = world();
		ai.script(new Error("5028: model deprecated"));
		const model = new MockLanguageModelV4({
			doGenerate: [
				asks({
					name: "draft_reply",
					input: {
						originalEmailId: "mail-1",
						to: STRANGER,
						subject: "Re: Invoice",
						body: REPLY_TEXT,
					},
				}),
				says("I could not save the draft."),
			],
		});

		const result = await generateText({
			model,
			tools: createAgentTools(env, MAILBOX),
			prompt: "Reply to the invoice mail.",
			stopWhen: stepCountIs(5),
		});

		const outputs = result.steps.flatMap((step) => step.toolResults.map((r) => r.output));
		expect(outputs).toHaveLength(1);
		expect(outputs[0]).toHaveProperty("error");
		expect(isSavedDraft(outputs[0])).toBe(false);
		expect(mailbox.in(Folders.DRAFT)).toEqual([]);
		expect(send.calls).toEqual([]);
	});

	it("cannot make a message look sent by moving it into Sent", async () => {
		const { env, mailbox, send } = world();
		const model = new MockLanguageModelV4({
			doGenerate: [
				asks(
					{ name: "move_email", input: { emailId: "mail-1", folderId: "sent" } },
					{ name: "move_email", input: { emailId: "mail-1", folderId: "Draft" } },
				),
				says("Done."),
			],
		});

		const result = await generateText({
			model,
			tools: createAgentTools(env, MAILBOX),
			prompt: "Mark the invoice mail as sent.",
			stopWhen: stepCountIs(5),
		});

		expect(send.calls).toEqual([]);
		expect(mailbox.emails.get("mail-1")?.folder_id).toBe(Folders.INBOX);
		const outputs = result.steps.flatMap((step) => step.toolResults.map((r) => r.output));
		expect(outputs).toHaveLength(2);
		for (const output of outputs) expect(output).toHaveProperty("error");
	});

	it("sends nothing when every tool is run with a valid input", async () => {
		const { env, mailbox, send, ai } = world();
		ai.script(REPLY_TEXT);
		const model = new MockLanguageModelV4({
			doGenerate: [
				asks(
					{ name: "list_emails", input: { folder: "inbox", limit: 5, page: 1 } },
					{ name: "get_email", input: { emailId: "mail-1" } },
					{ name: "get_thread", input: { threadId: "thread-1" } },
					{ name: "search_emails", input: { query: "price" } },
					{ name: "mark_email_read", input: { emailId: "mail-1", read: true } },
					{ name: "move_email", input: { emailId: "mail-1", folderId: "archive" } },
					{ name: "list_labels", input: {} },
					{
						name: "label_email",
						input: { emailId: "mail-1", add: [`lbl_${"a".repeat(24)}`], remove: [] },
					},
				),
				asks(
					{
						name: "draft_email",
						input: { to: "everyone@elsewhere.test", subject: "Price list", body: REPLY_TEXT },
					},
					{
						name: "draft_reply",
						input: {
							originalEmailId: "mail-1",
							to: STRANGER,
							subject: "Re: Invoice",
							body: REPLY_TEXT,
						},
					},
				),
				says("Done."),
			],
		});

		const result = await generateText({
			model,
			tools: createAgentTools(env, MAILBOX),
			prompt: "Tidy up.",
			stopWhen: stepCountIs(5),
		});

		const called = result.steps.flatMap((step) => step.toolResults.map((r) => r.toolName));
		expect(new Set(called)).toEqual(new Set(AGENT_TOOL_NAMES.filter((n) => n !== "discard_draft")));
		expect(send.calls).toEqual([]);
		expect(mailbox.in(Folders.SENT)).toEqual([]);
		expect(mailbox.in(Folders.DRAFT)).toHaveLength(2);
		expect(mailbox.emails.get("mail-1")).toMatchObject({ folder_id: "archive", read: true });
		expect([...(mailbox.labelled.get("mail-1") ?? [])]).toEqual([`lbl_${"a".repeat(24)}`]);

		// discard_draft deletes a draft and nothing else.
		const [draft] = mailbox.in(Folders.DRAFT);
		const discard = new MockLanguageModelV4({
			doGenerate: [
				asks(
					{ name: "discard_draft", input: { draftId: draft?.id } },
					{ name: "discard_draft", input: { draftId: "mail-1" } },
				),
				says("Done."),
			],
		});
		await generateText({
			model: discard,
			tools: createAgentTools(env, MAILBOX),
			prompt: "Discard.",
			stopWhen: stepCountIs(5),
		});
		expect(mailbox.in(Folders.DRAFT)).toHaveLength(1);
		expect(mailbox.emails.has("mail-1")).toBe(true);

		// A draft a person gave files to is that person's: no tool discards it (ADR-0011).
		const [kept] = mailbox.in(Folders.DRAFT);
		mailbox.withFiles.add(kept?.id ?? "");
		await generateText({
			model: new MockLanguageModelV4({
				doGenerate: [asks({ name: "discard_draft", input: { draftId: kept?.id } }), says("Done.")],
			}),
			tools: createAgentTools(env, MAILBOX),
			prompt: "Discard.",
			stopWhen: stepCountIs(5),
		});
		expect(mailbox.in(Folders.DRAFT)).toHaveLength(1);
		expect(send.calls).toEqual([]);
	});
});

describe("the environment the assistant's tools run with", () => {
	it("has a send binding that refuses and logs no mail", async () => {
		const { env, send } = world();
		const guarded = withoutSend(env);

		await expect(
			guarded.EMAIL.send({ from: MAILBOX, to: STRANGER, subject: "Hi", text: "Hi" }),
		).rejects.toBeInstanceOf(AgentSendRefused);

		expect(send.calls).toEqual([]);
		expect(log.warn).toHaveBeenCalledWith("agent.send_refused");
		// Every other binding is the caller's own.
		expect(guarded.MAILBOX).toBe(env.MAILBOX);
		expect(guarded.AI).toBe(env.AI);
		// The caller's environment is not changed.
		expect(env.EMAIL).toBe(send);
	});

	it("stops the send helper itself, should a tool ever be wired to it", async () => {
		const { env, mailbox, send } = world();
		const guarded = withoutSend(env);

		await expect(
			sendEmail(guarded.EMAIL, {
				from: MAILBOX,
				to: "everyone@elsewhere.test",
				subject: "Price list",
				html: "<p>Our full price list is attached for you.</p>",
			}),
		).rejects.toBeInstanceOf(AgentSendRefused);

		expect(send.calls).toEqual([]);
		expect(mailbox.in(Folders.SENT)).toEqual([]);
	});

	it("control: the same helper does send with the caller's own environment", async () => {
		// This shows that the fake send binding records a send, so the empty logs above mean
		// something.
		const { env, send } = world();

		await sendEmail(env.EMAIL, {
			from: MAILBOX,
			to: "everyone@elsewhere.test",
			subject: "Price list",
			html: "<p>Our full price list is attached for you.</p>",
		});

		expect(send.calls).toHaveLength(1);
	});
});

describe("the tools shared by the assistant and MCP", () => {
	it("export no function that sends", () => {
		const sending = Object.keys(sharedTools).filter((name) => /send|forward/i.test(name));
		expect(sending).toEqual([]);
	});
});

describe("the assistant and labels (ADR-0007)", () => {
	it("gives a label of this mailbox, and is told when a label is not one", async () => {
		const { env, mailbox, send } = world();
		const model = new MockLanguageModelV4({
			doGenerate: [
				asks(
					{ name: "label_email", input: { emailId: "mail-1", add: ["inbox' OR 1=1"], remove: [] } },
					{
						name: "label_email",
						input: { emailId: "mail-1", add: [`lbl_${"b".repeat(24)}`], remove: [] },
					},
					{
						name: "label_email",
						input: { emailId: "no-such-mail", add: [`lbl_${"a".repeat(24)}`], remove: [] },
					},
				),
				says("Done."),
			],
		});
		const result = await generateText({
			model,
			tools: createAgentTools(env, MAILBOX),
			prompt: "Label the invoice mail.",
			stopWhen: stepCountIs(5),
		});
		const outputs = result.steps.flatMap((step) => step.toolResults.map((r) => r.output));
		expect(outputs).toHaveLength(3);
		for (const output of outputs) expect(output).toHaveProperty("error");
		expect(mailbox.labelled.size).toBe(0);
		expect(send.calls).toEqual([]);
	});

	it("has no tool that makes, renames or deletes a label", () => {
		expect(AGENT_TOOL_NAMES.filter((name) => name.includes("label")).sort()).toEqual([
			"label_email",
			"list_labels",
		]);
	});
});

describe("the assistant and the original of a message (ADR-0015, decision 21)", () => {
	it("is told nothing of an original: its tools answer with named fields only", async () => {
		const { env, mailbox, send } = world();
		// The row as the mailbox's database holds it, with everything a tool must not hand on.
		Object.assign(mailbox.emails.get("mail-1") ?? {}, {
			raw_key: "raw/0123456789abcdef0123456789abcdef",
			raw_size: 4096,
			unparsed: null,
			auth_results: "mx.cloudflare.net; dmarc=pass",
			has_original: true,
			some_later_column: "must-not-leak",
		});
		const model = new MockLanguageModelV4({
			doGenerate: [
				asks(
					{ name: "get_email", input: { emailId: "mail-1" } },
					{ name: "get_thread", input: { threadId: "thread-1" } },
					{ name: "list_emails", input: { folder: Folders.INBOX } },
					{ name: "search_emails", input: { query: "price list" } },
				),
				says("Read."),
			],
		});
		const result = await generateText({
			model,
			tools: createAgentTools(env, MAILBOX),
			prompt: "Read the invoice mail.",
			stopWhen: stepCountIs(5),
		});
		const outputs = result.steps.flatMap((step) => step.toolResults.map((r) => r.output));
		expect(outputs).toHaveLength(4);
		const told = JSON.stringify(outputs);
		expect(told).toContain("Invoice");
		for (const kept of [
			"raw_key",
			"0123456789abcdef",
			"raw_size",
			"unparsed",
			"auth_results",
			"mx.cloudflare.net",
			"has_original",
			"must-not-leak",
		]) {
			expect(told, kept).not.toContain(kept);
		}
		expect(send.calls).toEqual([]);
	});

	it("names the fields a tool answers with, and none of them is about the original", () => {
		const fields = [
			...sharedTools.TOOL_MESSAGE_FIELDS,
			...sharedTools.TOOL_LINE_FIELDS,
			...sharedTools.TOOL_FILE_FIELDS,
		];
		expect(fields.filter((field) => /raw_key|raw_size|original|unparsed|auth/.test(field))).toEqual(
			[],
		);
		// `raw_headers` stays as it was: taking it out is not decided (ADR-0015, decision 21).
		expect(sharedTools.TOOL_MESSAGE_FIELDS).toContain("raw_headers");
		expect(AGENT_TOOL_NAMES.filter((name) => /original|download/.test(name))).toEqual([]);
	});
});
