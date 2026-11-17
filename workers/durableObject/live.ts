// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * The mailbox tells the open app that something changed, and nothing more (ADR-0013).
 *
 * **The signal cannot be forgotten.** `watch` wraps every method of the mailbox object once,
 * where the class is defined. Around each call it asks SQLite how many rows the database has
 * changed so far (`total_changes()`). A call that changed a row moves the counters it is
 * about, in the same turn as the change, and one message goes to every connection. What a
 * method is about is `ABOUT` below; a method that is not named there is about mail. So a
 * method written tomorrow raises the signal without knowing that there is one, and a caller
 * (a route, the assistant, an MCP client, incoming mail) can neither forget it nor raise it
 * without writing.
 *
 * **Nothing here is mail.** A message is built from the four counters by `liveMessage`
 * (`shared/live.ts`) and from nothing else. A connection keeps the id of the person as its
 * tag and, as its attachment, the time the guard allowed it and the message it was last sent:
 * both survive the object's sleep, so the same state is never sent twice, also after a wake.
 *
 * **No timer and no alarm.** A connection is good for five minutes; the ones that are older
 * are closed whenever the object is awake to tell something or to take a new connection, and
 * before anything is sent. `ping` is answered by the platform without waking the object.
 */
import {
	LIVE_CLOSE_CODE,
	LIVE_CLOSED,
	LIVE_KINDS,
	LIVE_LIMITS,
	LIVE_PING,
	LIVE_PONG,
	type LiveKind,
	type LiveState,
	liveMessage,
} from "../../shared/live";
import { errorFields, log } from "../../shared/log";

/** What a connection keeps through the object's sleep. Neither a session nor a role. */
interface Held {
	/** When the guard allowed the connection, in milliseconds. */
	at: number;
	/** The message it was last sent. */
	sent: string;
}

/** The headers of the request the Worker builds for the object. Nothing else is read. */
const PERSON = "x-podbay-person";
const ALLOWED_AT = "x-podbay-allowed-at";
/** A tag of a connection is at most this long (docs/cloudflare/ledger.json). */
const MAX_TAG = 256;
const OPEN = 1;

// ── The counters ───────────────────────────────────────────────────

export function readState(sql: SqlStorage): LiveState {
	const state = {} as LiveState;
	for (const kind of LIVE_KINDS) state[kind] = "0";
	for (const row of sql.exec(`SELECT kind, value FROM states`)) {
		const kind = LIVE_KINDS.find((known) => known === row.kind);
		if (kind !== undefined) state[kind] = String(row.value);
	}
	return state;
}

/** Moves the counters of these kinds by one. They only grow. */
export function move(sql: SqlStorage, kinds: readonly LiveKind[]): void {
	if (kinds.length === 0) return;
	const marks = kinds.map(() => "?").join(", ");
	sql.exec(`UPDATE states SET value = value + 1 WHERE kind IN (${marks})`, ...kinds);
}

/** How many rows this database has changed since it was opened, as SQLite counts them. */
function changes(sql: SqlStorage): number {
	return Number([...sql.exec(`SELECT total_changes() AS n`)][0]?.n ?? 0);
}

// ── What each method is about ──────────────────────────────────────

type Kinds = readonly LiveKind[];

const MAIL: Kinds = ["mail"];
/** Rows that no read of mail shows: such a write tells nobody. */
const NOTHING: Kinds = [];

/**
 * What a call that changed a row is about. A method that is not named here is about mail.
 * `test/workerd/live-signal.test.ts` holds this list against the object's methods.
 */
export const ABOUT: Readonly<Record<string, Kinds | ((answer: unknown) => Kinds)>> = {
	// Mail arrived: the one thing a notification of the device is raised from.
	fileArrival: ["delivery", "mail"],
	createLabel: ["labels"],
	updateLabel: ["labels"],
	// The label is gone, and so is its chip on every conversation that carried it.
	deleteLabel: ["labels", "mail"],
	// A filter is only counted by the request that names it; ticked lines are changed.
	bulk: (answer) =>
		typeof answer === "object" && answer !== null && "more" in answer ? MAIL : NOTHING,
	// It moves its own counter: the settings are not in this database.
	settingsSaved: NOTHING,
	// An arrival before it is filed, and a file before its bytes are there, are not mail yet.
	beginArrival: NOTHING,
	dropArrival: NOTHING,
	claimArrival: NOTHING,
	declareFile: NOTHING,
	// The addresses a mailbox has written to are asked for while typing and kept nowhere.
	forgetAddress: NOTHING,
	forgetAddresses: NOTHING,
	// The mailbox is gone, and its connections with it.
	purge: NOTHING,
};

/** Set on every wrapped method, so a test can see that none was left out. */
export const WATCHED = Symbol("podbay.live.watched");

type Method<T> = (this: T, ...args: unknown[]) => unknown;

/**
 * Wraps every method of a mailbox object's class: the RPC methods, `fetch`, the WebSocket
 * handlers and, later, the alarm. Called once, where the class is defined.
 */
export function watch<T extends object>(
	prototype: T,
	contextOf: (object: T) => DurableObjectState,
): void {
	for (const name of Object.getOwnPropertyNames(prototype)) {
		const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
		if (name === "constructor" || typeof descriptor?.value !== "function") continue;
		const method = descriptor.value as Method<T>;
		const watched = async function (this: T, ...args: unknown[]): Promise<unknown> {
			const ctx = contextOf(this);
			const before = changes(ctx.storage.sql);
			let answer: unknown;
			try {
				answer = await method.apply(this, args);
				return answer;
			} finally {
				try {
					// No I/O was awaited since the method's writes, so the counter is stored with
					// the change it counts: all of it or none (docs/cloudflare/ledger.json).
					if (changes(ctx.storage.sql) !== before) {
						const about = ABOUT[name] ?? MAIL;
						move(ctx.storage.sql, typeof about === "function" ? about(answer) : about);
						tell(ctx, Date.now());
					}
				} catch (error) {
					// The signal never fails the change it is about; the app's slow looking finds it.
					log.error("live.signal_failed", errorFields(error));
				}
			}
		};
		Object.defineProperty(watched, WATCHED, { value: true });
		Object.defineProperty(prototype, name, { ...descriptor, value: watched });
	}
}

// ── Connections ────────────────────────────────────────────────────

/** The platform answers `ping` with `pong` without waking the object. Set at every wake. */
export function answerPings(ctx: DurableObjectState): void {
	ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(LIVE_PING, LIVE_PONG));
}

function heldOf(ws: WebSocket): Held | null {
	const held = ws.deserializeAttachment() as Partial<Held> | null;
	return typeof held?.at === "number" && typeof held.sent === "string"
		? { at: held.at, sent: held.sent }
		: null;
}

function close(ws: WebSocket, reason: string): void {
	try {
		ws.close(LIVE_CLOSE_CODE, reason);
	} catch {
		// Already closing: there is nothing left to end.
	}
}

function note(ctx: DurableObjectState, event: string, fields: Record<string, string | number>) {
	// Opaque ids and numbers only. A message is never logged.
	log.info(event, { mailbox: ctx.id.toString(), ...fields });
}

/** Closes every connection that was allowed more than five minutes ago. */
function closeOld(ctx: DurableObjectState, now: number): void {
	let closed = 0;
	for (const ws of ctx.getWebSockets()) {
		if (ws.readyState !== OPEN) continue;
		const held = heldOf(ws);
		if (held !== null && now - held.at < LIVE_LIMITS.goodForMs) continue;
		close(ws, LIVE_CLOSED.expired);
		closed += 1;
	}
	if (closed > 0) note(ctx, "live.closed", { why: LIVE_CLOSED.expired, connections: closed });
}

/**
 * Tells every connection the state, once. The old connections are closed first, so nothing is
 * sent on a connection more than five minutes after its right was last checked; a connection
 * that was already sent this state is passed over.
 */
export function tell(ctx: DurableObjectState, now: number): void {
	closeOld(ctx, now);
	const sockets = ctx.getWebSockets().filter((ws) => ws.readyState === OPEN);
	if (sockets.length === 0) return;
	const text = liveMessage(readState(ctx.storage.sql));
	for (const ws of sockets) {
		const held = heldOf(ws);
		if (held === null || held.sent === text) continue;
		try {
			ws.send(text);
			ws.serializeAttachment({ at: held.at, sent: text } satisfies Held);
		} catch {
			// The other side went away; the platform closes it.
		}
	}
}

/**
 * The request the Worker hands the object. The Worker builds it from what the guard decided:
 * who, and when. Nothing of the browser's request travels on: no cookie, no address, no header.
 */
export function liveRequest(person: string, allowedAt: number): Request {
	return new Request("https://mailbox.invalid/live", {
		headers: { upgrade: "websocket", [PERSON]: person, [ALLOWED_AT]: String(allowedAt) },
	});
}

const refusal = (status: number) => new Response(null, { status });

/**
 * Takes a connection the guard allowed. The object keeps the person's id as the connection's
 * tag and the time as its attachment, and sends the state at once, so a tab that was away
 * learns whether it is behind.
 */
export function accept(ctx: DurableObjectState, request: Request, now: number): Response {
	if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return refusal(426);
	const person = request.headers.get(PERSON) ?? "";
	const allowedAt = Number(request.headers.get(ALLOWED_AT) ?? Number.NaN);
	if (person === "" || person.length > MAX_TAG || !Number.isFinite(allowedAt)) {
		return refusal(400);
	}

	closeOld(ctx, now);
	// A ninth connection of one person closes their oldest.
	const own = ctx
		.getWebSockets(person)
		.filter((ws) => ws.readyState === OPEN)
		.map((ws) => ({ ws, at: heldOf(ws)?.at ?? 0 }))
		.sort((a, b) => a.at - b.at);
	const over = Math.max(0, own.length - LIVE_LIMITS.perPerson + 1);
	for (const { ws } of own.slice(0, over)) close(ws, LIVE_CLOSED.limit);
	const open = ctx.getWebSockets().filter((ws) => ws.readyState === OPEN).length;
	if (open >= LIVE_LIMITS.perMailbox) {
		note(ctx, "live.refused", { connections: open });
		return refusal(503);
	}

	const pair = new WebSocketPair();
	ctx.acceptWebSocket(pair[1], [person]);
	const text = liveMessage(readState(ctx.storage.sql));
	// A time ahead of the object's own clock would keep a connection for longer than it is good.
	pair[1].serializeAttachment({ at: Math.min(allowedAt, now), sent: text } satisfies Held);
	pair[1].send(text);
	note(ctx, "live.opened", { person, connections: open + 1 });
	return new Response(null, { status: 101, webSocket: pair[0] });
}

/** Closes the connections of one person, or all of them. Says how many it closed. */
export function end(ctx: DurableObjectState, person?: string): number {
	let closed = 0;
	for (const ws of ctx.getWebSockets(person)) {
		if (ws.readyState !== OPEN) continue;
		close(ws, LIVE_CLOSED.ended);
		closed += 1;
	}
	if (closed > 0) note(ctx, "live.closed", { why: LIVE_CLOSED.ended, connections: closed });
	return closed;
}

/** The app says `ping` and nothing else. Anything else that reaches the object ends it. */
export function refuse(ctx: DurableObjectState, ws: WebSocket): void {
	close(ws, LIVE_CLOSED.message);
	note(ctx, "live.closed", { why: LIVE_CLOSED.message, connections: 1 });
}

/** A connection closed, whoever closed it. The log says so with its status and nothing else. */
export function gone(ctx: DurableObjectState, code: number): void {
	note(ctx, "live.gone", { code });
}
