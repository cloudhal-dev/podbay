/**
 * Tier 3: inbound mail through the real `email` handler, a real Durable Object and local R2.
 *
 * - a message is filed by its envelope recipient, not by its `To:` header (Bcc and list mail);
 * - a subaddress reaches the base mailbox;
 * - an unknown or malformed recipient is rejected and nothing is stored;
 * - the optional features are off: no agent route, no MCP route.
 */
import { createExecutionContext, env, SELF, waitOnExecutionContext } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../../workers/app.ts";

const ORIGIN = "https://podbay.test";

function inbound(to: string, raw: string) {
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

function mime(headers: Record<string, string>, body = "Hello") {
	const lines = Object.entries({
		"MIME-Version": "1.0",
		"Content-Type": "text/plain; charset=utf-8",
		...headers,
	}).map(([key, value]) => `${key}: ${value}`);
	return `${lines.join("\r\n")}\r\n\r\n${body}\r\n`;
}

async function deliver(to: string, raw: string) {
	const { message, rejections } = inbound(to, raw);
	const ctx = createExecutionContext();
	await worker.email(message, env, ctx);
	await waitOnExecutionContext(ctx);
	return rejections;
}

async function inbox(mailbox: string): Promise<{ subject: string; recipient: string }[]> {
	const res = await SELF.fetch(
		`${ORIGIN}/api/v1/mailboxes/${encodeURIComponent(mailbox)}/emails?folder=inbox`,
	);
	expect(res.status).toBe(200);
	const body = (await res.json()) as { emails: { subject: string; recipient: string }[] };
	return body.emails;
}

async function createMailbox(email: string) {
	const res = await SELF.fetch(`${ORIGIN}/api/v1/mailboxes`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ email, name: email.split("@")[0] }),
	});
	expect(res.status).toBe(201);
}

describe("inbound mail", () => {
	beforeAll(async () => {
		await createMailbox("hello@example.com");
		await createMailbox("orders@example.com");
	});

	it("files a message by its envelope recipient, not by the To header", async () => {
		// Bcc: the header names somebody else entirely.
		const raw = mime({
			From: "Ada <ada@sender.test>",
			To: "Someone Else <else@elsewhere.test>",
			Subject: "Blind copy",
			"Message-ID": "<bcc-1@sender.test>",
		});
		expect(await deliver("orders@example.com", raw)).toEqual([]);

		expect((await inbox("orders@example.com")).map((m) => m.subject)).toContain("Blind copy");
		expect((await inbox("hello@example.com")).map((m) => m.subject)).not.toContain("Blind copy");
	});

	it("does not let the To header pick another mailbox", async () => {
		const raw = mime({
			From: "ada@sender.test",
			To: "hello@example.com",
			Subject: "Header says hello",
			"Message-ID": "<hdr-1@sender.test>",
		});
		expect(await deliver("orders@example.com", raw)).toEqual([]);

		expect((await inbox("orders@example.com")).map((m) => m.subject)).toContain(
			"Header says hello",
		);
		expect((await inbox("hello@example.com")).map((m) => m.subject)).not.toContain(
			"Header says hello",
		);
	});

	it("delivers a message that has no To header at all", async () => {
		const raw = mime({
			From: "ada@sender.test",
			Subject: "No To header",
			"Message-ID": "<n-1@s.test>",
		});
		expect(await deliver("hello@example.com", raw)).toEqual([]);
		const stored = (await inbox("hello@example.com")).find((m) => m.subject === "No To header");
		expect(stored?.recipient).toBe("hello@example.com");
	});

	it("delivers a subaddress to the base mailbox", async () => {
		const raw = mime({ From: "ada@sender.test", To: "hello+news@example.com", Subject: "Tagged" });
		expect(await deliver("Hello+News@example.com", raw)).toEqual([]);
		expect((await inbox("hello@example.com")).map((m) => m.subject)).toContain("Tagged");
	});

	it("rejects a recipient with no mailbox and stores nothing", async () => {
		const raw = mime({ From: "ada@sender.test", To: "hello@example.com", Subject: "For nobody" });
		expect(await deliver("nobody@example.com", raw)).toEqual(["Unknown recipient"]);
		expect((await inbox("hello@example.com")).map((m) => m.subject)).not.toContain("For nobody");
	});

	it("rejects a recipient that is not a plain address", async () => {
		const raw = mime({ From: "ada@sender.test", To: "hello@example.com", Subject: "Traversal" });
		expect(await deliver("../../hello@example.com", raw)).toEqual(["Invalid recipient address"]);
		expect((await inbox("hello@example.com")).map((m) => m.subject)).not.toContain("Traversal");
	});
});

describe("optional features are off by default", () => {
	it("reports both features off", async () => {
		const res = await SELF.fetch(`${ORIGIN}/api/v1/config`);
		const body = (await res.json()) as { features: { agent: boolean; mcp: boolean } };
		expect(body.features).toEqual({ agent: false, mcp: false });
	});

	it.each(["/mcp", "/mcp/anything", "/agents/email-agent/hello@example.com"])(
		"answers 404 on %s",
		async (path) => {
			const res = await SELF.fetch(`${ORIGIN}${path}`, { method: "POST", body: "{}" });
			expect(res.status).toBe(404);
		},
	);
});

describe("API", () => {
	it("answers 404 for a mailbox that does not exist", async () => {
		const res = await SELF.fetch(
			`${ORIGIN}/api/v1/mailboxes/ghost%40example.com/emails?folder=inbox`,
		);
		expect(res.status).toBe(404);
	});
});
