/**
 * What the tests of ADR-0014 (`bulk.test.ts`) are built from: a mailbox of its own for each
 * test, mail put straight into its database, and its state read back as one line a message.
 */
import { runInDurableObject } from "cloudflare:test";
import { expect } from "vitest";
import { Browser, createMailbox, json, migrate, seedUser, setupOwner, testEnv } from "./helpers.ts";

export interface Step {
	deed: string;
	conversations: number;
	messages: number;
	skipped: { not_found: number; place: number; label_limit: number };
	more: boolean;
}
export interface Counted {
	deed: string;
	conversations: number;
	messages: number;
	more?: boolean;
}
export interface Refusal {
	code: string;
}
export interface Seed {
	id: string;
	place?: string;
	/** The conversation; a message by itself when left out. */
	thread?: string;
	/** Minutes since it was stored. */
	ago?: number;
	read?: boolean;
	starred?: boolean;
	subject?: string;
}

export const browsers: Record<string, Browser> = {};
export const as = (who: string) => browsers[who] as Browser;
export const NO_DEED = "deed_000000000000000000000000";
export const NONE = { not_found: 0, place: 0, label_limit: 0 };

function inMailbox<T>(address: string, run: (sql: SqlStorage, storage: DurableObjectStorage) => T) {
	const stub = testEnv.MAILBOX.get(testEnv.MAILBOX.idFromName(address));
	return runInDurableObject(stub, (_object, state) => run(state.storage.sql, state.storage));
}

/** A mailbox of its own, so no test reads what another left. */
export async function mailbox(name: string) {
	const address = `${name}@example.com`;
	expect((await createMailbox(as("owner").cookie, address)).status).toBe(201);
	const base = `/api/v1/mailboxes/${encodeURIComponent(address)}`;
	return {
		address,
		base,
		bulk: (body: unknown, who = "owner") => as(who).post(`${base}/bulk`, body),
		/** A request that is expected to act: its answer. */
		act: async (body: unknown) => json<Step>(await as("owner").post(`${base}/bulk`, body)),
		/** A request with a filter: what was counted. */
		ask: async (body: unknown) => json<Counted>(await as("owner").post(`${base}/bulk`, body)),
		/** One step of a counted deed that is expected to run: its answer. */
		step: async (deed: string) => json<Step>(await as("owner").post(`${base}/bulk/${deed}/run`)),
		back: async (deed: string) =>
			json<{ messages: number; more: boolean }>(
				await as("owner").post(`${base}/bulk/${deed}/undo`),
			),
		run: (deed: string, who = "owner") => as(who).post(`${base}/bulk/${deed}/run`),
		undo: (deed: string, who = "owner") => as(who).post(`${base}/bulk/${deed}/undo`),
		seed: (list: Seed[]) => seed(address, list),
		state: () => state(address),
		sql: <T>(run: (sql: SqlStorage, storage: DurableObjectStorage) => T) => inMailbox(address, run),
	};
}

async function seed(address: string, list: Seed[]) {
	const now = Date.now();
	await inMailbox(address, (sql) => {
		list.forEach((one, index) => {
			sql.exec(
				`INSERT INTO emails (id, folder_id, subject, sender, recipient, date, read, starred, body, thread_id)
					VALUES (?, ?, ?, 'ada@sender.test', ?, ?, ?, ?, 'x', ?)`,
				one.id,
				one.place ?? "inbox",
				one.subject ?? `Subject ${one.id}`,
				address,
				// Each a moment after the one before, so "newest" is never a tie.
				new Date(now - (one.ago ?? 60) * 60_000 + index).toISOString(),
				one.read ? 1 : 0,
				one.starred ? 1 : 0,
				one.thread ?? one.id,
			);
		});
	});
}

/** Every message as `place`, with `r` when read and `*` when starred, and its labels. */
async function state(address: string): Promise<Record<string, string>> {
	return inMailbox(address, (sql) => {
		const labels = new Map<string, string[]>();
		for (const row of sql.exec(
			`SELECT el.email_id, l.name FROM email_labels el JOIN labels l ON l.id = el.label_id ORDER BY l.name`,
		)) {
			labels.set(String(row.email_id), [
				...(labels.get(String(row.email_id)) ?? []),
				String(row.name),
			]);
		}
		const all: Record<string, string> = {};
		for (const row of sql.exec(`SELECT id, folder_id, read, starred FROM emails ORDER BY id`)) {
			const marks = `${row.read ? "r" : ""}${row.starred ? "*" : ""}`;
			const carried = labels.get(String(row.id)) ?? [];
			all[String(row.id)] = [String(row.folder_id), marks, ...carried].filter(Boolean).join(" ");
		}
		return all;
	});
}

export async function label(base: string, name: string): Promise<string> {
	const made = await as("owner").post(`${base}/labels`, { name });
	expect(made.status).toBe(201);
	return (await json<{ id: string }>(made)).id;
}

export const audit = async (address: string) =>
	(
		await testEnv.DB.prepare(
			`select "action", "detail", "actor_user_id" from "audit" where "target" = ?1 and "action" like 'mailbox.bulk%' order by "at"`,
		)
			.bind(address)
			.all<{ action: string; detail: string; actor_user_id: string }>()
	).results;

/** The instance, its owner, and two people who are not members of anything yet. */
export async function people() {
	await migrate();
	expect((await setupOwner()).status).toBe(201);
	browsers.owner = new Browser();
	expect((await as("owner").signIn("owner@example.com")).status).toBe(200);
	await seedUser("reader@example.com", "member");
	await seedUser("outsider@example.com", "member");
	for (const who of ["reader", "outsider"]) {
		browsers[who] = new Browser();
		expect((await as(who).signIn(`${who}@example.com`)).status).toBe(200);
	}
	browsers.nobody = new Browser();
}
