// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/** Completing an address while it is typed into a list of addresses separated by commas. */

const lower = (address: string): string => address.toLowerCase();

const listed = (value: string): string[] =>
	value
		.split(",")
		.map((address) => address.trim())
		.filter((address) => address !== "");

/** A message or a line of a list, as far as its addresses go. */
export interface Exchanged {
	folder_id?: string | null;
	sender?: string | null;
	recipient?: string | null;
	cc?: string | null;
	participants?: string | null;
}

/** Mail nobody asked for, and mail thrown away, teaches no address. */
const TEACHES_NOTHING: readonly string[] = ["spam", "trash"];

/**
 * The addresses a mailbox has exchanged mail with, as far as this mail shows them, each once
 * and in order. Whoever wrote from Spam is not someone to write to: an address that only
 * unwanted mail carries is never offered.
 */
export function addressesOf(mail: readonly Exchanged[], own?: string): string[] {
	const seen = new Map<string, string>();
	for (const one of mail) {
		if (TEACHES_NOTHING.includes(one.folder_id?.toLowerCase() ?? "")) continue;
		for (const field of [one.sender, one.recipient, one.cc, one.participants]) {
			for (const address of listed(field ?? "")) {
				const key = address.toLowerCase();
				if (key !== own?.toLowerCase() && key.includes("@") && !seen.has(key)) {
					seen.set(key, address);
				}
			}
		}
	}
	return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

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

/** One address offered while typing. `id` is set for one the mailbox itself remembers. */
export interface Suggestion {
	address: string;
	/** Beside the address, never in its place. */
	name: string | null;
	/** What the mailbox forgets it by; `null` for an address the loaded lists showed. */
	id: string | null;
}

/**
 * What is offered while an address is typed: first the addresses the mailbox has written to,
 * as the Worker gave them, then what the loaded lists show. An address is offered once, never
 * one that is in the field already, and never one the person just had forgotten.
 */
export function mergeSuggestions(
	written: readonly { id: string; address: string; name: string | null }[],
	loaded: readonly string[],
	value: string,
	forgotten: ReadonlySet<string> = new Set(),
	max = 8,
): Suggestion[] {
	if (lastAddress(value) === "") return [];
	const taken = new Set(listed(value.slice(0, value.lastIndexOf(",") + 1)).map(lower));
	const offered: Suggestion[] = [];
	const offer = (one: Suggestion) => {
		const key = lower(one.address);
		if (taken.has(key) || forgotten.has(key)) return;
		taken.add(key);
		offered.push(one);
	};
	for (const one of written) offer({ address: one.address, name: one.name, id: one.id });
	for (const address of suggestAddresses(loaded, value, max)) {
		offer({ address, name: null, id: null });
	}
	return offered.slice(0, max);
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
