// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Outgoing mail waits before it leaves (ADR-0016). What the Worker and the app both need to
 * know about it: the window a person can take a message back in, the limits, the states of a
 * message on its way, the reasons it did not leave, and when a request says it should leave.
 *
 * Nothing here needs the schema library, so the app imports this module as it is.
 */

/** The undo window a person can choose, in seconds. There is no "off" (decision 10). */
export const UNDO_SECONDS = [5, 10, 30] as const;
export type UndoSeconds = (typeof UNDO_SECONDS)[number];
/** The window when a request names none. */
export const DEFAULT_UNDO_SECONDS: UndoSeconds = 10;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Decision 23: chosen, and to be revised from use. */
export const SENDING = {
	/** The mailbox holds a message this much longer than the window, so a late Undo still arrives. */
	marginMs: 2000,
	/** The furthest time a message can be sent later: 365 days ahead. */
	farthestMs: 365 * 24 * HOUR,
	/** Messages that may wait in one mailbox. */
	waiting: 100,
	/** How often a message is handed to the service at most. */
	attempts: 6,
	/** The wait before each further attempt, after a refusal that reads "not now". */
	retryAfterMs: [MINUTE, 5 * MINUTE, 15 * MINUTE, HOUR, 4 * HOUR],
	/** How long the service is waited for. No answer by then is `unknown`. */
	answerWithinMs: MINUTE,
	/** A message found handed over and unanswered after this long is `unknown`. */
	unansweredAfterMs: 15 * MINUTE,
	/** A message that has not left this long after its time does not leave. */
	lateAfterMs: 24 * HOUR,
	/** Messages one run of the alarm lets leave. */
	perRun: 10,
} as const;

/** A message on its way: the states of its row in `submissions` (decision 3). */
export const SUBMISSION_STATES = ["waiting", "sending", "sent", "failed"] as const;
export type SubmissionState = (typeof SUBMISSION_STATES)[number];

/**
 * Why a message did not leave, when the reason is Podbay's own. Anything else in `error` is a
 * code of the sending service, as it gave it.
 */
export const OWN_REASONS = ["right", "sender", "limits", "late", "unknown"] as const;
export type OwnReason = (typeof OWN_REASONS)[number];

/**
 * The refusals of the service that read "not now" and are tried again (decisions 6 and 8).
 * Every other code is final.
 */
export const NOT_NOW_CODES: readonly string[] = [
	"E_RATE_LIMIT_EXCEEDED",
	"E_INTERNAL_SERVER_ERROR",
	"E_EMAIL_SENDING_NOT_READY",
];

/** What a message says about its way out: the field `submission` of a message that has one. */
export interface Submission {
	state: SubmissionState;
	/** The time it leaves, or left, or was to leave: an instant in UTC. */
	send_at: string;
	/** Why it did not leave, for a `failed` one. */
	error: string | null;
}

/** What a send answers: the message is taken and waits (decision 24). */
export interface SendAnswer {
	id: string;
	status: "waiting";
	send_at: string;
}

/** The codes the routes of this record answer with. */
export const SEND_CODES = {
	scheduled: "SCHEDULED",
	started: "SEND_STARTED",
	tooFar: "SEND_AT_TOO_FAR",
	tooMany: "TOO_MANY_WAITING",
} as const;

export const isUndoSeconds = (value: unknown): value is UndoSeconds =>
	UNDO_SECONDS.some((one) => one === value);

/**
 * How long to wait before the next attempt, after `attempts` were made and the last one was
 * refused with "not now". `null` when there is no further attempt: the message has failed.
 */
export function retryAfterMs(attempts: number): number | null {
	if (!Number.isInteger(attempts) || attempts < 1 || attempts >= SENDING.attempts) return null;
	return SENDING.retryAfterMs[attempts - 1] ?? null;
}

export type Leaves =
	| {
			/** When the mailbox lets the message leave, in milliseconds. */
			at: number;
			/** Sent later, at a time the person chose: no window on top. */
			later: boolean;
	  }
	| { refused: "past" | "too_far" };

/**
 * When a message leaves, by what its request says (decisions 10 and 12). Without a time it is
 * an ordinary send: it waits for the window and two seconds more. A time in the past is
 * refused, as is one more than 365 days ahead; a time nearer than the window is an ordinary
 * send.
 */
export function whenToLeave(
	request: { send_at?: string; undo_seconds?: number },
	now: number,
): Leaves {
	const seconds = isUndoSeconds(request.undo_seconds) ? request.undo_seconds : DEFAULT_UNDO_SECONDS;
	const ordinary = now + seconds * 1000 + SENDING.marginMs;
	if (request.send_at === undefined) return { at: ordinary, later: false };
	const at = Date.parse(request.send_at);
	if (Number.isNaN(at) || at <= now) return { refused: "past" };
	if (at > now + SENDING.farthestMs) return { refused: "too_far" };
	if (at - now < seconds * 1000) return { at: ordinary, later: false };
	return { at, later: true };
}

/** What the service's answer means for the message (decision 6). */
export type Outcome =
	| { is: "sent"; serviceId: string }
	| { is: "again"; code: string }
	| { is: "failed"; error: string };

/** A refusal: the error the sending service threw, or `null` when it gave no answer in time. */
export function outcomeOfRefusal(error: unknown): Outcome {
	if (error === null) return { is: "failed", error: "unknown" };
	// An argument of the wrong shape: the service did not take it, and says so without a code.
	if (error instanceof TypeError) return { is: "failed", error: "limits" };
	const code = (error as { code?: unknown } | undefined)?.code;
	if (typeof code !== "string" || !/^E_[A-Z0-9_]{1,80}$/.test(code)) {
		return { is: "failed", error: "unknown" };
	}
	return NOT_NOW_CODES.includes(code) ? { is: "again", code } : { is: "failed", error: code };
}
