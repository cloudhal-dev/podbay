/**
 * Tier 3: attachments are downloads (rule S5).
 *
 * - every attachment leaves with `Content-Disposition: attachment`, `nosniff`, a type the sender
 *   did not choose, and a content policy that sandboxes it;
 * - one that can do harm when opened is refused to a plain link and handed over only to a POST
 *   from the app's own origin that says the reader asked for it;
 * - the mailbox rules hold as for mail: a reader may download, a non-member is told nothing.
 */
import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { API_CONTENT_POLICY } from "../../shared/security-headers.ts";
import worker from "../../workers/app.ts";
import {
	Browser,
	createMailbox,
	inbound,
	migrate,
	ORIGIN,
	request,
	seedMembership,
	seedUser,
	setupOwner,
} from "./helpers.ts";

const MAILBOX = "files@example.com";
const M = `/api/v1/mailboxes/${encodeURIComponent(MAILBOX)}`;

interface Part {
	filename: string;
	type: string;
	content: string;
}

/** What the message carries. `kind` is the risk the Worker must see, or null for none. */
const PARTS: (Part & { kind: string | null; served: string })[] = [
	{
		filename: "note.txt",
		type: "text/plain",
		content: "plain words",
		kind: null,
		served: "text/plain; charset=utf-8",
	},
	{
		filename: "photo.png",
		type: "image/png",
		content: "PNG, not really",
		kind: null,
		served: "image/png",
	},
	{
		filename: "report.pdf",
		type: "application/pdf",
		content: "%PDF-1.7",
		kind: null,
		served: "application/pdf",
	},
	{
		filename: "sheet.xlsx",
		type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		content: "PK",
		kind: null,
		served: "application/octet-stream",
	},
	{
		filename: "page.html",
		type: "text/html",
		content: "<script>alert(1)</script>",
		kind: "active",
		served: "application/octet-stream",
	},
	{
		filename: "logo.svg",
		type: "image/svg+xml",
		content: "<svg onload=alert(1)>",
		kind: "active",
		served: "application/octet-stream",
	},
	{
		filename: "setup.exe",
		type: "application/octet-stream",
		content: "MZ",
		kind: "program",
		served: "application/octet-stream",
	},
	{
		filename: "run.ps1",
		type: "text/plain",
		content: "Remove-Item",
		kind: "script",
		served: "application/octet-stream",
	},
	{
		filename: "report.docm",
		type: "application/msword",
		content: "PK",
		kind: "macro",
		served: "application/octet-stream",
	},
	{
		filename: "bundle.zip",
		type: "application/zip",
		content: "PK",
		kind: "container",
		served: "application/octet-stream",
	},
	{
		filename: "link.lnk",
		type: "application/octet-stream",
		content: "shortcut-bytes",
		kind: "shortcut",
		served: "application/octet-stream",
	},
	// The name says one thing and the type another.
	{
		filename: "invoice.pdf",
		type: "text/html",
		content: "<script>alert(2)</script>",
		kind: "active",
		served: "application/octet-stream",
	},
];

function message(parts: Part[]): string {
	const boundary = "b-files";
	const lines = [
		"From: ada@sender.test",
		`To: ${MAILBOX}`,
		"Subject: Files",
		"Message-ID: <files-1@sender.test>",
		"MIME-Version: 1.0",
		`Content-Type: multipart/mixed; boundary="${boundary}"`,
		"",
		`--${boundary}`,
		"Content-Type: text/plain; charset=utf-8",
		"",
		"See attached.",
	];
	for (const part of parts) {
		lines.push(
			`--${boundary}`,
			`Content-Type: ${part.type}; name="${part.filename}"`,
			`Content-Disposition: attachment; filename="${part.filename}"`,
			"Content-Transfer-Encoding: base64",
			"",
			btoa(part.content),
		);
	}
	lines.push(`--${boundary}--`, "");
	return lines.join("\r\n");
}

const browsers: Record<string, Browser> = {};
const urls = new Map<string, string>();
const url = (filename: string) => urls.get(filename) ?? "";
const acknowledge = (who: string, filename: string, body: unknown = { acknowledged: true }) =>
	(browsers[who] as Browser).post(`${url(filename)}/download`, body);

beforeAll(async () => {
	await migrate();
	expect((await setupOwner()).status).toBe(201);
	browsers.owner = new Browser();
	expect((await browsers.owner.signIn("owner@example.com")).status).toBe(200);
	expect((await createMailbox(browsers.owner.cookie, MAILBOX)).status).toBe(201);
	const reader = await seedUser("reader@example.com", "member");
	await seedUser("outsider@example.com", "member");
	await seedMembership(MAILBOX, reader, "reader");
	for (const who of ["reader", "outsider"]) {
		browsers[who] = new Browser();
		expect((await browsers[who].signIn(`${who}@example.com`)).status).toBe(200);
	}

	const { message: mail, rejections } = inbound(MAILBOX, message(PARTS));
	const ctx = createExecutionContext();
	await worker.email(mail, env, ctx);
	await waitOnExecutionContext(ctx);
	expect(rejections).toEqual([]);

	const list = (await (await browsers.owner.fetch(`${M}/emails?folder=inbox`)).json()) as {
		emails: { id: string }[];
	};
	const emailId = list.emails[0]?.id ?? "";
	const email = (await (await browsers.owner.fetch(`${M}/emails/${emailId}`)).json()) as {
		attachments: { id: string; filename: string }[];
	};
	expect(email.attachments.map((a) => a.filename).sort()).toEqual(
		PARTS.map((p) => p.filename).sort(),
	);
	for (const a of email.attachments)
		urls.set(a.filename, `${M}/emails/${emailId}/attachments/${a.id}`);
});

describe("an attachment that cannot run anything", () => {
	it.each(PARTS.filter((p) => p.kind === null))(
		"$filename is a download with a type the sender did not choose",
		async (part) => {
			const res = await (browsers.owner as Browser).fetch(url(part.filename));
			expect(res.status).toBe(200);
			expect(res.headers.get("content-type")).toBe(part.served);
			expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="/);
			expect(res.headers.get("x-content-type-options")).toBe("nosniff");
			expect(res.headers.get("content-security-policy")).toBe(API_CONTENT_POLICY);
			expect(res.headers.get("cross-origin-resource-policy")).toBe("same-origin");
			expect(res.headers.get("cache-control")).toBe("no-store");
			expect(await res.text()).toBe(part.content);
		},
	);
});

describe("an attachment that can do harm when opened", () => {
	it.each(PARTS.filter((p) => p.kind !== null))(
		"$filename ($kind) is refused to a plain link",
		async (part) => {
			const res = await (browsers.owner as Browser).fetch(url(part.filename));
			expect(res.status).toBe(409);
			const body = (await res.json()) as { code: string; risk: { kind: string; reason: string } };
			expect(body.code).toBe("ATTACHMENT_NEEDS_ACKNOWLEDGEMENT");
			expect(body.risk.kind).toBe(part.kind);
			expect(body.risk.reason.length).toBeGreaterThan(20);
			expect(JSON.stringify(body)).not.toContain(part.content);
		},
	);

	it.each(PARTS.filter((p) => p.kind !== null))(
		"$filename is handed over when the reader asks, and still only as a download",
		async (part) => {
			const res = await acknowledge("owner", part.filename);
			expect(res.status).toBe(200);
			expect(res.headers.get("content-type")).toBe("application/octet-stream");
			expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="/);
			expect(res.headers.get("x-content-type-options")).toBe("nosniff");
			expect(res.headers.get("content-security-policy")).toBe(API_CONTENT_POLICY);
			expect(await res.text()).toBe(part.content);
		},
	);

	it("needs the acknowledgement to be said, not implied", async () => {
		expect((await acknowledge("owner", "setup.exe", {})).status).toBe(400);
		expect((await acknowledge("owner", "setup.exe", { acknowledged: false })).status).toBe(400);
		expect((await acknowledge("owner", "setup.exe", { acknowledged: "yes" })).status).toBe(400);
	});

	it("cannot be acknowledged by another site, or by a request that names no origin", async () => {
		const cookie = (browsers.owner as Browser).cookie;
		const body = JSON.stringify({ acknowledged: true });
		const elsewhere = await request(`${url("setup.exe")}/download`, {
			method: "POST",
			cookie,
			headers: { origin: "https://elsewhere.test" },
			body,
		});
		expect(elsewhere.status).toBe(403);
		const noOrigin = await SELF_fetch(`${url("setup.exe")}/download`, cookie, body);
		expect(noOrigin.status).toBe(403);
	});

	it("is not acknowledged by a query string on the link", async () => {
		const res = await (browsers.owner as Browser).fetch(`${url("setup.exe")}?acknowledged=true`);
		expect(res.status).toBe(409);
	});
});

describe("who may download", () => {
	it("a reader may, both kinds", async () => {
		expect((await (browsers.reader as Browser).fetch(url("note.txt"))).status).toBe(200);
		expect((await acknowledge("reader", "setup.exe")).status).toBe(200);
	});

	it("a person who is not a member is told nothing, whatever they ask for", async () => {
		expect((await (browsers.outsider as Browser).fetch(url("note.txt"))).status).toBe(404);
		expect((await (browsers.outsider as Browser).fetch(url("setup.exe"))).status).toBe(404);
		expect((await acknowledge("outsider", "setup.exe")).status).toBe(404);
	});

	it("nobody may without a session", async () => {
		expect((await request(url("note.txt"))).status).toBe(401);
		const res = await request(`${url("setup.exe")}/download`, {
			method: "POST",
			body: JSON.stringify({ acknowledged: true }),
		});
		expect(res.status).toBe(401);
	});

	it("an attachment that does not exist is not found, asked for either way", async () => {
		const missing = url("note.txt").replace(/[^/]+$/, "no-such-attachment");
		expect((await (browsers.owner as Browser).fetch(missing)).status).toBe(404);
		expect(
			(await (browsers.owner as Browser).post(`${missing}/download`, { acknowledged: true }))
				.status,
		).toBe(404);
	});
});

/** A POST with a session but no Origin header at all, as a script outside a browser sends it. */
async function SELF_fetch(path: string, cookie: string, body: string): Promise<Response> {
	const { SELF } = await import("cloudflare:test");
	return SELF.fetch(`${ORIGIN}${path}`, {
		method: "POST",
		headers: { cookie, "content-type": "application/json" },
		body,
	});
}
