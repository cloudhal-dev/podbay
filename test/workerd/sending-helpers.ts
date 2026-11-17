/**
 * Helpers for the tests of outgoing mail (ADR-0016): a send binding that can be told what to
 * answer and counts every call, a way to move a mailbox's clock by ageing its rows, and the
 * mailbox's alarm run by hand. Nothing here reaches a sending service: the binding of the
 * test replaces the local one inside the mailbox object, and `remoteBindings` is false.
 */
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { expect } from "vitest";
import { testEnv } from "./helpers.ts";

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;

/** The handle on a mailbox's object. */
export const objectOf = (address: string) =>
	testEnv.MAILBOX.get(testEnv.MAILBOX.idFromName(address));

/** What the binding of the test answers to one call. */
export type Answer =
	/** The service took the message. */
	| { messageId: string }
	/** A refusal with a code, as the service gives it. Its words are never to be logged. */
	| { code: string; message?: string }
	/** An argument of the wrong shape: a `TypeError` without a code. */
	| "type-error"
	/** An error without a code. */
	| "no-code"
	/** No answer at all. */
	| "never"
	/** An answer that is no answer: no id in it. */
	| "empty";

/** A message as the binding was given it. */
export interface Handed {
	to?: string | string[];
	cc?: string | string[];
	bcc?: string | string[];
	from: string | { email: string; name: string };
	subject: string;
	html?: string;
	text?: string;
	headers?: Record<string, string>;
	attachments?: { filename: string; content: string; type: string; disposition: string }[];
}

/** A send binding that sends nothing, answers what it is told and keeps every call. */
export class FakeSender {
	readonly calls: Handed[] = [];
	/** The answers to the next calls, in order; after them, `otherwise`. */
	next: Answer[] = [];
	otherwise: Answer = { messageId: "<taken@service.test>" };

	send(message: Handed): Promise<{ messageId: string }> {
		this.calls.push(message);
		const answer = this.next.shift() ?? this.otherwise;
		if (answer === "never") return new Promise(() => {});
		if (answer === "type-error") return Promise.reject(new TypeError("to: wrong shape"));
		if (answer === "no-code") return Promise.reject(new Error("connection lost"));
		if (answer === "empty") return Promise.resolve({ messageId: "" });
		if ("code" in answer) {
			return Promise.reject(
				Object.assign(new Error(answer.message ?? `refused: ${answer.code}`), {
					code: answer.code,
				}),
			);
		}
		return Promise.resolve(answer);
	}
}

/**
 * Puts a binding of the test in place of the mailbox object's send binding, and makes the
 * object wait for an answer only as long as the test says. It holds for as long as the object
 * stays in memory.
 */
export async function fakeSender(address: string, answerWithinMs = 200): Promise<FakeSender> {
	const fake = new FakeSender();
	await runInDurableObject(objectOf(address), (instance) => {
		const object = instance as unknown as { env: object; answerWithinMs: number };
		object.env = Object.create(object.env, { EMAIL: { value: fake, enumerable: true } });
		object.answerWithinMs = answerWithinMs;
	});
	return fake;
}

/** Runs something on a mailbox's own database. */
export function inMailbox<T>(
	address: string,
	run: (sql: SqlStorage, state: DurableObjectState) => T | Promise<T>,
): Promise<T> {
	return runInDurableObject(objectOf(address), (_instance, state) => run(state.storage.sql, state));
}

/** The rows a query finds in a mailbox's database. */
export const rowsOf = <T = Record<string, unknown>>(address: string, query: string) =>
	inMailbox(address, (sql) => [...sql.exec(query)] as T[]);

const SHIFT = (column: string) =>
	`${column} = strftime('%Y-%m-%dT%H:%M:%fZ', ${column}, '-' || ?1 || ' seconds')`;

/**
 * Moves a mailbox's clock forward by ageing what it waits for: every time of every message on
 * its way, and what it counted against its caps, is `ms` earlier afterwards.
 */
export async function age(address: string, ms: number, where = "1 = 1"): Promise<void> {
	const seconds = (ms / 1000).toFixed(3);
	await inMailbox(address, (sql) => {
		sql.exec(
			`UPDATE submissions SET ${SHIFT("send_at")}, ${SHIFT("retry_at")}, ${SHIFT("started_at")},
				${SHIFT("requested_at")}, ${SHIFT("sent_at")} WHERE ${where}`,
			seconds,
		);
		sql.exec(`UPDATE send_log SET ${SHIFT("at")}`, seconds);
	});
}

/**
 * Runs the mailbox's alarm now, if one is set, whatever time it is set to. Says whether one
 * ran. An alarm whose time has come runs by itself in the test runtime as it does anywhere:
 * a test that needs to see a run sets a time that has not come and runs it by hand.
 */
export const wake = (address: string) => runDurableObjectAlarm(objectOf(address));

/** Makes the alarm run now, whether one was set or not. */
export async function wakeNow(address: string): Promise<void> {
	await inMailbox(address, (_sql, state) => state.storage.setAlarm(Date.now() + HOUR));
	expect(await wake(address), "the alarm").toBe(true);
}

/** The time the mailbox's alarm is set to, or `null`. */
export const alarmOf = (address: string) =>
	inMailbox(address, (_sql, state) => state.storage.getAlarm());

const dueIn = (address: string) =>
	rowsOf(
		address,
		`SELECT 1 FROM submissions WHERE state = 'waiting' AND COALESCE(retry_at, send_at) <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
	);

/**
 * Lets everything that waits in a mailbox leave: the times of the waiting messages are made
 * past, and the alarm is run until nothing more is due. A run the runtime started by itself
 * counts as well: what is waited for is the rows, not who woke the mailbox.
 */
export async function letLeave(address: string): Promise<void> {
	await inMailbox(address, (sql) => {
		const past = new Date(Date.now() - SECOND).toISOString();
		sql.exec(`UPDATE submissions SET send_at = ?1 WHERE state = 'waiting' AND send_at > ?1`, past);
	});
	for (let run = 0; run < 40; run++) {
		if ((await dueIn(address)).length === 0) return;
		// The alarm is the only thing that lets mail leave.
		await inMailbox(address, (_sql, state) => state.storage.setAlarm(Date.now() + HOUR));
		await wake(address);
	}
	expect(await dueIn(address), "what is still due").toEqual([]);
}

/** A row of `submissions`, as the tests read it. */
export interface Row {
	email_id: string;
	state: string;
	send_at: string;
	retry_at: string | null;
	attempts: number;
	started_at: string | null;
	requested_at: string;
	requested_by: string;
	error: string | null;
	sent_at: string | null;
	service_id: string | null;
}

export const submissionOf = async (address: string, id: string): Promise<Row | undefined> =>
	(
		await inMailbox(
			address,
			(sql) => [...sql.exec(`SELECT * FROM submissions WHERE email_id = ?1`, id)] as unknown[],
		)
	)[0] as Row | undefined;

export const placeOf = async (address: string, id: string): Promise<string | undefined> =>
	(
		await inMailbox(address, (sql) => [
			...sql.exec(`SELECT folder_id FROM emails WHERE id = ?1`, id),
		])
	)[0]?.folder_id as string | undefined;

/**
 * The rule that holds the place and the state together: a message is in Scheduled exactly
 * when its state is `waiting` or `sending`. Returns the ids that break it.
 */
export const outOfPlace = (address: string) =>
	rowsOf<{ id: string }>(
		address,
		`SELECT e.id FROM emails e LEFT JOIN submissions s ON s.email_id = e.id
		 WHERE (e.folder_id = 'scheduled') != (COALESCE(s.state, '') IN ('waiting', 'sending'))`,
	);
