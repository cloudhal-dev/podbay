// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Labels (ADR-0007): a message is in one place and carries any number of labels. What a label's
 * id and name may be, and the limits, are here so the Worker and the app agree.
 */

/** Chosen in ADR-0007, decision 11, to be revised from use. */
export const LABEL_LIMITS = {
	/** Labels in one mailbox. */
	perMailbox: 500,
	/** Characters in a name. */
	nameLength: 64,
	/** Labels on one message. */
	perMessage: 50,
} as const;

/** A label's colour is an index into a palette the app owns, never a colour from input. */
export const LABEL_COLOR_COUNT = 8;

const LABEL_ID = /^lbl_[0-9a-f]{24}$/;

/** Whether a value has the shape of a label id. An id is opaque and never built from a name. */
export function isLabelId(value: unknown): value is string {
	return typeof value === "string" && LABEL_ID.test(value);
}

/** A new label id. */
export function newLabelId(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(12));
	return `lbl_${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/** Control characters, and the quote, which would end a quoted value in a search. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it refuses
const NOT_IN_A_NAME = /[\u0000-\u001f\u007f"]/;

/**
 * A name as it is stored: trimmed, inner spaces collapsed, one canonical form. `null` when it is
 * empty, too long, has a character a name may not have, or has an empty part between slashes
 * (a `/` shows nesting, so `a//b` and a slash at either end mean nothing).
 */
export function cleanLabelName(raw: unknown): string | null {
	if (typeof raw !== "string") return null;
	const name = raw.normalize("NFC").replace(/\s+/g, " ").trim();
	if (name === "" || [...name].length > LABEL_LIMITS.nameLength) return null;
	if (NOT_IN_A_NAME.test(name)) return null;
	if (name.split("/").some((part) => part.trim() === "")) return null;
	return name
		.split("/")
		.map((part) => part.trim())
		.join("/");
}

/** Two names are the same label when their keys are equal: case and width do not tell them apart. */
export function labelKey(name: string): string {
	return name.normalize("NFKC").toLowerCase();
}

/** A colour index from input, or 0 when it is not one. */
export function labelColor(value: unknown): number {
	return typeof value === "number" &&
		Number.isInteger(value) &&
		value >= 0 &&
		value < LABEL_COLOR_COUNT
		? value
		: 0;
}
