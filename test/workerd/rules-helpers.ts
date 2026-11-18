/**
 * What the two test files about a mailbox's rules share (ADR-0008): one mailbox with an owner,
 * a sender, a reader, someone without a membership and an administrator without one; a way
 * to deliver a message as the platform does; and the mailbox's own rows.
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
	seedMembership,
	seedUser,
	setupOwner,
	testEnv,
} from "./helpers.ts";

export const DESK = "desk@example.com";
export const OTHER = "other@example.com";
export const path = (mailbox: string) => `/api/v1/mailboxes/${encodeURIComponent(mailbox)}`;
export const M = path(DESK);

const browsers: Record<string, Browser> = {};
export const as = (who: string) => browsers[who] as Browser;
/** The account ids of the people of the test, by who they are. */
export const ids: Record<string, string> = {};

export function inMailbox<T>(
	run: (sql: SqlStorage, storage: DurableObjectStorage) => T,
	mailbox = DESK,
): Promise<T> {
	const stub = testEnv.MAILBOX.get(testEnv.MAILBOX.idFromName(mailbox));
	return runInDurableObject(stub, (_object, state) => run(state.storage.sql, state.storage));
}
export const rows = <T = Record<string, SqlStorageValue>>(
	query: string,
	mailbox = DESK,
	...values: (string | number)[]
) => inMailbox((sql) => [...sql.exec(query, ...values)] as T[], mailbox);

/** One mailbox with its people, signed in. `also` are further mailboxes of the owner. */
export async function people(also: string[] = [OTHER]): Promise<void> {
	await migrate();
	expect((await setupOwner()).status).toBe(201);
	browsers.owner = new Browser();
	expect((await as("owner").signIn("owner@example.com")).status).toBe(200);
	for (const mailbox of [DESK, ...also]) {
		expect((await createMailbox(as("owner").cookie, mailbox)).status).toBe(201);
	}
	ids.sender = await seedUser("sender@example.com", "member");
	ids.reader = await seedUser("reader@example.com", "member");
	ids.outsider = await seedUser("outsider@example.com", "member");
	ids.admin = await seedUser("admin@example.com", "admin");
	await seedMembership(DESK, ids.sender, "sender");
	await seedMembership(DESK, ids.reader, "reader");
	for (const who of ["sender", "reader", "outsider", "admin"]) {
		browsers[who] = new Browser();
		expect((await as(who).signIn(`${who}@example.com`)).status).toBe(200);
	}
}

/** A new browser of someone, signed in now: a session with fresh proof. */
export async function signedInAgain(who: string): Promise<Browser> {
	const browser = new Browser();
	expect((await browser.signIn(`${who}@example.com`)).status).toBe(200);
	browsers[who] = browser;
	return browser;
}

/**
 * Delivers a message as the platform does. `from` is the envelope sender. Says what was
 * rejected and what the handler threw: a rule must never cause either.
 */
export async function deliver(
	raw: string,
	options: { to?: string; from?: string; env?: Record<string, unknown> } = {},
): Promise<{ rejections: string[]; threw: unknown }> {
	const { message, rejections } = inbound(options.to ?? DESK, raw, {
		from: options.from ?? "ada@sender.test",
	});
	const ctx = createExecutionContext();
	let threw: unknown = null;
	try {
		const given = options.env ?? env;
		await worker.email(message, given as unknown as Parameters<typeof worker.email>[1], ctx);
	} catch (error) {
		threw = error;
	}
	await waitOnExecutionContext(ctx);
	return { rejections, threw };
}

export interface Stored {
	id: string;
	folder_id: string;
	read: number;
	starred: number;
	sender: string;
	subject: string;
	unparsed: string | null;
}

/** The row of the message with this subject, in whatever place it is. */
export async function stored(subject: string, mailbox = DESK): Promise<Stored | undefined> {
	return (
		await rows<Stored>(
			`SELECT id, folder_id, read, starred, sender, subject, unparsed FROM emails WHERE subject = ?1`,
			mailbox,
			subject,
		)
	)[0];
}

/** The names of the labels a message carries. */
export async function labelsOf(emailId: string, mailbox = DESK): Promise<string[]> {
	return (
		await rows<{ name: string }>(
			`SELECT l.name FROM email_labels el JOIN labels l ON l.id = el.label_id
			 WHERE el.email_id = ?1 ORDER BY l.name`,
			mailbox,
			emailId,
		)
	).map((row) => row.name);
}

/** The audit rows of an action, as the index has them. */
export async function audited(action: string) {
	const found = await testEnv.DB.prepare(
		`select "actor_user_id", "target", "detail" from "audit" where "action" = ?1 order by "at"`,
	)
		.bind(action)
		.all<{ actor_user_id: string; target: string; detail: string }>();
	return found.results;
}
