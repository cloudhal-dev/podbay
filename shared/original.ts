// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * The original of a received message (ADR-0015): the bytes that arrived, kept as one object.
 * What the Worker answers about it and what the app shows are named here once, for both.
 *
 * The original is hostile content. It never reaches a browser as a page: the first part of it
 * is text in a JSON answer, and the whole of it leaves only as a download of opaque bytes.
 */

/** How much of an original the answer of "Show original" covers: the first 256 KiB. */
export const ORIGINAL_SHOWN_BYTES = 256 * 1024;

/** The largest message there is: the platform's limit for inbound mail, and Podbay's. */
export const MAX_ORIGINAL_BYTES = 25 * 1024 * 1024;

/** The message has no original: it was sent from here, is a draft, or arrived before originals were kept. */
export const NO_ORIGINAL_CODE = "NO_ORIGINAL";
/** The message's row names an original that is not in the bucket. */
export const ORIGINAL_MISSING_CODE = "ORIGINAL_MISSING";

/** Why a received message has no parsed fields: it is in the mailbox with its original alone. */
export const UNPARSED_KINDS = ["parser", "too_large", "interrupted"] as const;
export type Unparsed = (typeof UNPARSED_KINDS)[number];

/** The mechanisms the platform's statement is read for, and no other. */
export const AUTHENTICATION_METHODS = ["spf", "dkim", "dmarc"] as const;
export type AuthenticationMethod = (typeof AUTHENTICATION_METHODS)[number];

/**
 * What the receiving platform recorded about a message when it arrived: its identifier and
 * each result it wrote, in its order. It is the platform's statement, never Podbay's finding.
 */
export interface Authentication {
	identifier: string;
	results: { method: AuthenticationMethod; result: string }[];
}

/** The answer of `GET …/emails/:id/original`. */
export interface OriginalAnswer {
	/** The bytes of the original. */
	size: number;
	/** How many of them `header` and `rest` cover. */
	shown: number;
	/** The header block: the lines up to the first empty one. */
	header: string;
	/** What follows the empty line, as far as `shown` reaches. */
	rest: string;
	/**
	 * What the platform recorded, or `null` when it recorded nothing. Left out of the answer
	 * altogether while `AUTHENTICATION_SHOWN` is false.
	 */
	authentication?: Authentication | null;
}

/**
 * Whether the platform's statement about SPF, DKIM and DMARC is given out and shown (ADR-0015,
 * decisions 18 and 19). Two things come before the line is shown to anyone. The first is the
 * tests in the Workers runtime (`test/workerd/original.test.ts`): a forged second field is not
 * taken, and the identifier must be the platform's. The second is one message with a forged
 * field of the platform's own identifier, sent by hand to a real domain, with what arrived
 * recorded in the ledger (`runtime.email.authentication_results.forged`). The second has not
 * been done, so this is false: the field is kept when a message arrives and nothing is said
 * about it. `test/unit/original.test.ts` holds this value to that ledger entry.
 */
export const AUTHENTICATION_SHOWN: boolean = false;

/**
 * The name of the file an original is saved as: `message-`, the day it arrived as eight
 * digits, the first eight characters of the message's id, `.eml`. Nothing of the subject or
 * the sender is in it: a name written by a stranger is what the attachment rules call
 * deceptive. Only letters and digits of the id are taken, so the name can never hold a path.
 */
export function originalFileName(arrived: string, id: string): string {
	// The time is one Podbay wrote; anything else is no date at all.
	const time = /^\d{4}-\d{2}-\d{2}T/.test(arrived) ? Date.parse(arrived) : Number.NaN;
	const day = Number.isNaN(time)
		? "00000000"
		: new Date(time).toISOString().slice(0, 10).replaceAll("-", "");
	const short = id
		.toLowerCase()
		.replace(/[^a-z0-9]/g, "")
		.slice(0, 8)
		.padEnd(8, "0");
	return `message-${day}-${short}.eml`;
}
