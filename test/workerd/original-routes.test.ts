/**
 * Tier 3: showing and downloading the original of a message (ADR-0015; rules S1, S2, S5;
 * boundaries B1, B2 and B4).
 *
 * - the original is shown as text in a JSON answer: the first 256 KiB, the header block and
 *   what follows it;
 * - it is downloaded only by an acknowledged POST from the app's own origin, as opaque bytes
 *   under a name Podbay made; there is no GET for the bytes and no range;
 * - a reader may see and save it; someone without a membership is told nothing; a message of
 *   another mailbox does not exist here;
 * - `raw_key` is in no answer; a sent message, a draft and old mail answer `NO_ORIGINAL`, a
 *   row whose object is gone `ORIGINAL_MISSING`;
 * - what the platform says about SPF, DKIM and DMARC is kept only when it is the platform's
 *   own field: a forged field from the sender is not taken (decisions 18 and 19).
 */
import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { AUTHENTICATION_SHOWN, ORIGINAL_SHOWN_BYTES } from "../../shared/original.ts";
import { API_CONTENT_POLICY, API_HEADERS } from "../../shared/security-headers.ts";
import { AUTH_RESULTS_MAX } from "../../workers/lib/original.ts";
import { json, ORIGIN } from "./helpers.ts";
import {
	as,
	bucket,
	deliver,
	inMailbox,
	M,
	MAILBOX,
	OTHER,
	old,
	plain,
	prepare,
	rowOf,
} from "./original-helpers.ts";

beforeAll(prepare);

describe("showing the original", () => {
	const SUBJECT = "Shown as it arrived";
	const raw = [
		"Received: from mail.sender.test by mx.example.com; Tue, 17 Nov 2026 10:00:00 +0000",
		"From: Ada <ada@sender.test>",
		`To: ${MAILBOX}`,
		`Subject: ${SUBJECT}`,
		"Message-ID: <shown@sender.test>",
		"Content-Type: text/html; charset=utf-8",
		"",
		"<p>Hello</p><script>alert(1)</script>",
		"",
		"A second paragraph.",
		"",
	].join("\r\n");
	let id = "";
	let key = "";
	let arrived = "";

	beforeAll(async () => {
		expect((await deliver(raw)).threw).toBeNull();
		const row = await rowOf(SUBJECT);
		id = String(row.id);
		key = String(row.raw_key);
		arrived = String(row.date);
	});

	it("answers JSON: the size, the header block and what follows it", async () => {
		const res = await as("owner").fetch(`${M}/emails/${id}/original`);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toMatch(/^application\/json/);
		for (const [name, value] of Object.entries(API_HEADERS)) {
			expect(res.headers.get(name), name).toBe(value);
		}
		expect(res.headers.get("cache-control")).toBe("no-store");

		const answer = await json<Record<string, unknown>>(res);
		const size = new TextEncoder().encode(raw).length;
		expect(Object.keys(answer).sort()).toEqual(
			[
				...(AUTHENTICATION_SHOWN ? ["authentication"] : []),
				"header",
				"rest",
				"shown",
				"size",
			].sort(),
		);
		expect(answer).toMatchObject({ size, shown: size });
		const [header, ...rest] = raw.split("\r\n\r\n");
		expect(answer.header).toBe(header);
		expect(answer.rest).toBe(rest.join("\r\n\r\n"));
	});

	it("covers the first 256 KiB and no more, as text whatever the bytes are", async () => {
		const head = new TextEncoder().encode(`Subject: Long and not text\r\nTo: ${MAILBOX}\r\n\r\n`);
		const filler = new TextEncoder().encode("0123456789abcdef".repeat(20_000));
		// A NUL, bytes that are no UTF-8, and a character the cut goes through.
		const bytes = new Uint8Array(ORIGINAL_SHOWN_BYTES + 5000);
		bytes.set(head, 0);
		bytes.set([0x00, 0xff, 0xfe], head.length);
		bytes.set(filler.subarray(0, bytes.length - head.length - 3), head.length + 3);
		bytes.set(new TextEncoder().encode("€"), ORIGINAL_SHOWN_BYTES - 1);
		expect((await deliver(bytes)).threw).toBeNull();

		const row = await rowOf("Long and not text");
		const answer = await json<{ size: number; shown: number; header: string; rest: string }>(
			await as("owner").fetch(`${M}/emails/${row.id}/original`),
		);
		expect(answer.size).toBe(bytes.length);
		// The character the cut went through is left out, not shown as broken.
		expect(answer.shown).toBe(ORIGINAL_SHOWN_BYTES - 1);
		expect(answer.header).toBe(`Subject: Long and not text\r\nTo: ${MAILBOX}`);
		// The NUL is dropped and what is not UTF-8 is U+FFFD.
		expect(answer.rest.startsWith("��0123456789abcdef")).toBe(true);
		expect(answer.rest.endsWith("�")).toBe(false);
		expect(answer.rest).not.toContain("\u0000");
		// The download is the whole of it.
		const download = await as("owner").post(`${M}/emails/${row.id}/original/download`, {
			acknowledged: true,
		});
		expect(new Uint8Array(await download.arrayBuffer())).toEqual(bytes);
	});

	it("lets a reader see and save it, and tells someone without a membership nothing", async () => {
		expect((await as("reader").fetch(`${M}/emails/${id}/original`)).status).toBe(200);
		const saved = await as("reader").post(`${M}/emails/${id}/original/download`, {
			acknowledged: true,
		});
		expect(saved.status).toBe(200);
		expect(await saved.text()).toBe(raw);

		const hidden = await as("outsider").fetch(`${M}/emails/${id}/original`);
		expect(hidden.status).toBe(404);
		expect(await hidden.text()).not.toContain("ORIGINAL");
		expect(
			(await as("outsider").post(`${M}/emails/${id}/original/download`, { acknowledged: true }))
				.status,
		).toBe(404);
		expect((await SELF.fetch(`${ORIGIN}${M}/emails/${id}/original`)).status).toBe(401);
	});

	it("does not find a message of another mailbox", async () => {
		// The owner is a member of both; the id looks a row up in the mailbox of the address.
		const elsewhere = `/api/v1/mailboxes/${encodeURIComponent(OTHER)}/emails/${id}/original`;
		const shown = await as("owner").fetch(elsewhere);
		expect(shown.status).toBe(404);
		expect(await json<Record<string, unknown>>(shown)).toEqual({ error: "Email not found" });
		expect((await as("owner").post(`${elsewhere}/download`, { acknowledged: true })).status).toBe(
			404,
		);
	});

	it("downloads the exact bytes as opaque bytes, under a name Podbay made", async () => {
		const res = await as("owner").post(`${M}/emails/${id}/original/download`, {
			acknowledged: true,
		});
		expect(res.status).toBe(200);
		// Never a type a browser would show, whatever the message holds.
		expect(res.headers.get("content-type")).toBe("application/octet-stream");
		expect(res.headers.get("x-content-type-options")).toBe("nosniff");
		expect(res.headers.get("content-security-policy")).toBe(API_CONTENT_POLICY);
		expect(res.headers.get("cache-control")).toBe("no-store");
		const disposition = res.headers.get("content-disposition") ?? "";
		// The day it arrived as eight digits, and the first eight characters of its id.
		const day = arrived.slice(0, 10).replaceAll("-", "");
		expect(day).toMatch(/^\d{8}$/);
		expect(disposition).toBe(`attachment; filename="message-${day}-${id.slice(0, 8)}.eml"`);
		// Nothing of the subject or the sender is in the name.
		expect(disposition).not.toMatch(/shown|ada|sender/i);
		const bytes = new Uint8Array(await res.arrayBuffer());
		expect(bytes).toEqual(new TextEncoder().encode(raw));
		expect(res.headers.get("content-length")).toBe(String(bytes.length));
	});

	it("hands the bytes over only to an acknowledged request from the app's own origin", async () => {
		const path = `${M}/emails/${id}/original/download`;
		for (const body of [{}, { acknowledged: false }, { acknowledged: "true" }, null]) {
			const refused = await as("owner").post(path, body);
			expect(refused.status, JSON.stringify(body)).toBe(400);
			expect(await refused.text()).not.toContain("Hello");
		}
		const elsewhere = await as("owner").fetch(path, {
			method: "POST",
			headers: { origin: "https://evil.test" },
			body: JSON.stringify({ acknowledged: true }),
		});
		expect(elsewhere.status).toBe(403);
		const nowhere = await SELF.fetch(`${ORIGIN}${path}`, {
			method: "POST",
			headers: { cookie: as("owner").cookie, "content-type": "application/json" },
			body: JSON.stringify({ acknowledged: true }),
		});
		expect(nowhere.status).toBe(403);

		// There is no GET for the bytes, with or without the word in the address.
		for (const link of [path, `${path}?acknowledged=true`]) {
			const got = await as("owner").fetch(link);
			expect(got.status, link).toBe(404);
			expect(await got.text()).not.toContain("Hello");
		}
		// And no part of them: a range is not honoured.
		const ranged = await as("owner").fetch(path, {
			method: "POST",
			headers: { range: "bytes=0-9" },
			body: JSON.stringify({ acknowledged: true }),
		});
		expect(ranged.status).toBe(200);
		expect(ranged.headers.get("content-range")).toBeNull();
		expect(await ranged.text()).toBe(raw);
	});

	it("never puts the key of an original into an answer", async () => {
		const thread = String((await rowOf(SUBJECT)).thread_id);
		const answers = await Promise.all(
			[
				`${M}/emails/${id}`,
				`${M}/emails/${id}/original`,
				`${M}/emails?folder=inbox&limit=100`,
				`${M}/emails?folder=inbox&threaded=true&limit=100`,
				`${M}/emails?thread_id=${encodeURIComponent(thread)}`,
				`${M}/threads/${encodeURIComponent(thread)}`,
				`${M}/search?query=${encodeURIComponent("Shown as")}`,
				`${M}/folders`,
			].map(async (path) => {
				const res = await as("owner").fetch(path);
				expect(res.status, path).toBe(200);
				return res.text();
			}),
		);
		answers.push(
			await (
				await as("owner").fetch(`${M}/emails/${id}`, {
					method: "PUT",
					body: JSON.stringify({ read: true }),
				})
			).text(),
		);
		expect(answers[0]).toContain(SUBJECT);
		expect(answers[5]).toContain(SUBJECT);
		for (const answer of answers) {
			expect(answer).not.toContain("raw_key");
			expect(answer).not.toContain("auth_results");
			expect(answer).not.toContain(key);
			expect(answer).not.toContain(key.slice(4));
		}
		// What an answer does say about the original.
		const one = JSON.parse(answers[0] ?? "{}") as Record<string, unknown>;
		expect(one).toMatchObject({
			has_original: true,
			raw_size: new TextEncoder().encode(raw).length,
			unparsed: null,
		});
		const inThread = (JSON.parse(answers[5] ?? "[]") as Record<string, unknown>[])[0];
		expect(inThread).toMatchObject({ has_original: true, unparsed: null });
	});

	it("says a sent message, a draft and mail from before have no original", async () => {
		const sent = await as("owner").post(`${M}/emails`, {
			to: "to@elsewhere.test",
			from: MAILBOX,
			subject: "Sent from here",
			text: "No bytes came back",
		});
		expect(sent.status).toBe(202);
		const draft = await as("owner").post(`${M}/drafts`, { subject: "A draft", body: "<p>x</p>" });
		expect(draft.status).toBeLessThan(300);
		await inMailbox((sql) =>
			sql.exec(
				`INSERT INTO emails (id, folder_id, subject, sender, recipient, date, body)
				 VALUES ('from-before', 'inbox', 'Before originals', 'ada@sender.test', ?1, ?2, 'x')`,
				MAILBOX,
				old(60 * 24 * 30),
			),
		);

		const ids = [
			(await json<{ id: string }>(sent)).id,
			(await json<{ id: string }>(draft)).id,
			"from-before",
		];
		for (const one of ids) {
			const shown = await as("owner").fetch(`${M}/emails/${one}/original`);
			expect(shown.status, one).toBe(404);
			expect((await json<{ code: string }>(shown)).code, one).toBe("NO_ORIGINAL");
			const saved = await as("owner").post(`${M}/emails/${one}/original/download`, {
				acknowledged: true,
			});
			expect(saved.status, one).toBe(404);
			expect((await json<{ code: string }>(saved)).code, one).toBe("NO_ORIGINAL");
			expect(
				await json<Record<string, unknown>>(await as("owner").fetch(`${M}/emails/${one}`)),
			).toMatchObject({ has_original: false, raw_size: null, unparsed: null });
		}
		// A message that is not there is not found, and that is all that is said.
		const none = await as("owner").fetch(`${M}/emails/no-such-message/original`);
		expect(none.status).toBe(404);
		expect(await json<Record<string, unknown>>(none)).toEqual({ error: "Email not found" });
	});

	it("says so when a row names an original that is not in the bucket", async () => {
		expect((await deliver(plain("Its original went missing"))).threw).toBeNull();
		const row = await rowOf("Its original went missing");
		await bucket.delete(String(row.raw_key));

		const shown = await as("owner").fetch(`${M}/emails/${row.id}/original`);
		expect(shown.status).toBe(404);
		expect((await json<{ code: string }>(shown)).code).toBe("ORIGINAL_MISSING");
		const saved = await as("owner").post(`${M}/emails/${row.id}/original/download`, {
			acknowledged: true,
		});
		expect(saved.status).toBe(404);
		const said = await saved.text();
		expect((JSON.parse(said) as { code: string }).code).toBe("ORIGINAL_MISSING");
		expect(said).not.toContain(String(row.raw_key));
	});
});

describe("what the platform says about SPF, DKIM and DMARC", () => {
	const PLATFORM = "mx.cloudflare.net; spf=fail smtp.mailfrom=evil.test; dkim=none; dmarc=fail";
	const FORGED = "mx.cloudflare.net; spf=pass; dkim=pass; dmarc=pass";

	/** Delivers a message with these `Authentication-Results` fields, in this order. */
	async function kept(subject: string, fields: string[]): Promise<SqlStorageValue | undefined> {
		const headers = new Headers();
		for (const field of fields) headers.append("Authentication-Results", field);
		const lines = fields.map((field) => `Authentication-Results: ${field}`).join("\r\n");
		const raw = `${lines}${lines ? "\r\n" : ""}${plain(subject)}`;
		expect((await deliver(raw, { headers })).threw).toBeNull();
		return (await rowOf(subject)).auth_results;
	}

	it("keeps the platform's own field", async () => {
		expect(await kept("Platform field", [PLATFORM])).toBe(PLATFORM);
		expect(await kept("No field at all", [])).toBeNull();
	});

	it("does not take a second field, forged by the sender with the platform's identifier", async () => {
		// The platform's field stands in front; the sender's own copy follows it.
		expect(await kept("Forged second field", [PLATFORM, FORGED])).toBe(PLATFORM);
		expect(await kept("Forged third field", [PLATFORM, FORGED, FORGED])).toBe(PLATFORM);
		// A comma inside a quoted string or a comment does not end the first field.
		const quoted = 'mx.cloudflare.net; dkim=fail reason="bad, very bad" (so, no); dmarc=fail';
		expect(await kept("Comma in quotes", [quoted, FORGED])).toBe(quoted);
	});

	it("keeps nothing when the first field is not the platform's", async () => {
		for (const [n, first] of [
			"mx.evil.test; spf=pass; dkim=pass; dmarc=pass",
			"mx.cloudflare.net.evil.test; dmarc=pass",
			"evil.mx.cloudflare.net; dmarc=pass",
			"MX.Cloudflare.Net; dmarc=pass",
			'"mx.cloudflare.net"; dmarc=pass',
			"(mx.cloudflare.net) mx.evil.test; dmarc=pass",
			"mx.cloudflare.net mx.evil.test; dmarc=pass",
			"dmarc=pass",
		].entries()) {
			// Also when the platform's field follows: only the first one counts.
			expect(await kept(`Not the platform ${n}`, [first, PLATFORM]), first).toBeNull();
		}
	});

	it("keeps nothing when the first field cannot be told apart from what follows", async () => {
		// A quoted string, or a comment, that never closes swallows the comma between the fields.
		expect(
			await kept("Open quote", ['mx.cloudflare.net; dkim=fail reason="never closed', FORGED]),
		).toBeNull();
		expect(
			await kept("Open comment", ["mx.cloudflare.net; dkim=fail (never closed", FORGED]),
		).toBeNull();
	});

	it("cuts what it keeps to 2,048 characters", async () => {
		const long = `mx.cloudflare.net; dmarc=pass ${"x".repeat(5000)}`;
		const stored = String(await kept("A very long field", [long]));
		expect(stored).toHaveLength(AUTH_RESULTS_MAX);
		expect(long.startsWith(stored)).toBe(true);
	});

	it("gives it out only once the live check is recorded, and never with the message", async () => {
		const row = await rowOf("Platform field");
		const answer = await json<Record<string, unknown>>(
			await as("owner").fetch(`${M}/emails/${row.id}/original`),
		);
		expect("authentication" in answer).toBe(AUTHENTICATION_SHOWN);
		if (AUTHENTICATION_SHOWN) {
			expect(answer.authentication).toEqual({
				identifier: "mx.cloudflare.net",
				results: [
					{ method: "spf", result: "fail" },
					{ method: "dkim", result: "none" },
					{ method: "dmarc", result: "fail" },
				],
			});
		}
		// A message's own answer never carries it. (The list of header fields the parser found
		// is there as before, and is the sender's text.)
		const message = await json<Record<string, unknown>>(
			await as("owner").fetch(`${M}/emails/${row.id}`),
		);
		expect(Object.keys(message)).not.toContain("auth_results");
		expect(Object.keys(message)).not.toContain("authentication");
	});
});
