// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * The app's end of the connection on which a mailbox says that something changed (ADR-0013).
 *
 * The connection carries no mail: four counters, which the app compares with the ones it
 * holds. What changed is then read through the ordinary API, where every request is checked as
 * it always was. The connection is never trusted to be there: while there is none the lists
 * ask as they did before, and while there is one they still ask, slowly.
 *
 * This module has no React and reaches the browser only through what it is given, so the
 * rules below are tested as they are (`test/unit/live.test.ts`):
 *
 * - one connection, opened again after about four minutes through the guard, the old one
 *   closed once the new one has said where the mailbox is;
 * - when it drops: a second, then double the wait up to a minute, each time by a random part
 *   less, and from the start again once a connection has held;
 * - `ping` every minute; no answer within ten seconds is a connection that is gone;
 * - a refetch at once for the first message, then at most once a second;
 * - a version it does not know: no connection, and the app goes on asking.
 */
import {
	LIVE_CLOSED,
	LIVE_LIMITS,
	LIVE_PING,
	LIVE_PONG,
	type LiveKind,
	type LiveState,
	movedKinds,
	readLiveMessage,
} from "shared/live";

/** How the app waits and evens out. Its own choices; the object's limits are in `shared/live`. */
export const LIVE_TIMING = {
	/** The wait before the first new attempt, and the longest wait. */
	firstWaitMs: 1000,
	longestWaitMs: 60_000,
	/** A connection that stayed open this long has held: the waits start over. */
	heldAfterMs: 10_000,
	/** While messages keep coming, the lists are asked at most this often. */
	refetchEveryMs: 1000,
	/** How often a list asks by itself: without a connection, and with one. */
	askEveryMs: 30_000,
	askEveryConnectedMs: 5 * 60_000,
} as const;

/**
 * The wait before attempt number `failures + 1`, in milliseconds: a second, doubled for every
 * failure up to a minute, and by a random part less, never less than half. `random` is a
 * number from 0 to 1.
 */
export function liveWait(failures: number, random: number): number {
	// A number that is none must not become a wait that is none: that would try without pause.
	if (!Number.isFinite(failures)) return LIVE_TIMING.longestWaitMs;
	const doubled = LIVE_TIMING.firstWaitMs * 2 ** Math.min(Math.max(failures, 0), 16);
	const whole = Math.min(LIVE_TIMING.longestWaitMs, doubled);
	const part = Number.isFinite(random) ? Math.min(Math.max(random, 0), 1) / 2 : 0;
	return Math.round(whole * (1 - part));
}

/** The address of a mailbox's connection: the app's own host, and never a token. */
export function liveUrl(mailboxId: string, page: { protocol: string; host: string }): string {
	const scheme = page.protocol === "https:" ? "wss:" : "ws:";
	return `${scheme}//${page.host}/api/v1/mailboxes/${encodeURIComponent(mailboxId)}/live`;
}

/** As much of a WebSocket as the connection uses. */
export interface LiveSocket {
	send(text: string): void;
	close(code?: number): void;
	addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
	addEventListener(type: "close", listener: (event: { reason?: string }) => void): void;
}

export interface LiveOptions {
	url: string;
	/** Opens a socket. The browser's `WebSocket`, or a test's. */
	open: (url: string) => LiveSocket;
	/** The kinds whose counter moved, evened out. */
	onMoved: (kinds: LiveKind[]) => void;
	/** Whether the mailbox is telling this tab, as of now. */
	onConnected: (connected: boolean) => void;
	now?: () => number;
	random?: () => number;
}

interface Line {
	socket: LiveSocket;
	openedAt: number;
}

type Timer = ReturnType<typeof setTimeout>;

export class LiveConnection {
	/** The counters last seen. Kept across connections: a tab that was away compares. */
	#held: Partial<LiveState> | null = null;
	/** The connection that is telling this tab. */
	#current: Line | null = null;
	/** One being opened, to take over or to begin with. */
	#next: Line | null = null;
	#failures = 0;
	#stopped = true;
	#attempt: Timer | undefined;
	#renew: Timer | undefined;
	#ping: Timer | undefined;
	#pong: Timer | undefined;
	#pending = new Set<LiveKind>();
	#flush: Timer | undefined;
	#flushedAt = Number.NEGATIVE_INFINITY;
	readonly #options: LiveOptions;

	constructor(options: LiveOptions) {
		this.#options = options;
	}

	#now(): number {
		return this.#options.now?.() ?? Date.now();
	}

	/** Opens the connection. It is kept open, and opened again, until `stop`. */
	start(): void {
		if (!this.#stopped) return;
		this.#stopped = false;
		this.#failures = 0;
		this.#open();
	}

	/** Closes everything and tries nothing more: the tab leaves, signs out, or cannot listen. */
	stop(): void {
		this.#stopped = true;
		for (const timer of [this.#attempt, this.#renew, this.#ping, this.#pong, this.#flush]) {
			clearTimeout(timer);
		}
		this.#attempt = this.#renew = this.#ping = this.#pong = this.#flush = undefined;
		this.#pending.clear();
		const lines = [this.#current, this.#next];
		this.#current = this.#next = null;
		for (const line of lines) this.#close(line);
		this.#options.onConnected(false);
	}

	#close(line: Line | null): void {
		try {
			line?.socket.close(1000);
		} catch {
			// It was never open, or is closed already.
		}
	}

	#open(): void {
		if (this.#stopped || this.#next !== null) return;
		let socket: LiveSocket;
		try {
			socket = this.#options.open(this.#options.url);
		} catch {
			this.#retry(false);
			return;
		}
		const line: Line = { socket, openedAt: this.#now() };
		this.#next = line;
		socket.addEventListener("message", (event) => this.#said(line, event.data));
		socket.addEventListener("close", (event) => this.#closed(line, event.reason ?? ""));
	}

	#random(): number {
		return this.#options.random?.() ?? Math.random();
	}

	/**
	 * Another attempt: after a second, then double the wait for every attempt that failed, up
	 * to a minute. Once a connection has held, the waits start over.
	 */
	#retry(held: boolean, longest = false): void {
		if (this.#stopped || this.#attempt !== undefined) return;
		if (held) this.#failures = 0;
		const wait = liveWait(longest ? 16 : this.#failures, this.#random());
		this.#failures += 1;
		this.#attempt = setTimeout(() => {
			this.#attempt = undefined;
			this.#open();
		}, wait);
	}

	#closed(line: Line, reason: string): void {
		if (line === this.#next) {
			// A handshake that failed says nothing about why, and the app does not guess: the
			// ordinary requests answer 401 or 404 where there is something to answer.
			this.#next = null;
			if (this.#current === null) this.#retry(false);
			// The old connection still tells: the new one is tried again, with the same waits.
			else this.#renewIn(liveWait(this.#failures++, this.#random()));
			return;
		}
		if (line !== this.#current) return;
		this.#current = null;
		clearTimeout(this.#ping);
		clearTimeout(this.#pong);
		clearTimeout(this.#renew);
		this.#ping = this.#pong = this.#renew = undefined;
		this.#options.onConnected(false);
		if (this.#next !== null) return;
		const held = this.#now() - line.openedAt >= LIVE_TIMING.heldAfterMs;
		// A ninth tab closed this one: coming back at once would only close another.
		this.#retry(held, reason === LIVE_CLOSED.limit);
	}

	#said(line: Line, data: unknown): void {
		if (this.#stopped || (line !== this.#current && line !== this.#next)) return;
		if (data === LIVE_PONG) {
			clearTimeout(this.#pong);
			this.#pong = undefined;
			return;
		}
		const read = readLiveMessage(data);
		if (read.is === "unknown") {
			// After a deploy an old tab can meet a new object. It goes on asking.
			this.stop();
			return;
		}
		if (read.is === "nothing") return;
		if (line === this.#next) this.#takeOver(line);
		const moved = movedKinds(this.#held, read.state);
		this.#held = { ...this.#held, ...read.state };
		if (moved.length > 0) this.#note(moved);
	}

	/** The new connection has said where the mailbox is: it is the one now, the old one goes. */
	#takeOver(line: Line): void {
		const old = this.#current;
		this.#current = line;
		this.#next = null;
		this.#close(old);
		clearTimeout(this.#pong);
		this.#pong = undefined;
		this.#pingIn(line);
		// Not all tabs at the same moment: a little less than four minutes, at random.
		this.#renewIn(Math.round(LIVE_LIMITS.renewAfterMs * (1 - this.#random() / 10)));
		this.#options.onConnected(true);
	}

	#renewIn(wait: number): void {
		clearTimeout(this.#renew);
		this.#renew = setTimeout(() => {
			this.#renew = undefined;
			this.#open();
		}, wait);
	}

	#pingIn(line: Line): void {
		clearTimeout(this.#ping);
		this.#ping = setTimeout(() => {
			if (line !== this.#current) return;
			try {
				line.socket.send(LIVE_PING);
			} catch {
				// Closing: the close says the rest.
			}
			this.#pong ??= setTimeout(() => {
				this.#pong = undefined;
				// No answer: the connection is gone, whatever the browser still thinks.
				if (line !== this.#current) return;
				this.#close(line);
				this.#closed(line, "");
			}, LIVE_LIMITS.pongWithinMs);
			this.#pingIn(line);
		}, LIVE_LIMITS.pingEveryMs);
	}

	/** At once for the first message, then at most once a second while they keep coming. */
	#note(kinds: LiveKind[]): void {
		for (const kind of kinds) this.#pending.add(kind);
		if (this.#flush !== undefined) return;
		const wait = this.#flushedAt + LIVE_TIMING.refetchEveryMs - this.#now();
		if (wait <= 0) {
			this.#tell();
			return;
		}
		this.#flush = setTimeout(() => {
			this.#flush = undefined;
			this.#tell();
		}, wait);
	}

	#tell(): void {
		const kinds = [...this.#pending];
		this.#pending.clear();
		this.#flushedAt = this.#now();
		if (kinds.length > 0) this.#options.onMoved(kinds);
	}
}

// ── Whether a mailbox is telling this tab ──────────────────────────

const connected = new Set<string>();
const listeners = new Set<() => void>();
const open = new Set<LiveConnection>();

export function setLiveConnected(mailboxId: string, is: boolean): void {
	if (connected.has(mailboxId) === is) return;
	if (is) connected.add(mailboxId);
	else connected.delete(mailboxId);
	for (const listener of listeners) listener();
}

export function isLiveConnected(mailboxId: string | undefined): boolean {
	return mailboxId !== undefined && connected.has(mailboxId);
}

export function onLiveConnected(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/** Keeps a connection where signing out can find it. */
export function holdLive(connection: LiveConnection): () => void {
	open.add(connection);
	return () => {
		open.delete(connection);
		connection.stop();
	};
}

/** Closes every connection of this tab. Called before signing out (ADR-0013, decision 13). */
export function closeLive(): void {
	for (const connection of open) connection.stop();
}
