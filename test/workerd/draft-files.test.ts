/**
 * Tier 3: a draft keeps its id and its files (ADR-0011; rules S1, S5, S13).
 *
 * - a draft is saved in place, and only a draft is: a message anywhere else is never changed;
 * - a file is declared, then its bytes arrive; until then it is not part of the draft;
 * - the limits of a message hold for a draft, and are checked before a byte travels;
 * - a reader is refused, someone without a membership is told nothing, and a file of another
 *   draft does not exist here;
 * - a forward's files are copied inside the account, a risky one only when the person agreed;
 * - sending names the draft: its row becomes the message that waits and then is sent, and
 *   its files keep their keys;
 * - deleting leaves nothing behind in the bucket.
 */
import { env, runInDurableObject } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import {
	MAX_ATTACHMENTS,
	MAX_ATTACHMENTS_BYTES,
} from "../../modules/mail/shared/sending-limits.ts";
import {
	Browser,
	createMailbox,
	json,
	migrate,
	seedMembership,
	seedUser,
	setupOwner,
	testEnv,
} from "./helpers.ts";
import { letLeave } from "./sending-helpers.ts";

const MAILBOX = "writer@example.com";
const M = `/api/v1/mailboxes/${encodeURIComponent(MAILBOX)}`;
const bucket = (env as unknown as { BUCKET: R2Bucket }).BUCKET;

interface Shown {
	id: string;
	filename: string;
	type: string;
	size: number;
}
interface Message {
	id: string;
	subject: string;
	folder_id: string;
	body: string;
	attachments: { id: string; filename: string; size: number }[];
}

const browsers: Record<string, Browser> = {};
const as = (who: string) => browsers[who] as Browser;
const put = (who: string, path: string, body: BodyInit, headers: Record<string, string> = {}) =>
	as(who).fetch(path, { method: "PUT", body, headers });
const remove = (who: string, path: string) => as(who).fetch(path, { method: "DELETE" });

function inMailbox<T>(run: (sql: SqlStorage) => T) {
	const stub = testEnv.MAILBOX.get(testEnv.MAILBOX.idFromName(MAILBOX));
	return runInDurableObject(stub, (_object, state) => run(state.storage.sql));
}

async function draft(subject = "A draft"): Promise<string> {
	const res = await as("owner").post(`${M}/drafts`, {
		to: "to@elsewhere.test",
		subject,
		body: "<p>x</p>",
	});
	expect(res.status).toBe(201);
	return (await json<{ id: string }>(res)).id;
}
const declare = (who: string, draftId: string, file: Record<string, unknown>) =>
	as(who).post(`${M}/drafts/${draftId}/attachments`, file);
/** Declares a file and sends its bytes. */
async function attach(draftId: string, filename: string, content: string, type = "text/plain") {
	const declared = await declare("owner", draftId, { filename, type, size: content.length });
	expect(declared.status, filename).toBe(201);
	const file = await json<Shown>(declared);
	const stored = await put("owner", `${M}/drafts/${draftId}/attachments/${file.id}`, content);
	expect(stored.status, filename).toBe(200);
	return file;
}
const read = async (id: string) => json<Message>(await as("owner").fetch(`${M}/emails/${id}`));
const keys = async (messageId: string) =>
	(await bucket.list({ prefix: `attachments/${messageId}/` })).objects.map((object) => object.key);

beforeAll(async () => {
	await migrate();
	expect((await setupOwner()).status).toBe(201);
	browsers.owner = new Browser();
	expect((await as("owner").signIn("owner@example.com")).status).toBe(200);
	expect((await createMailbox(as("owner").cookie, MAILBOX)).status).toBe(201);
	const reader = await seedUser("reader@example.com", "member");
	await seedUser("outsider@example.com", "member");
	await seedMembership(MAILBOX, reader, "reader");
	for (const who of ["reader", "outsider"]) {
		browsers[who] = new Browser();
		expect((await as(who).signIn(`${who}@example.com`)).status).toBe(200);
	}
	// A received message with two files, one of a kind that can do harm.
	await inMailbox((sql) => {
		sql.exec(
			`INSERT INTO emails (id, folder_id, subject, sender, recipient, date, body) VALUES ('received', 'inbox', 'With files', 'ada@sender.test', ?, ?, 'x')`,
			MAILBOX,
			new Date().toISOString(),
		);
		sql.exec(
			`INSERT INTO attachments (id, email_id, filename, mimetype, size) VALUES ('plain', 'received', 'report.txt', 'text/plain', 6), ('risky', 'received', 'run.html', 'text/html', 9)`,
		);
	});
	await bucket.put("attachments/received/plain/report.txt", "report");
	await bucket.put("attachments/received/risky/run.html", "<b>hi</b>");
});

describe("a draft keeps its id", () => {
	it("is saved in place, and only a draft is", async () => {
		const id = await draft("First words");
		const saved = await put(
			"owner",
			`${M}/drafts/${id}`,
			JSON.stringify({ to: "to@elsewhere.test", subject: "Second words", body: "<p>y</p>" }),
		);
		expect(saved.status).toBe(200);
		expect((await json<{ id: string }>(saved)).id).toBe(id);
		const now = await read(id);
		expect([now.subject, now.body, now.folder_id]).toEqual(["Second words", "<p>y</p>", "draft"]);

		// A message that is not a draft is never saved over, and neither is nothing.
		const over = JSON.stringify({ subject: "Overwritten", body: "gone" });
		expect((await put("owner", `${M}/drafts/received`, over)).status).toBe(404);
		expect((await read("received")).subject).toBe("With files");
		expect((await put("owner", `${M}/drafts/no-such-draft`, over)).status).toBe(404);
	});
});

describe("a file of a draft", () => {
	it("is declared, then stored, and is part of the draft only once its bytes are there", async () => {
		const id = await draft();
		const declared = await declare("owner", id, {
			filename: "notes.txt",
			type: "text/plain",
			size: 5,
		});
		expect(declared.status).toBe(201);
		const file = await json<Shown>(declared);
		expect(file).toMatchObject({ filename: "notes.txt", type: "text/plain", size: 5 });
		expect((await read(id)).attachments).toEqual([]);
		expect(await keys(id)).toEqual([]);

		expect((await put("owner", `${M}/drafts/${id}/attachments/${file.id}`, "hello")).status).toBe(
			200,
		);
		expect((await read(id)).attachments.map((a) => a.filename)).toEqual(["notes.txt"]);
		expect(await keys(id)).toEqual([`attachments/${id}/${file.id}/notes.txt`]);

		// It is served as every attachment is: a download.
		const got = await as("owner").fetch(`${M}/emails/${id}/attachments/${file.id}`);
		expect(got.status).toBe(200);
		expect(await got.text()).toBe("hello");
		expect(got.headers.get("content-disposition")).toMatch(/^attachment/);
		// Its bytes are stored once.
		expect((await put("owner", `${M}/drafts/${id}/attachments/${file.id}`, "again")).status).toBe(
			409,
		);
	});

	it("gets a name that is safe to store, whatever it was called", async () => {
		const id = await draft();
		const file = await attach(id, "../../etc/passwd", "x");
		expect(file.filename).not.toMatch(/[/\\]/);
		expect(await keys(id)).toEqual([`attachments/${id}/${file.id}/${file.filename}`]);
	});

	it("is refused before a byte travels when it is not a file a message can carry", async () => {
		const id = await draft();
		for (const bad of [
			{ type: "text/plain", size: 1 },
			{ filename: "", type: "text/plain", size: 1 },
			{ filename: "a".repeat(256), type: "text/plain", size: 1 },
			{ filename: "a.txt", type: "t".repeat(256), size: 1 },
			{ filename: "a.txt", type: "text/plain", size: 0 },
			{ filename: "a.txt", type: "text/plain", size: 1.5 },
			{ filename: "a.txt", type: "text/plain" },
		]) {
			expect((await declare("owner", id, bad)).status, JSON.stringify(bad).slice(0, 40)).toBe(400);
		}
		const large = await declare("owner", id, {
			filename: "big.bin",
			type: "application/octet-stream",
			size: MAX_ATTACHMENTS_BYTES + 1,
		});
		expect(large.status).toBe(413);
		expect((await json<{ code: string }>(large)).code).toBe("DRAFT_FILES_TOO_LARGE");
		// Together with what the draft holds, too.
		expect(
			(
				await declare("owner", id, {
					filename: "most.bin",
					type: "application/octet-stream",
					size: MAX_ATTACHMENTS_BYTES,
				})
			).status,
		).toBe(201);
		expect(
			(
				await declare("owner", id, {
					filename: "one-more.bin",
					type: "application/octet-stream",
					size: 1,
				})
			).status,
		).toBe(413);
		expect(await keys(id)).toEqual([]);
	});

	it("is one of at most as many as a message carries", async () => {
		const id = await draft();
		for (let n = 0; n < MAX_ATTACHMENTS; n++) {
			expect(
				(await declare("owner", id, { filename: `f${n}.txt`, type: "text/plain", size: 1 })).status,
			).toBe(201);
		}
		const over = await declare("owner", id, { filename: "over.txt", type: "text/plain", size: 1 });
		expect(over.status).toBe(409);
		expect((await json<{ code: string }>(over)).code).toBe("DRAFT_TOO_MANY_FILES");
	});

	it("stores nothing when the bytes are not what was declared", async () => {
		const id = await draft();
		const file = await json<Shown>(
			await declare("owner", id, { filename: "five.txt", type: "text/plain", size: 5 }),
		);
		const path = `${M}/drafts/${id}/attachments/${file.id}`;
		expect((await put("owner", path, "too many bytes")).status).toBe(400);
		expect((await put("owner", path, "few")).status).toBe(400);
		expect(await keys(id)).toEqual([]);
		expect((await read(id)).attachments).toEqual([]);
		// The right bytes are still welcome afterwards.
		expect((await put("owner", path, "right")).status).toBe(200);
	});

	it("is removed with its bytes", async () => {
		const id = await draft();
		const file = await attach(id, "gone.txt", "bye");
		expect((await remove("owner", `${M}/drafts/${id}/attachments/${file.id}`)).status).toBe(204);
		expect((await read(id)).attachments).toEqual([]);
		expect(await keys(id)).toEqual([]);
		expect((await remove("owner", `${M}/drafts/${id}/attachments/${file.id}`)).status).toBe(404);
	});

	it("that never arrived is removed after an hour, the next time the draft's files change", async () => {
		const id = await draft();
		const stale = await json<Shown>(
			await declare("owner", id, { filename: "never.txt", type: "text/plain", size: 3 }),
		);
		const fresh = await json<Shown>(
			await declare("owner", id, { filename: "soon.txt", type: "text/plain", size: 3 }),
		);
		await inMailbox((sql) => {
			sql.exec(
				`UPDATE attachments SET uploading_since = ? WHERE id = ?`,
				new Date(Date.now() - 2 * 3_600_000).toISOString(),
				stale.id,
			);
		});
		await attach(id, "next.txt", "abc");
		const left = await inMailbox((sql) =>
			[...sql.exec(`SELECT id FROM attachments WHERE email_id = ? ORDER BY filename`, id)].map(
				(row) => row.id,
			),
		);
		expect(left).not.toContain(stale.id);
		expect(left).toContain(fresh.id);
	});
});

describe("who may touch a draft's files", () => {
	it("a reader is refused and someone without a membership is told nothing", async () => {
		const id = await draft();
		const file = await attach(id, "mine.txt", "mine");
		const body = JSON.stringify({ subject: "s", body: "b" });
		const tries = (who: string) => [
			put(who, `${M}/drafts/${id}`, body),
			declare(who, id, { filename: "a.txt", type: "text/plain", size: 1 }),
			put(who, `${M}/drafts/${id}/attachments/${file.id}`, "mine"),
			remove(who, `${M}/drafts/${id}/attachments/${file.id}`),
			as(who).post(`${M}/drafts/${id}/attachments/copy`, {
				emailId: "received",
				attachmentIds: ["plain"],
			}),
		];
		for (const res of await Promise.all(tries("reader"))) expect(res.status).toBe(403);
		for (const res of await Promise.all(tries("outsider"))) expect(res.status).toBe(404);
		// A reader reads the file, as a reader reads the draft.
		expect((await as("reader").fetch(`${M}/emails/${id}/attachments/${file.id}`)).status).toBe(200);
		expect((await read(id)).attachments).toHaveLength(1);
	});

	it("a file of another draft does not exist under this one", async () => {
		const mine = await draft();
		const other = await draft();
		const file = await attach(other, "theirs.txt", "theirs");
		expect(
			(await put("owner", `${M}/drafts/${mine}/attachments/${file.id}`, "theirs")).status,
		).toBe(404);
		expect((await remove("owner", `${M}/drafts/${mine}/attachments/${file.id}`)).status).toBe(404);
		// And it is downloaded only under the message it belongs to.
		expect((await as("owner").fetch(`${M}/emails/${mine}/attachments/${file.id}`)).status).toBe(
			404,
		);
		expect((await as("owner").fetch(`${M}/emails/${other}/attachments/${file.id}`)).status).toBe(
			200,
		);
		// A message that is not a draft takes no files.
		expect(
			(await declare("owner", "received", { filename: "a.txt", type: "text/plain", size: 1 }))
				.status,
		).toBe(404);
	});
});

describe("a forward's files", () => {
	it("are copied inside the account, a risky one only when the person agreed", async () => {
		const id = await draft("Fwd: With files");
		const first = await as("owner").post(`${M}/drafts/${id}/attachments/copy`, {
			emailId: "received",
			attachmentIds: ["plain", "risky", "nothing"],
		});
		expect(first.status).toBe(200);
		const answer = await json<{ copied: Shown[]; left: { id: string; reason: string }[] }>(first);
		expect(answer.copied.map((f) => [f.filename, f.type, f.size])).toEqual([
			["report.txt", "text/plain", 6],
		]);
		expect(answer.left).toEqual([
			{ id: "risky", reason: "risk" },
			{ id: "nothing", reason: "missing" },
		]);
		const copy = answer.copied[0] as Shown;
		expect(await (await as("owner").fetch(`${M}/emails/${id}/attachments/${copy.id}`)).text()).toBe(
			"report",
		);

		const agreed = await as("owner").post(`${M}/drafts/${id}/attachments/copy`, {
			emailId: "received",
			attachmentIds: ["risky"],
			acknowledged: true,
		});
		expect((await json<{ copied: Shown[] }>(agreed)).copied.map((f) => f.filename)).toEqual([
			"run.html",
		]);
		// The copy is served like the original: never as a page.
		const risky = (await read(id)).attachments.find((a) => a.filename === "run.html");
		expect((await as("owner").fetch(`${M}/emails/${id}/attachments/${risky?.id}`)).status).toBe(
			409,
		);
		// A file is copied only from the message that is named.
		const wrong = await as("owner").post(`${M}/drafts/${id}/attachments/copy`, {
			emailId: id,
			attachmentIds: ["plain"],
		});
		expect((await json<{ left: unknown[] }>(wrong)).left).toEqual([
			{ id: "plain", reason: "missing" },
		]);
	});
});

describe("sending a draft", () => {
	const send = (body: Record<string, unknown>) =>
		as("owner").post(`${M}/emails`, {
			to: "to@elsewhere.test",
			from: MAILBOX,
			subject: "Sent with files",
			html: "<p>Here they are</p>",
			...body,
		});

	it("makes the draft the sent message: same id, same files, nothing left in Drafts", async () => {
		const id = await draft("Being written");
		const one = await attach(id, "one.txt", "first");
		const two = await attach(id, "two.txt", "second");
		const never = await json<Shown>(
			await declare("owner", id, { filename: "never.txt", type: "text/plain", size: 9 }),
		);

		const sent = await send({ draft_id: id });
		expect(sent.status).toBe(202);
		expect((await json<{ id: string }>(sent)).id).toBe(id);
		// The draft's row is the message from the press on: it waits in Scheduled with its
		// files, and is in Sent when it has left (ADR-0016).
		expect((await read(id)).folder_id).toBe("scheduled");
		expect((await keys(id)).length).toBe(2);
		await letLeave(MAILBOX);

		const message = await read(id);
		expect([message.folder_id, message.subject]).toEqual(["sent", "Sent with files"]);
		expect(message.attachments.map((a) => a.filename).sort()).toEqual(["one.txt", "two.txt"]);
		expect((await keys(id)).sort()).toEqual(
			[`attachments/${id}/${one.id}/one.txt`, `attachments/${id}/${two.id}/two.txt`].sort(),
		);
		const rows = await inMailbox((sql) =>
			[...sql.exec(`SELECT id FROM attachments WHERE email_id = ?`, id)].map((row) => row.id),
		);
		expect(rows).not.toContain(never.id);
		// It is a sent message now: it is not saved over and takes no more files.
		expect(
			(await put("owner", `${M}/drafts/${id}`, JSON.stringify({ subject: "x", body: "y" }))).status,
		).toBe(404);
		expect(
			(await declare("owner", id, { filename: "late.txt", type: "text/plain", size: 1 })).status,
		).toBe(404);
	});

	it("names a draft of this mailbox, or nothing is sent", async () => {
		expect((await send({ draft_id: "received" })).status).toBe(404);
		expect((await send({ draft_id: "no-such-draft" })).status).toBe(404);
		expect((await read("received")).folder_id).toBe("inbox");
		// A message without files needs no draft.
		expect((await send({})).status).toBe(202);
	});
});

describe("deleting", () => {
	it("a draft takes its files with it, stored or not", async () => {
		const id = await draft();
		await attach(id, "kept-until-now.txt", "bytes");
		await declare("owner", id, { filename: "pending.txt", type: "text/plain", size: 4 });
		expect(await keys(id)).toHaveLength(1);
		expect((await remove("owner", `${M}/emails/${id}`)).status).toBe(204);
		expect(await keys(id)).toEqual([]);
		const rows = await inMailbox(
			(sql) => [...sql.exec(`SELECT 1 FROM attachments WHERE email_id = ?`, id)].length,
		);
		expect(rows).toBe(0);
	});
});
