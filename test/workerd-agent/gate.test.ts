/**
 * Tier 3, with the assistant and MCP switched on: the gates in front of them (rules S1 and S9).
 *
 * - the assistant's connection needs a session and the right to change mail in that mailbox;
 *   a reader, a non-member and an administrator without a membership do not get it;
 * - MCP is reachable by the instance owner only, until its tools are limited per mailbox.
 *
 * No test here delivers mail or opens a chat, so no model is ever called.
 */
import { beforeAll, describe, expect, it } from "vitest";
import {
	createMailbox,
	migrate,
	request,
	seedMembership,
	seedUser,
	setupOwner,
	signIn,
} from "../workerd/helpers.ts";

const MAILBOX = "team@example.com";
const AGENT_PATH = `/agents/email-agent/${encodeURIComponent(MAILBOX)}`;
const cookies: Record<string, string> = {};

/** The gate answers with JSON; anything else came from behind it. */
async function gate(path: string, who?: string): Promise<{ status: number; error?: string }> {
	const res = await request(path, { cookie: who ? cookies[who] : undefined });
	const body = (await res.json().catch(() => ({}))) as { error?: string };
	return { status: res.status, error: body.error };
}

beforeAll(async () => {
	await migrate();
	expect((await setupOwner()).status).toBe(201);
	cookies.owner = await signIn("owner@example.com");
	expect((await createMailbox(cookies.owner ?? "", MAILBOX)).status).toBe(201);

	await seedUser("admin@example.com", "admin");
	const reader = await seedUser("reader@example.com", "member");
	const sender = await seedUser("sender@example.com", "member");
	await seedUser("outsider@example.com", "member");
	await seedMembership(MAILBOX, reader, "reader");
	await seedMembership(MAILBOX, sender, "sender");
	for (const who of ["admin", "reader", "sender", "outsider"]) {
		cookies[who] = await signIn(`${who}@example.com`);
	}
});

describe("the features are on in this suite", () => {
	it("says so in the configuration", async () => {
		const res = await request("/api/v1/config", { cookie: cookies.owner });
		const body = (await res.json()) as { features: { agent: boolean; mcp: boolean } };
		expect(body.features).toEqual({ agent: true, mcp: true });
	});
});

describe("the assistant's connection", () => {
	it("needs a session", async () => {
		expect(await gate(AGENT_PATH)).toEqual({ status: 401, error: "Unauthorized" });
	});

	it.each(["outsider", "admin"])("answers 404 to %s, who is not a member", async (who) => {
		expect(await gate(AGENT_PATH, who)).toEqual({ status: 404, error: "Not found" });
	});

	it("answers 403 to a reader: the assistant writes drafts", async () => {
		expect(await gate(AGENT_PATH, "reader")).toEqual({ status: 403, error: "Forbidden" });
	});

	it("answers 404 for a mailbox that does not exist and for a crafted name", async () => {
		expect((await gate("/agents/email-agent/ghost%40example.com", "owner")).status).toBe(404);
		expect(
			(await gate(`/agents/email-agent/${encodeURIComponent("../team@example.com")}`, "owner"))
				.status,
		).toBe(404);
		expect((await gate("/agents/email-agent/", "owner")).status).toBe(404);
	});

	it.each(["owner", "sender"])("lets %s past the gate", async (who) => {
		const result = await gate(AGENT_PATH, who);
		// Past the gate the request reaches the agent runtime, which does not answer with the
		// gate's JSON errors.
		expect(result.error).not.toBe("Unauthorized");
		expect(result.error).not.toBe("Forbidden");
		expect(result.error).not.toBe("Not found");
	});
});

describe("MCP", () => {
	it("needs a session", async () => {
		expect((await gate("/mcp")).status).toBe(401);
	});

	it.each(["admin", "sender", "reader", "outsider"])("is refused to %s", async (who) => {
		expect(await gate("/mcp", who)).toEqual({ status: 403, error: "Forbidden" });
		expect((await gate("/mcp/anything", who)).status).toBe(403);
	});

	it("lets the instance owner past the gate", async () => {
		const result = await gate("/mcp", "owner");
		expect([401, 403]).not.toContain(result.status);
	});
});
