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
