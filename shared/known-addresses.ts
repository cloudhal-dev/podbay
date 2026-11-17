// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * The addresses a mailbox has written to (ADR-0012): what both sides know about them. A
 * mailbox learns an address only when a person sends mail from it, and offers it again while
 * an address is typed.
 */

/** Chosen in ADR-0012, decision 23, to be revised from use. */
export const KNOWN_LIMITS = {
	/** Known addresses in one mailbox. Above it the least recently used are forgotten. */
	addresses: 5000,
	/** Characters in an address. A longer one is not recorded. */
	address: 254,
	/** Characters in a name, once the sending bodies carry one for a recipient (decision 16). */
	name: 120,
	/** Characters of what is typed that the completion takes. */
	typed: 64,
	/** Suggestions in one answer. There is no second page. */
	suggestions: 8,
	/** An address not written to for this long is forgotten at the next send: two years. */
	forgottenAfterMs: 2 * 365 * 86_400_000,
} as const;

/** One suggestion: an opaque id to forget it by, the whole address, and a name if one is known. */
export interface KnownAddress {
	id: string;
	address: string;
	name: string | null;
}

/** The answer of `GET …/known-addresses?q=`: the best few, and nothing about how many there are. */
export interface KnownAddressesAnswer {
	addresses: KnownAddress[];
}

const KNOWN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Whether a value has the shape of a known address's id. */
export function isKnownId(value: unknown): value is string {
	return typeof value === "string" && KNOWN_ID.test(value);
}

/** How many characters something typed has: a letter outside the basic plane counts once. */
export function typedLength(typed: string): number {
	return [...typed].length;
}

/** What was typed as the completion takes it, or `null` when it is nothing or too long. */
export function typedForCompletion(typed: string): string | null {
	const trimmed = typed.trim();
	const length = typedLength(trimmed);
	return length >= 1 && length <= KNOWN_LIMITS.typed ? trimmed : null;
}
