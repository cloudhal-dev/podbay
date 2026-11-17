// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/** Completing an address while it is typed into a list of addresses separated by commas. */

const listed = (value: string): string[] =>
	value
		.split(",")
		.map((address) => address.trim())
		.filter((address) => address !== "");

/** The part of a list of addresses that is being typed: what follows the last comma. */
export function lastAddress(value: string): string {
	return value.slice(value.lastIndexOf(",") + 1).trim();
}

/** The list with what is being typed replaced by a whole address, ready for the next one. */
export function completeAddress(value: string, address: string): string {
	const done = value.slice(0, value.lastIndexOf(",") + 1).trim();
	return `${done === "" ? "" : `${done} `}${address}, `;
}

/** Known addresses that what is being typed could become, best first, a handful at most. */
export function suggestAddresses(known: readonly string[], value: string, max = 6): string[] {
	const typed = lastAddress(value).toLowerCase();
	if (typed === "") return [];
	const already = new Set(listed(value).map((address) => address.toLowerCase()));
	const fits = known.filter(
		(address) => address.toLowerCase().includes(typed) && !already.has(address.toLowerCase()),
	);
	const starts = (address: string) => (address.toLowerCase().startsWith(typed) ? 0 : 1);
	return fits.sort((a, b) => starts(a) - starts(b) || a.localeCompare(b)).slice(0, max);
}

/** A list of addresses as it is typed, split into the ones that are done and the one in hand. */
export function splitTyped(value: string): { done: string[]; typing: string } {
	const cut = value.lastIndexOf(",");
	// An address is listed once, whatever its case.
	const seen = new Set<string>();
	const done = listed(value.slice(0, cut + 1)).filter((address) => {
		const known = seen.has(address.toLowerCase());
		seen.add(address.toLowerCase());
		return !known;
	});
	return { done, typing: value.slice(cut + 1).trimStart() };
}

/** The list written back from its two halves. Every address that is done ends with a comma. */
export function joinTyped(done: readonly string[], typing: string): string {
	return `${done.map((address) => `${address}, `).join("")}${typing}`;
}

/**
 * What typing or pasting into the field means: every comma, semicolon or line break ends an
 * address, and what follows the last of them is still being typed.
 */
export function typeInto(done: readonly string[], text: string): string {
	const pieces = text.split(/[,;\n]/);
	const typing = pieces.pop() ?? "";
	const added = pieces.map((piece) => piece.trim()).filter((piece) => piece !== "");
	return joinTyped([...done, ...added], typing.trimStart());
}

/** Whether something has the shape of an address. The Worker decides whether mail can go there. */
export function looksLikeAddress(value: string): boolean {
	return /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(value.trim());
}
