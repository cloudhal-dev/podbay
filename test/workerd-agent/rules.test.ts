/**
 * Tier 3, with the assistant and MCP switched on: they get nothing of a mailbox's rules
 * (ADR-0008; rule S9; boundary B5). The record gives the rules and the automatic reply to
 * people, by routes with rights and fresh proof, and says nothing of a tool, so no tool has
 * them:
 *
 * - no tool reads, makes or changes a filter, a blocked sender or the automatic reply. The
 *   tool lists are the ones they were;
 * - the environment the tools run with cannot reach the methods of the mailbox that hold the
 *   rules, nor the ones by which mail arrives: filing an arrival is what the automatic reply
 *   answers, so a tool that could file one could make the mailbox send;
 * - a program's key opens none of the six routes.
 *
 * No test here calls a model, and the send binding is the test's own.
 */
import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { MCP_TOOLS } from "../../modules/mail/shared/mcp-tools.ts";
import {
	AGENT_TOOL_NAMES,
	AgentSendRefused,
	RULE_METHODS,
	withoutSend,
} from "../../modules/mail/worker/agent/tools.ts";
import { getMailboxStub } from "../../modules/mail/worker/lib/email-helpers.ts";
import { MCP_TOOL_NAMES } from "../../modules/mail/worker/mcp/server.ts";
import type { Env } from "../../workers/types.ts";
import { Browser, createMailbox, json, migrate, ORIGIN, setupOwner } from "../workerd/helpers.ts";
import { type FakeSender, fakeSender, inMailbox, letLeave } from "../workerd/sending-helpers.ts";

const MAILBOX = "ruled@example.com";
const M = `/api/v1/mailboxes/${encodeURIComponent(MAILBOX)}`;
const ABOUT_RULES = /rule|filter|block|auto.?reply|vacation|away|respond/i;

const owner = new Browser();
let token = "";
let fake: FakeSender;

type Handle = Record<string, (...args: unknown[]) => Promise<unknown>>;

const REPLY = {
	isEnabled: true,
	fromDate: null,
	toDate: null,
	subject: "Away",
	textBody: "Away.",
	htmlBody: null,
};
const rulesOf = () =>
	inMailbox(MAILBOX, (sql) => [
		...sql.exec(`SELECT id, kind, sender, body FROM rules ORDER BY id`),
	]);
const mailOf = () =>
	inMailbox(MAILBOX, (sql) => [...sql.exec(`SELECT id, folder_id FROM emails ORDER BY id`)]);

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
	// The owner's own automatic reply is on: what a tool must not be able to set off.
	const saved = await owner.fetch(`${M}/auto-reply`, {
		method: "PUT",
		body: JSON.stringify(REPLY),
	});
	expect(saved.status).toBe(200);
});

describe("the tools", () => {
	it("are the ones they were, and none is about rules, blocking or an automatic reply", () => {
		expect(MCP_TOOL_NAMES.filter((name) => ABOUT_RULES.test(name))).toEqual([]);
		expect(AGENT_TOOL_NAMES.filter((name) => ABOUT_RULES.test(name))).toEqual([]);
		expect(MCP_TOOLS.map((tool) => tool.name).filter((name) => ABOUT_RULES.test(name))).toEqual([]);
	});
});

describe("the environment the tools run with", () => {
	it("cannot reach the rules of a mailbox, nor file an arrival", async () => {
		expect([...RULE_METHODS].sort()).toEqual([
			"beginArrival",
			"blockSender",
			"fileArrival",
			"getAutoReply",
			"getRules",
			"setAutoReply",
			"setRules",
			"unblockSender",
		]);
		const before = { rules: await rulesOf(), mail: await mailOf() };
		const guarded = withoutSend(env as unknown as Env);
		const handles = [
			getMailboxStub(guarded, MAILBOX),
			guarded.MAILBOX.get(guarded.MAILBOX.idFromName(MAILBOX)),
			guarded.MAILBOX.getByName(MAILBOX),
		] as unknown as Handle[];
		const arrival = {
			kind: "parsed",
			email: {
				subject: "Filed by a tool",
				sender: "victim@elsewhere.test",
				recipient: MAILBOX,
				body: "x",
			},
			attachments: [],
			auth_results: null,
			facts: {
				from: "victim@elsewhere.test",
				fromName: "",
				recipients: [MAILBOX],
				subject: "Filed by a tool",
				text: "x",
				hasAttachment: false,
				autoSubmitted: null,
				list: false,
			},
		};
		for (const handle of handles) {
			const tried: [string, Promise<unknown> | undefined][] = [
				["getRules", handle.getRules?.()],
				[
					"setRules",
					handle.setRules?.(
						[
							{
								id: "rul_000000000000000000000001",
								conditions: { subject: "x" },
								actions: { place: "trash" },
							},
						],
						"a-tool",
					),
				],
				["blockSender", handle.blockSender?.("boss@example.com", "a-tool")],
				["unblockSender", handle.unblockSender?.("boss@example.com")],
				["getAutoReply", handle.getAutoReply?.()],
				[
					"setAutoReply",
					handle.setAutoReply?.({ ...REPLY, textBody: "Written by a tool" }, "a-tool"),
				],
				[
					"beginArrival",
					handle.beginArrival?.({
						id: "by-a-tool",
						raw_key: "raw/by-a-tool",
						raw_size: 1,
						envelope_from: "victim@elsewhere.test",
					}),
				],
				["fileArrival", handle.fileArrival?.("by-a-tool", arrival)],
			];
			for (const [name, attempt] of tried) {
				await expect(attempt, name).rejects.toBeInstanceOf(AgentSendRefused);
			}
			// Everything else is the mailbox's own: the handle reads as it always did.
			const places = ((await handle.getFolders?.()) ?? []) as { id: string }[];
			expect(places.map((place) => place.id)).toContain("inbox");
		}
		await letLeave(MAILBOX);
		expect({ rules: await rulesOf(), mail: await mailOf() }).toEqual(before);
		expect(await inMailbox(MAILBOX, (sql) => [...sql.exec(`SELECT * FROM arrivals`)])).toEqual([]);
		expect(fake.calls).toHaveLength(0);
	});

	it("control: the mailbox's own handle has those methods, and filing an arrival is answered", async () => {
		const real = getMailboxStub(env as unknown as Env, MAILBOX) as unknown as Handle;
		expect(await real.getRules?.()).toEqual({ rules: [], blocked: [] });
		expect(await real.getAutoReply?.()).toMatchObject({ reply: { isEnabled: true } });
		await real.beginArrival?.({
			id: "by-the-handler",
			raw_key: "raw/by-the-handler",
			raw_size: 1,
			envelope_from: "asker@elsewhere.test",
		});
		expect(
			await real.fileArrival?.("by-the-handler", {
				kind: "parsed",
				email: {
					subject: "Filed by the handler",
					sender: "asker@elsewhere.test",
					recipient: MAILBOX,
					body: "x",
					thread_id: "by-the-handler",
				},
				attachments: [],
				auth_results: null,
				facts: {
					from: "asker@elsewhere.test",
					fromName: "",
					recipients: [MAILBOX],
					subject: "Filed by the handler",
					text: "x",
					hasAttachment: false,
					autoSubmitted: null,
					list: false,
				},
			}),
		).toBe("filed");
		await letLeave(MAILBOX);
		// So what the guarded handle refuses is a way to make the mailbox send.
		expect(fake.calls.map((call) => call.to)).toEqual([["asker@elsewhere.test"]]);
	});
});

describe("a program's key", () => {
	it("opens none of the routes of the rules, with or without the app's origin", async () => {
		const routes: [string, string][] = [
			["GET", `${M}/rules`],
			["PUT", `${M}/rules`],
			["POST", `${M}/blocked-senders`],
			["DELETE", `${M}/blocked-senders`],
			["GET", `${M}/auto-reply`],
			["PUT", `${M}/auto-reply`],
		];
		for (const [method, path] of routes) {
			for (const origin of [ORIGIN, undefined]) {
				const res = await SELF.fetch(`${ORIGIN}${path}`, {
					method,
					headers: {
						authorization: `Bearer ${token}`,
						"content-type": "application/json",
						...(origin === undefined ? {} : { origin }),
					},
					...(method === "GET" ? {} : { body: "{}" }),
				});
				expect([401, 403], `${method} ${path}`).toContain(res.status);
			}
		}
		expect(await rulesOf()).toHaveLength(1);
	});
});
