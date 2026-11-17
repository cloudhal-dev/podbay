/**
 * What the two test files about the original message share (ADR-0015): one mailbox with an
 * owner, a reader and someone without a membership, a way to deliver a message and see what
 * the handler did, and doubles of the bucket and the mailbox that fail at one step.
 */
import {
	createExecutionContext,
	env,
	runInDurableObject,
	waitOnExecutionContext,
} from "cloudflare:test";
import { expect } from "vitest";
import worker from "../../workers/app.ts";
import {
	Browser,
	createMailbox,
	inbound,
	migrate,
	mime,
	seedMembership,
	seedUser,
	setupOwner,
	testEnv,
} from "./helpers.ts";

export const MAILBOX = "kept@example.com";
export const OTHER = "other@example.com";
export const M = `/api/v1/mailboxes/${encodeURIComponent(MAILBOX)}`;
export type TestEnv = Parameters<typeof worker.email>[1];
export const real = env as unknown as TestEnv;
export const bucket = real.BUCKET;

const browsers: Record<string, Browser> = {};
export const as = (who: string) => browsers[who] as Browser;

export function inMailbox<T>(
	run: (sql: SqlStorage, storage: DurableObjectStorage) => T,
	at = MAILBOX,
) {
	const stub = testEnv.MAILBOX.get(testEnv.MAILBOX.idFromName(at));
	return runInDurableObject(stub, (_object, state) => run(state.storage.sql, state.storage));
}
export const rows = (query: string, ...values: (string | number)[]) =>
	inMailbox((sql) => [...sql.exec(query, ...values)] as Record<string, SqlStorageValue>[]);
export const count = async (table: string, where = "1 = 1") =>
	Number((await rows(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`))[0]?.n);

/** Every key in the bucket: originals and files alike. */
export async function keys(prefix = ""): Promise<string[]> {
	const found: string[] = [];
	let cursor: string | undefined;
	do {
		const page = await bucket.list({ prefix, cursor });
		found.push(...page.objects.map((object) => object.key));
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor !== undefined);
	return found.sort();
}
export const stored = async (key: string) =>
	new Uint8Array(await ((await bucket.get(key)) as R2ObjectBody).arrayBuffer());

/** Delivers a message; says what was rejected and what the handler threw. */
export async function deliver(
	raw: string | Uint8Array,
	options: Parameters<typeof inbound>[2] & { to?: string; env?: TestEnv } = {},
) {
	const { message, rejections, read } = inbound(options.to ?? MAILBOX, raw, options);
	const ctx = createExecutionContext();
	let threw: unknown = null;
	try {
		await worker.email(message, options.env ?? real, ctx);
	} catch (error) {
		threw = error;
	}
	await waitOnExecutionContext(ctx);
	return { rejections, threw, pulls: read.pulls };
}

/** The row of the message with this subject. */
export async function rowOf(subject: string) {
	const found = await rows(`SELECT * FROM emails WHERE subject = ?1 ORDER BY date`, subject);
	expect(found, subject).toHaveLength(1);
	return found[0] as Record<string, SqlStorageValue>;
}
export const plain = (subject: string, body = "Hello", headers: Record<string, string> = {}) =>
	mime({ From: "Ada <ada@sender.test>", To: MAILBOX, Subject: subject, ...headers }, body);

/** A message with one file. */
export function withFile(
	subject: string,
	filename = "note.txt",
	content = "the attachment",
): string {
	return [
		"From: ada@sender.test",
		`To: ${MAILBOX}`,
		`Subject: ${subject}`,
		"MIME-Version: 1.0",
		'Content-Type: multipart/mixed; boundary="b-1"',
		"",
		"--b-1",
		"Content-Type: text/plain; charset=utf-8",
		"",
		"See attached.",
		"--b-1",
		`Content-Type: text/plain; name="${filename}"`,
		`Content-Disposition: attachment; filename="${filename}"`,
		"",
		content,
		"--b-1--",
		"",
	].join("\r\n");
}

/** A bucket that looks at the mailbox, or fails, when something is written to it. */
export function watchedBucket(onPut: (key: string) => Promise<void> | void): TestEnv {
	const watched = {
		put: async (key: string, value: never, options?: never) => {
			await onPut(key);
			return bucket.put(key, value, options);
		},
		get: (key: string, options?: never) => bucket.get(key, options),
		head: (key: string) => bucket.head(key),
		delete: (key: string | string[]) => bucket.delete(key),
		list: (options?: R2ListOptions) => bucket.list(options),
	};
	return { ...real, BUCKET: watched as unknown as R2Bucket };
}

/** A mailbox whose one call fails, as when the handler is stopped at that step. */
export function stoppedAt(method: string): TestEnv {
	const namespace = real.MAILBOX;
	const stopped = {
		idFromName: (name: string) => namespace.idFromName(name),
		get: (id: DurableObjectId) => {
			const stub = namespace.get(id) as unknown as Record<string, (...a: unknown[]) => unknown>;
			return new Proxy(stub, {
				get(target, name) {
					if (name === "then") return undefined;
					if (name === method) {
						return async () => {
							throw new Error(`stopped at ${method}`);
						};
					}
					return (...values: unknown[]) => target[name as string]?.(...values);
				},
			});
		},
	};
	return { ...real, MAILBOX: stopped as unknown as TestEnv["MAILBOX"] };
}

export const old = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

/** One mailbox with an owner, a reader and someone without a membership, each signed in. */
export async function prepare(): Promise<void> {
	await migrate();
	expect((await setupOwner()).status).toBe(201);
	browsers.owner = new Browser();
	expect((await as("owner").signIn("owner@example.com")).status).toBe(200);
	for (const address of [MAILBOX, OTHER]) {
		expect((await createMailbox(as("owner").cookie, address)).status).toBe(201);
	}
	const reader = await seedUser("reader@example.com", "member");
	await seedUser("outsider@example.com", "member");
	await seedMembership(MAILBOX, reader, "reader");
	for (const who of ["reader", "outsider"]) {
		browsers[who] = new Browser();
		expect((await as(who).signIn(`${who}@example.com`)).status).toBe(200);
	}
}
