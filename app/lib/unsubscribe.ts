// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * How to leave a mailing list, as the message itself says in its `List-Unsubscribe` header
 * (RFC 2369). The header is written by the sender, so it is read strictly: only an `https:` page
 * without credentials in its address, or a `mailto:` to something shaped like an address.
 * Nothing here contacts anyone: the app shows a link, and a person decides.
 */

export type Unsubscribe =
	| { kind: "web"; url: string; host: string }
	| { kind: "mail"; address: string; subject: string };

const LONGEST = 2000;
const ADDRESS = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

/** The value of one header, whichever of the two shapes the stored headers have. */
function headerValue(rawHeaders: string | null | undefined, name: string): string | null {
	if (!rawHeaders) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(rawHeaders);
	} catch {
		return null;
	}
	if (Array.isArray(parsed)) {
		for (const entry of parsed as { key?: unknown; name?: unknown; value?: unknown }[]) {
			const key = typeof entry?.key === "string" ? entry.key : entry?.name;
			if (
				typeof key === "string" &&
				key.toLowerCase() === name &&
				typeof entry.value === "string"
			) {
				return entry.value;
			}
		}
		return null;
	}
	if (parsed !== null && typeof parsed === "object") {
		for (const [key, value] of Object.entries(parsed)) {
			if (key.toLowerCase() === name && typeof value === "string") return value;
		}
	}
	return null;
}

function asWeb(target: string): Unsubscribe | null {
	let url: URL;
	try {
		url = new URL(target);
	} catch {
		return null;
	}
	if (url.protocol !== "https:" || url.username !== "" || url.password !== "") return null;
	return { kind: "web", url: url.href, host: url.hostname };
}

function asMail(target: string): Unsubscribe | null {
	let url: URL;
	try {
		url = new URL(target);
	} catch {
		return null;
	}
	if (url.protocol !== "mailto:") return null;
	let address: string;
	try {
		address = decodeURIComponent(url.pathname).trim();
	} catch {
		return null;
	}
	if (!ADDRESS.test(address)) return null;
	const subject = (url.searchParams.get("subject") ?? "").replace(/[\r\n]+/g, " ").trim();
	return { kind: "mail", address, subject: subject.slice(0, 200) || "unsubscribe" };
}

/** The way to leave the list a message came from, or null when it names none that is acceptable. */
export function unsubscribeOf(rawHeaders: string | null | undefined): Unsubscribe | null {
	const value = headerValue(rawHeaders, "list-unsubscribe");
	if (value === null || value.length > LONGEST) return null;
	const targets = [...value.matchAll(/<([^<>\s]+)>/g)].map((match) => match[1] ?? "");
	// A page is what most lists offer and what a person expects; a message is the fallback.
	for (const target of targets) {
		const web = asWeb(target);
		if (web) return web;
	}
	for (const target of targets) {
		const mail = asMail(target);
		if (mail) return mail;
	}
	return null;
}
