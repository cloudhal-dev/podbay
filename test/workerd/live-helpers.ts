/**
 * Helpers for the tests of the connection on which a mailbox tells the open app that something
 * changed (ADR-0013): a tab that connects as a browser does and keeps what it is told.
 */
import { runInDurableObject, SELF } from "cloudflare:test";
import { expect } from "vitest";
import {
	LIVE_KINDS,
	LIVE_LIMITS,
	type LiveKind,
	type LiveState,
	readLiveMessage,
} from "../../shared/live.ts";
import type { Browser } from "./helpers.ts";
import { ORIGIN, testEnv } from "./helpers.ts";

export const livePath = (mailbox: string) =>
	`/api/v1/mailboxes/${encodeURIComponent(mailbox)}/live`;

/**
 * A handshake as a browser sends it, from the app's own page unless the test says otherwise.
 * `origin: null` sends none at all, as a program does.
 */
export function handshake(
	mailbox: string,
	options: { cookie?: string; origin?: string | null; upgrade?: boolean } = {},
): Promise<Response> {
	const headers = new Headers();
	if (options.upgrade !== false) {
		headers.set("upgrade", "websocket");
		headers.set("connection", "Upgrade");
	}
	if (options.origin !== null) headers.set("origin", options.origin ?? ORIGIN);
	if (options.cookie) headers.set("cookie", options.cookie);
	return SELF.fetch(`${ORIGIN}${livePath(mailbox)}`, { headers });
}

/** One open connection, as a tab holds it: every text it was sent, and how it ended. */
export class Tab {
	readonly texts: string[] = [];
	closed: { code: number; reason: string } | null = null;

	constructor(readonly socket: WebSocket) {
		socket.accept();
		socket.addEventListener("message", (event) => {
			this.texts.push(typeof event.data === "string" ? event.data : "<bytes>");
		});
		socket.addEventListener("close", (event) => {
			this.closed = { code: event.code, reason: event.reason };
		});
	}

	/** The states it was told, in order. A text that is not a state fails the test. */
	get states(): LiveState[] {
		return this.texts
			.filter((text) => text !== "pong")
			.map((text) => {
				const read = readLiveMessage(text);
				expect(read.is, text).toBe("state");
				const state = read.is === "state" ? read.state : {};
				expect(Object.keys(state).sort()).toEqual([...LIVE_KINDS].sort());
				return state as LiveState;
			});
	}

	get last(): LiveState {
		const state = this.states.at(-1);
		if (state === undefined) throw new Error("the tab was told nothing");
		return state;
	}

	say(text: string): void {
		this.socket.send(text);
	}
}

/** Opens a connection for a signed-in browser and waits for the state every connection gets. */
export async function open(browser: Browser, mailbox: string): Promise<Tab> {
	const res = await handshake(mailbox, { cookie: browser.cookie });
	expect(res.status, "the handshake").toBe(101);
	const socket = res.webSocket;
	if (socket === null) throw new Error("the handshake gave no connection");
	const tab = new Tab(socket);
	await settled(() => tab.texts.length >= 1);
	return tab;
}

/** Waits, a turn at a time and never for long, until something that is on its way is there. */
export async function settled(done: () => boolean, what = "what was awaited"): Promise<void> {
	for (let turn = 0; turn < 200 && !done(); turn++) {
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	expect(done(), what).toBe(true);
}

/** Lets everything that is on its way arrive, for a test that says nothing more may come. */
export async function quiet(): Promise<void> {
	for (let turn = 0; turn < 10; turn++) await new Promise((resolve) => setTimeout(resolve, 5));
}

export const mailboxStub = (mailbox: string) =>
	testEnv.MAILBOX.get(testEnv.MAILBOX.idFromName(mailbox));

/** Runs inside the mailbox object, with its state. */
export function inObject<T>(mailbox: string, run: (state: DurableObjectState) => T): Promise<T> {
	return runInDurableObject(mailboxStub(mailbox), (_object, state) => run(state));
}

/** The counters as the mailbox's database has them. */
export function counters(mailbox: string): Promise<Record<LiveKind, number>> {
	return inObject(mailbox, (state) => {
		const found = Object.fromEntries(
			[...state.storage.sql.exec(`SELECT kind, value FROM states`)].map((row) => [
				String(row.kind),
				Number(row.value),
			]),
		);
		return found as Record<LiveKind, number>;
	});
}

/**
 * Makes every connection of a mailbox look as if the guard allowed it `minutes` ago. The time
 * is in the connection's attachment, so the data is aged instead of the clock.
 */
export function ageConnections(mailbox: string, minutes: number): Promise<number> {
	return inObject(mailbox, (state) => {
		const sockets = state.getWebSockets();
		for (const ws of sockets) {
			const held = ws.deserializeAttachment() as { at: number; sent: string };
			ws.serializeAttachment({ ...held, at: held.at - minutes * 60_000 });
		}
		return sockets.length;
	});
}

export const GOOD_FOR_MINUTES = LIVE_LIMITS.goodForMs / 60_000;
