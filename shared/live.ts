// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * What a mailbox tells the open app (ADR-0013): that something changed, and nothing more.
 *
 * This is the one schema of the connection, written by the mailbox object and read by the app.
 * A message is four counters that only grow, one for each kind of change. The app compares a
 * counter with the one it holds and reads what changed through the ordinary API. Nothing here
 * is mail: no address, no id of a message, no sender, no subject, no count of unread mail.
 *
 * The names are fixed by the record (decision 22): the version, the type `state`, the four
 * kinds, and the texts `ping` and `pong`. The app imports this module as it is, so nothing
 * here needs the schema library.
 */

/** The version of the message. A reader that does not know it falls back to asking. */
export const LIVE_VERSION = 1;

/**
 * - `delivery`: mail arrived in the mailbox;
 * - `mail`: anything about messages changed (arrival, a move, read or starred, a label given
 *   or taken, a draft saved or discarded, a message sent or deleted, a place emptied);
 * - `labels`: a label was made, renamed, recoloured or deleted;
 * - `settings`: the mailbox's settings were saved.
 */
export const LIVE_KINDS = ["delivery", "mail", "labels", "settings"] as const;
export type LiveKind = (typeof LIVE_KINDS)[number];

/** A counter for each kind, as text: it is compared, never calculated with. */
export type LiveState = Record<LiveKind, string>;

export interface LiveMessage {
	v: typeof LIVE_VERSION;
	type: "state";
	state: LiveState;
}

/** The one thing the app says, and what the platform answers without waking the mailbox. */
export const LIVE_PING = "ping";
export const LIVE_PONG = "pong";

/** Chosen in ADR-0013, decision 20, to be revised from use. */
export const LIVE_LIMITS = {
	/** Connections of one person to one mailbox. One more closes the oldest. */
	perPerson: 8,
	/** Connections to one mailbox. One more is refused, and that tab keeps asking. */
	perMailbox: 200,
	/** How long after the guard allowed it a connection is told anything. */
	goodForMs: 5 * 60_000,
	/** The app opens a new connection about this long after the last one. */
	renewAfterMs: 4 * 60_000,
	/** The app says `ping` this often, and reconnects when no answer comes in time. */
	pingEveryMs: 60_000,
	pongWithinMs: 10_000,
	/** The largest message the object sends, in bytes. */
	messageBytes: 256,
} as const;

/** The status every connection the object closes is closed with (RFC 6455, policy). */
export const LIVE_CLOSE_CODE = 1008;

/** Why the object closed a connection. A word of the protocol, never shown to a person. */
export const LIVE_CLOSED = {
	/** It was allowed more than five minutes ago. */
	expired: "expired",
	/** The person's right ended, or the mailbox is gone. */
	ended: "ended",
	/** The person opened a ninth connection; this was the oldest. */
	limit: "limit",
	/** The app said something other than `ping`. */
	message: "message",
} as const;

const COUNTER = /^[0-9]{1,20}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The text of a message for these counters. Throws for a state that is not four counters. */
export function liveMessage(state: LiveState): string {
	const counters = {} as LiveState;
	// Built from the list of kinds, so nothing else a caller holds can travel.
	for (const kind of LIVE_KINDS) {
		const value = state[kind];
		if (typeof value !== "string" || !COUNTER.test(value)) {
			throw new Error(`live: the counter of ${kind} is not a number`);
		}
		counters[kind] = value;
	}
	const message: LiveMessage = { v: LIVE_VERSION, type: "state", state: counters };
	const text = JSON.stringify(message);
	if (new TextEncoder().encode(text).length > LIVE_LIMITS.messageBytes) {
		throw new Error("live: the message is too large");
	}
	return text;
}

export type LiveRead =
	/** The counters the message carries that this reader knows. One it does not carry is absent. */
	| { is: "state"; state: Partial<LiveState> }
	/** Not a message of a version this reader knows: the app falls back to asking. */
	| { is: "unknown" }
	/** A message of this version that says nothing this reader knows. It is passed over. */
	| { is: "nothing" };

/**
 * Reads what the object sent. A field or a kind that is not known is ignored; a version that
 * is not known is said, because after a deploy an old tab can meet a new object.
 */
export function readLiveMessage(text: unknown): LiveRead {
	if (typeof text !== "string" || text.length > 4096) return { is: "unknown" };
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return { is: "unknown" };
	}
	if (!isRecord(parsed) || parsed.v !== LIVE_VERSION) return { is: "unknown" };
	if (parsed.type !== "state" || !isRecord(parsed.state)) return { is: "nothing" };
	const state: Partial<LiveState> = {};
	for (const kind of LIVE_KINDS) {
		const value = parsed.state[kind];
		if (typeof value === "string" && COUNTER.test(value)) state[kind] = value;
	}
	return { is: "state", state };
}

/** The kinds whose counter is not the one held. Without anything held, every kind it carries. */
export function movedKinds(held: Partial<LiveState> | null, next: Partial<LiveState>): LiveKind[] {
	return LIVE_KINDS.filter((kind) => next[kind] !== undefined && next[kind] !== held?.[kind]);
}
