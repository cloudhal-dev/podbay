/**
 * Tier 3: the original message is kept (ADR-0015; rules S2, S3, S13; boundaries B1 and B4).
 *
 * - the bytes that arrived are kept exactly, as one object whose key says nothing and is in
 *   the message's row and nowhere else;
 * - a row comes before the object it names: the arrival's row before the bytes, the
 *   attachment rows before the files;
 * - a message the parser refuses, and one too large for a row, are still messages, with their
 *   originals; the same message delivered twice is two messages;
 * - an arrival that was left half done is finished or removed by the next one;
 * - deleting a message, emptying a place and deleting the mailbox leave no object behind,
 *   and objects go before rows;
 * - the columns and the table come by a migration that rewrites nothing.
 *
 * Showing and downloading an original, and what the platform says about authentication, are
 * in `original-routes.test.ts`.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { MAX_ORIGINAL_BYTES } from "../../shared/original.ts";
import { applyMigrations, mailboxMigrations } from "../../workers/durableObject/migrations.ts";
import { ARRIVAL_STALE_MS, MAX_ROW_BYTES } from "../../workers/durableObject/originals.ts";
import { deleteMessage } from "../../workers/lib/messages.ts";
import { RAW_KEY } from "../../workers/lib/original.ts";
import { Browser, createMailbox, json, testEnv } from "./helpers.ts";
import {
	as,
	bucket,
	count,
	deliver,
	inMailbox,
	keys,
	M,
	MAILBOX,
	old,
	plain,
	prepare,
	rowOf,
	rows,
	stoppedAt,
	stored,
	watchedBucket,
	withFile,
} from "./original-helpers.ts";

beforeAll(prepare);

describe("a message arrives", () => {
	it("keeps the exact bytes that arrived, under a key that says nothing", async () => {
		// Bytes that are not text, a NUL, bare line feeds, and names full of path characters.
		const head = new TextEncoder().encode(
			[
				"From: ../../raw/ada@sender.test",
				`To: ${MAILBOX}`,
				"Subject: ../../attachments/exact bytes",
				"Message-ID: <../../../exact@sender.test>",
				"",
				"",
			].join("\r\n"),
		);
		const raw = new Uint8Array([...head, 0xff, 0xfe, 0x00, 0x0a, 0x80, 0x0d, 0x41, 0x0a]);
		const before = await keys();
		expect(await deliver(raw, { from: "../../raw/ada@sender.test" })).toMatchObject({
			rejections: [],
			threw: null,
		});

		const row = await rowOf("../../attachments/exact bytes");
		expect(String(row.raw_key)).toMatch(RAW_KEY);
		expect(row.raw_size).toBe(raw.length);
		expect(row.unparsed).toBeNull();
		// The key is not the message's id and holds nothing of the message.
		expect(String(row.raw_key)).not.toContain(String(row.id).replaceAll("-", "").slice(0, 8));
		const added = (await keys()).filter((key) => !before.includes(key));
		expect(added).toEqual([row.raw_key]);

		// Nothing added, removed or decoded, and no metadata.
		expect(await stored(String(row.raw_key))).toEqual(raw);
		const object = (await bucket.head(String(row.raw_key))) as R2Object;
		expect(object.size).toBe(raw.length);
		expect(object.httpMetadata ?? {}).toEqual({});
		expect(object.customMetadata ?? {}).toEqual({});
		expect(await count("arrivals")).toBe(0);
	});

	it("writes the arrival's row before the bytes, and a file's row before its bytes", async () => {
		const seen: Record<string, unknown>[] = [];
		const watching = watchedBucket(async (key) => {
			const [arrival] = await rows(`SELECT id, attempts FROM arrivals WHERE raw_key = ?1`, key);
			const messages = await rows(`SELECT id FROM emails WHERE raw_key = ?1`, key);
			const file = key.startsWith("attachments/")
				? await rows(
						`SELECT a.uploading_since, e.subject FROM attachments a JOIN emails e ON e.id = a.email_id
						 WHERE a.id = ?1`,
						key.split("/")[2] ?? "",
					)
				: [];
			seen.push({
				kind: key.split("/")[0],
				arrival: arrival !== undefined,
				message: messages.length,
				file: file[0] ?? null,
				arrivals: await count("arrivals"),
			});
		});
		expect((await deliver(withFile("In this order"), { env: watching })).threw).toBeNull();

		expect(seen).toHaveLength(2);
		// The original: its arrival row is there, and no message yet.
		expect(seen[0]).toMatchObject({ kind: "raw", arrival: true, message: 0, arrivals: 1 });
		// The file: its row is there, marked as on its way, under a message that is filed.
		expect(seen[1]).toMatchObject({ kind: "attachments", arrivals: 0 });
		const file = seen[1]?.file as { uploading_since: string | null; subject: string };
		expect(file.subject).toBe("In this order");
		expect(file.uploading_since).not.toBeNull();

		// Once its bytes are stored the file is part of the message.
		const row = await rowOf("In this order");
		const shown = await json<{ attachments: { id: string; filename: string }[] }>(
			await as("owner").fetch(`${M}/emails/${row.id}`),
		);
		expect(shown.attachments.map((one) => one.filename)).toEqual(["note.txt"]);
		const download = await as("owner").fetch(
			`${M}/emails/${row.id}/attachments/${shown.attachments[0]?.id}`,
		);
		expect(await download.text()).toBe("the attachment");
	});

	it("refuses a size that is not between 1 byte and 25 MiB, and reads nothing", async () => {
		const before = await keys();
		const messages = await count("emails");
		for (const rawSize of [0, -1, 1.5, Number.NaN, MAX_ORIGINAL_BYTES + 1]) {
			const outcome = await deliver(plain("Wrong size"), { rawSize });
			expect(outcome.rejections, String(rawSize)).toHaveLength(1);
			expect(outcome.threw, String(rawSize)).toBeNull();
			expect(outcome.pulls, String(rawSize)).toBe(0);
		}
		expect(await count("arrivals")).toBe(0);
		expect(await count("emails")).toBe(messages);
		expect(await keys()).toEqual(before);
	});

	it("takes no message whose bytes are fewer or more than declared", async () => {
		const before = await keys();
		const raw = plain("Not the declared size");
		const length = new TextEncoder().encode(raw).length;
		for (const rawSize of [length + 5, length - 5]) {
			const outcome = await deliver(raw, { rawSize });
			// Podbay has not taken it: the handler throws, and nothing is left.
			expect(outcome.threw, String(rawSize)).toBeInstanceOf(Error);
			expect(outcome.rejections).toEqual([]);
		}
		expect(await count("arrivals")).toBe(0);
		expect(await count("emails", "subject = 'Not the declared size'")).toBe(0);
		expect(await keys()).toEqual(before);
	});

	it("takes no message whose bytes could not be stored", async () => {
		const before = await keys();
		const failing = watchedBucket((key) => {
			if (key.startsWith("raw/")) throw new Error("the bucket is away");
		});
		const outcome = await deliver(plain("Never stored"), { env: failing });
		expect(outcome.threw).toBeInstanceOf(Error);
		expect(await count("arrivals")).toBe(0);
		expect(await count("emails", "subject = 'Never stored'")).toBe(0);
		expect(await keys()).toEqual(before);
	});

	it("keeps a message the parser refuses, as one that could not be read", async () => {
		// Parts nested deeper than the parser goes.
		const lines = ["From: Mallory <mallory@evil.test>", `To: ${MAILBOX}`, "Subject: Too deep"];
		const depth = 300;
		for (let level = 0; level < depth; level++) {
			if (level > 0) lines.push(`--b${level - 1}`);
			lines.push(`Content-Type: multipart/mixed; boundary="b${level}"`, "");
		}
		lines.push(`--b${depth - 1}`, "Content-Type: text/plain", "", "at the bottom");
		for (let level = depth - 1; level >= 0; level--) lines.push(`--b${level}--`);
		const raw = new TextEncoder().encode(`${lines.join("\r\n")}\r\n`);

		const before = await count("emails");
		const outcome = await deliver(raw, { from: "Envelope@Evil.Test" });
		expect(outcome).toMatchObject({ rejections: [], threw: null });
		expect(await count("emails")).toBe(before + 1);

		const [row] = await rows(`SELECT * FROM emails WHERE unparsed = 'parser'`);
		expect(row).toMatchObject({
			folder_id: "inbox",
			// The envelope sender, not what the message says of itself.
			sender: "envelope@evil.test",
			recipient: MAILBOX,
			subject: "",
			body: "",
			read: 0,
			raw_size: raw.length,
		});
		// It joins no conversation: it is its own.
		expect(row?.thread_id).toBe(row?.id);
		expect(await stored(String(row?.raw_key))).toEqual(raw);
		expect(await count("arrivals")).toBe(0);

		const shown = await json<Record<string, unknown>>(
			await as("owner").fetch(`${M}/emails/${row?.id}`),
		);
		expect(shown).toMatchObject({ unparsed: "parser", has_original: true, raw_size: raw.length });
		const original = await as("owner").fetch(`${M}/emails/${row?.id}/original`);
		expect(original.status).toBe(200);
		expect((await json<{ header: string }>(original)).header).toContain("Subject: Too deep");
	});

	it("keeps a message whose text is larger than a row, as one that could not be read", async () => {
		// The parser gives the text with plain line feeds: 48 bytes a line.
		const body = "A long line of ordinary words, again and again.\r\n".repeat(
			Math.ceil((MAX_ROW_BYTES + 100_000) / 48),
		);
		const raw = new TextEncoder().encode(plain("Larger than a row", body));
		const outcome = await deliver(raw);
		expect(outcome).toMatchObject({ rejections: [], threw: null });

		const [row] = await rows(`SELECT * FROM emails WHERE unparsed = 'too_large'`);
		expect(row).toMatchObject({
			folder_id: "inbox",
			sender: "ada@sender.test",
			subject: "",
			body: "",
			raw_size: raw.length,
		});
		expect(String(row?.raw_key)).toMatch(RAW_KEY);
		const kept = (await bucket.head(String(row?.raw_key))) as R2Object;
		expect(kept.size).toBe(raw.length);
		expect(await stored(String(row?.raw_key))).toEqual(raw);
		expect(await count("arrivals")).toBe(0);
	});

	it("makes two messages of the same message delivered twice", async () => {
		const raw = plain("Delivered twice", "Once and again", {
			"Message-ID": "<twice@sender.test>",
		});
		expect((await deliver(raw)).threw).toBeNull();
		expect((await deliver(raw)).threw).toBeNull();

		const both = await rows(
			`SELECT id, raw_key, message_id FROM emails WHERE subject = 'Delivered twice'`,
		);
		expect(both).toHaveLength(2);
		expect(both[0]?.message_id).toBe("twice@sender.test");
		expect(both[1]?.message_id).toBe("twice@sender.test");
		expect(both[0]?.id).not.toBe(both[1]?.id);
		expect(both[0]?.raw_key).not.toBe(both[1]?.raw_key);
		const bytes = new TextEncoder().encode(raw);
		expect(await stored(String(both[0]?.raw_key))).toEqual(bytes);
		expect(await stored(String(both[1]?.raw_key))).toEqual(bytes);
	});

	it("delivers a message whose file could not be written, and leaves no object without a row", async () => {
		const before = await keys("attachments/");
		const failing = watchedBucket((key) => {
			if (key.startsWith("attachments/")) throw new Error("the bucket is away");
		});
		const outcome = await deliver(withFile("File not written", "lost.txt"), { env: failing });
		// The original is stored, so the handler neither throws nor rejects.
		expect(outcome).toMatchObject({ rejections: [], threw: null });

		const row = await rowOf("File not written");
		expect(String(row.raw_key)).toMatch(RAW_KEY);
		const [file] = await rows(`SELECT * FROM attachments WHERE email_id = ?1`, String(row.id));
		expect(file?.uploading_since).not.toBeNull();
		expect(await keys("attachments/")).toEqual(before);
		// A file whose bytes are not there is not part of the message and cannot be downloaded.
		const shown = await json<{ attachments: unknown[] }>(
			await as("owner").fetch(`${M}/emails/${row.id}`),
		);
		expect(shown.attachments).toEqual([]);
		expect((await as("owner").fetch(`${M}/emails/${row.id}/attachments/${file?.id}`)).status).toBe(
			404,
		);
	});
});

describe("an arrival that was left half done", () => {
	it("is finished by the next arrival, once it is fifteen minutes old", async () => {
		// The handler is stopped after the bytes are stored and before the message is filed.
		const raw = plain("Left half done", "Finished later");
		const outcome = await deliver(raw, { env: stoppedAt("fileArrival") });
		// Podbay has the message: it neither throws nor rejects.
		expect(outcome).toMatchObject({ rejections: [], threw: null });
		expect(await count("emails", "subject = 'Left half done'")).toBe(0);
		const [left] = await rows(`SELECT * FROM arrivals`);
		expect(left).toMatchObject({ envelope_from: "ada@sender.test", attempts: 0 });
		expect(await stored(String(left?.raw_key))).toEqual(new TextEncoder().encode(raw));

		// A fresh arrival is somebody's work in hand: the next message leaves it alone.
		expect((await deliver(plain("While it is fresh"))).threw).toBeNull();
		expect(await count("arrivals")).toBe(1);
		expect(await count("emails", "subject = 'Left half done'")).toBe(0);

		const arrived = old(20);
		await inMailbox((sql) => sql.exec(`UPDATE arrivals SET started_at = ?1`, arrived));
		expect((await deliver(plain("The next arrival"))).threw).toBeNull();

		const row = await rowOf("Left half done");
		expect(row).toMatchObject({
			id: left?.id,
			raw_key: left?.raw_key,
			raw_size: left?.raw_size,
			unparsed: null,
			folder_id: "inbox",
			// The time it arrived, not the time it was finished.
			date: arrived,
		});
		expect(String(row.body)).toContain("Finished later");
		expect(await count("arrivals")).toBe(0);
	});

	it("is filed as interrupted on its second attempt, and is not parsed again", async () => {
		const raw = new TextEncoder().encode(plain("Stopped the parser twice"));
		await bucket.put("raw/00000000000000000000000000000001", raw);
		await inMailbox((sql) =>
			sql.exec(
				`INSERT INTO arrivals (id, raw_key, raw_size, envelope_from, started_at, attempts)
				 VALUES ('twice-stopped', 'raw/00000000000000000000000000000001', ?1, 'Eve@Sender.Test', ?2, 1)`,
				raw.length,
				old(60),
			),
		);
		expect((await deliver(plain("After the second stop"))).threw).toBeNull();

		const [row] = await rows(`SELECT * FROM emails WHERE id = 'twice-stopped'`);
		expect(row).toMatchObject({
			unparsed: "interrupted",
			subject: "",
			body: "",
			sender: "eve@sender.test",
			raw_key: "raw/00000000000000000000000000000001",
			raw_size: raw.length,
			auth_results: null,
		});
		expect(await count("arrivals")).toBe(0);
		// Its original is still what arrived.
		const original = await as("owner").fetch(`${M}/emails/twice-stopped/original`);
		expect((await json<{ header: string }>(original)).header).toContain(
			"Subject: Stopped the parser twice",
		);
	});

	it("is removed when its original is not there, three at a time", async () => {
		await inMailbox((sql) => {
			for (let n = 0; n < 5; n++) {
				sql.exec(
					`INSERT INTO arrivals (id, raw_key, raw_size, envelope_from, started_at, attempts)
					 VALUES (?1, ?2, 10, '', ?3, ?4)`,
					`no-bytes-${n}`,
					`raw/${String(n).padStart(32, "f")}`,
					old(30 + n),
					n % 2,
				);
			}
		});
		const messages = await count("emails");
		expect((await deliver(plain("Clears three"))).threw).toBeNull();
		// The three oldest are gone, and none of them became a message.
		expect((await rows(`SELECT id FROM arrivals ORDER BY id`)).map((row) => row.id)).toEqual([
			"no-bytes-0",
			"no-bytes-1",
		]);
		expect(await count("emails")).toBe(messages + 1);
		expect((await deliver(plain("Clears the rest"))).threw).toBeNull();
		expect(await count("arrivals")).toBe(0);
	});
});

describe("deleting", () => {
	/** Delivers a message with a file and names its objects. */
	async function delivered(subject: string) {
		expect((await deliver(withFile(subject, `${subject.replaceAll(" ", "-")}.txt`))).threw).toBe(
			null,
		);
		const row = await rowOf(subject);
		const mine = (await keys()).filter(
			(key) => key === row.raw_key || key.startsWith(`attachments/${row.id}/`),
		);
		expect(mine).toHaveLength(2);
		return { id: String(row.id), keys: mine };
	}
	const left = async (mine: string[]) => (await keys()).filter((key) => mine.includes(key));

	it("deletes a message's original and files with it, objects before rows", async () => {
		const message = await delivered("Deleted for good");

		// A bucket that fails: the rows are still there, so the deletion can be done again.
		const stub = testEnv.MAILBOX.get(testEnv.MAILBOX.idFromName(MAILBOX));
		const failing = {
			delete: async () => {
				throw new Error("the bucket is away");
			},
		} as unknown as R2Bucket;
		await expect(
			deleteMessage(failing, stub as unknown as Parameters<typeof deleteMessage>[1], message.id),
		).rejects.toThrow("the bucket is away");
		expect(await count("emails", `id = '${message.id}'`)).toBe(1);
		expect(await left(message.keys)).toHaveLength(2);

		// Moving it to Trash keeps the original.
		expect(
			(await as("owner").post(`${M}/emails/${message.id}/move`, { folderId: "trash" })).status,
		).toBe(200);
		expect(await left(message.keys)).toHaveLength(2);

		expect(
			(await as("owner").fetch(`${M}/emails/${message.id}`, { method: "DELETE" })).status,
		).toBe(204);
		expect(await left(message.keys)).toEqual([]);
		expect(await count("emails", `id = '${message.id}'`)).toBe(0);
		expect(await count("attachments", `email_id = '${message.id}'`)).toBe(0);
		expect(
			(await as("owner").fetch(`${M}/emails/${message.id}`, { method: "DELETE" })).status,
		).toBe(404);
	});

	it("leaves no object of what was in a place that is emptied", async () => {
		const first = await delivered("Emptied one");
		const second = await delivered("Emptied two");
		const stays = await delivered("Stays in the inbox");
		for (const message of [first, second]) {
			expect(
				(await as("owner").post(`${M}/emails/${message.id}/move`, { folderId: "trash" })).status,
			).toBe(200);
		}
		let answer = { more: true, deleted: 0 };
		for (let calls = 0; answer.more && calls < 10; calls++) {
			answer = await json<typeof answer>(await as("owner").post(`${M}/folders/trash/empty`));
		}
		expect(answer.more).toBe(false);
		expect(await left([...first.keys, ...second.keys])).toEqual([]);
		expect(await count("emails", "folder_id = 'trash'")).toBe(0);
		expect(await left(stays.keys)).toHaveLength(2);
	});

	it("leaves nothing of a deleted mailbox in the bucket: originals, files and arrivals", async () => {
		const DOOMED = "doomed@example.com";
		const path = `/api/v1/mailboxes/${encodeURIComponent(DOOMED)}`;
		expect((await createMailbox(as("owner").cookie, DOOMED)).status).toBe(201);
		const other = await keys();
		expect((await deliver(withFile("Goes with the mailbox"), { to: DOOMED })).threw).toBeNull();
		expect((await deliver(plain("Goes too"), { to: DOOMED })).threw).toBeNull();
		// An arrival that never became a message has an object too.
		expect(
			(await deliver(plain("Never filed"), { to: DOOMED, env: stoppedAt("fileArrival") })).threw,
		).toBeNull();
		const mine = (await keys()).filter((key) => !other.includes(key));
		expect(mine.filter((key) => key.startsWith("raw/"))).toHaveLength(3);
		expect(mine.filter((key) => key.startsWith("attachments/"))).toHaveLength(1);

		const browser = new Browser();
		expect((await browser.signIn("owner@example.com")).status).toBe(200);
		expect((await browser.fetch(path, { method: "DELETE" })).status).toBe(204);
		expect(await keys()).toEqual(other);
		// A new mailbox at the same address starts empty.
		expect((await createMailbox(as("owner").cookie, DOOMED)).status).toBe(201);
		const tables = await inMailbox(
			(sql) =>
				[
					...sql.exec(
						`SELECT (SELECT COUNT(*) FROM emails) AS emails, (SELECT COUNT(*) FROM arrivals) AS arrivals`,
					),
				][0],
			DOOMED,
		);
		expect(tables).toEqual({ emails: 0, arrivals: 0 });
	});
});

describe("the columns and the table", () => {
	it("come with the mailbox's database from the release before, and rewrite nothing", async () => {
		const address = "upgraded@example.com";
		expect((await createMailbox(as("owner").cookie, address)).status).toBe(201);
		await inMailbox((sql, storage) => {
			// The database as the release before left it, with a message in it.
			sql.exec(`DROP TABLE arrivals`);
			for (const column of ["raw_key", "raw_size", "unparsed", "auth_results"]) {
				sql.exec(`ALTER TABLE emails DROP COLUMN ${column}`);
			}
			sql.exec(`DELETE FROM d1_migrations WHERE name = '14_originals'`);
			sql.exec(
				`INSERT INTO emails (id, folder_id, subject, sender, recipient, date, body)
				 VALUES ('kept-as-it-was', 'inbox', 'From the release before', 'ada@sender.test', ?1, ?2, 'x')`,
				address,
				old(60),
			);
			applyMigrations(sql, mailboxMigrations, storage);
		}, address);

		const [row] = await inMailbox(
			(sql) => [...sql.exec(`SELECT * FROM emails WHERE id = 'kept-as-it-was'`)],
			address,
		);
		expect(row).toMatchObject({
			subject: "From the release before",
			raw_key: null,
			raw_size: null,
			unparsed: null,
			auth_results: null,
		});
		const upgraded = `/api/v1/mailboxes/${encodeURIComponent(address)}`;
		const shown = await as("owner").fetch(`${upgraded}/emails/kept-as-it-was/original`);
		expect((await json<{ code: string }>(shown)).code).toBe("NO_ORIGINAL");
		// And mail that arrives from then on has its original.
		expect((await deliver(plain("After the upgrade"), { to: address })).threw).toBeNull();
		const [fresh] = await inMailbox(
			(sql) => [...sql.exec(`SELECT raw_key FROM emails WHERE subject = 'After the upgrade'`)],
			address,
		);
		expect(String(fresh?.raw_key)).toMatch(RAW_KEY);
	});
});

it("keeps to fifteen minutes before an arrival counts as left", () => {
	expect(ARRIVAL_STALE_MS).toBe(15 * 60_000);
});
