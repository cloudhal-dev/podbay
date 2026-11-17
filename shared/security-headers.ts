// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * The response headers every page and every API answer carries (rule S11).
 *
 * There are two kinds of answer and each has its own content policy:
 *
 * - the app's pages and assets, which the Worker never sees: `PAGE_HEADERS`, written to
 *   `public/_headers` by `node scripts/checks/headers.ts --write`;
 * - everything the Worker answers itself (the API, attachments, the MCP endpoint):
 *   `API_HEADERS`. None of it is a page, so its policy allows nothing at all.
 */
import { MAIL_FRAME_SCRIPT_HASH } from "./mail-frame.ts";

/**
 * The content policy of the app's pages.
 *
 * The app loads its own script, style, fonts and API and nothing from anywhere else. Three
 * entries are wider than the app itself needs, and all three are there for the mail frame: it
 * is a `srcdoc` document, which inherits this policy, so whatever the frame may do the page
 * must allow too. The frame's own, narrower policy (app/lib/mail-html.ts) still applies on top.
 *
 * - the hash in `script-src` is the frame's sizing script, the only inline script anywhere;
 * - `'unsafe-inline'` in `style-src` is for the style attributes of a message;
 * - `https:` in `img-src` is for the remote images of a message, which the frame loads only
 *   after the reader asked for them.
 */
export const PAGE_CONTENT_POLICY_DIRECTIVES: Readonly<Record<string, readonly string[]>> = {
	"default-src": ["'none'"],
	"script-src": ["'self'", `'${MAIL_FRAME_SCRIPT_HASH}'`],
	"style-src": ["'self'", "'unsafe-inline'"],
	"img-src": ["'self'", "data:", "blob:", "https:"],
	"font-src": ["'self'", "data:"],
	// The API and the assistant's WebSocket, both on the app's own origin.
	"connect-src": ["'self'"],
	"manifest-src": ["'self'"],
	"form-action": ["'self'"],
	"base-uri": ["'none'"],
	"object-src": ["'none'"],
	// Nobody may put Podbay in a frame: no clickjacking of a signed-in inbox.
	"frame-ancestors": ["'none'"],
};

function policyText(directives: Readonly<Record<string, readonly string[]>>): string {
	return Object.entries(directives)
		.map(([name, sources]) => (sources.length === 0 ? name : `${name} ${sources.join(" ")}`))
		.join("; ");
}

export const PAGE_CONTENT_POLICY = policyText(PAGE_CONTENT_POLICY_DIRECTIVES);

/**
 * The content policy of what the Worker answers. An API answer or an attachment is never a
 * page: should a browser ever show one as a document, it may load nothing, run nothing and is
 * sandboxed.
 */
export const API_CONTENT_POLICY = "default-src 'none'; frame-ancestors 'none'; sandbox";

const COMMON_HEADERS: Readonly<Record<string, string>> = {
	"X-Frame-Options": "DENY",
	// A response is what its Content-Type says, never what its bytes look like.
	"X-Content-Type-Options": "nosniff",
	// A link out of Podbay tells the destination nothing about the mailbox it came from.
	"Referrer-Policy": "no-referrer",
	// Podbay is served over HTTPS only. Subdomains are the deployer's own business.
	"Strict-Transport-Security": "max-age=31536000",
	// Another window that Podbay opens, or that opens Podbay, gets no handle on it.
	"Cross-Origin-Opener-Policy": "same-origin",
	// No other site may load a page, an asset, an API answer or an attachment of this one.
	"Cross-Origin-Resource-Policy": "same-origin",
	// Podbay uses none of these device features, so no script in it may either.
	"Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
};

/** The headers of the app's pages and assets. */
export const PAGE_HEADERS: Readonly<Record<string, string>> = {
	"Content-Security-Policy": PAGE_CONTENT_POLICY,
	...COMMON_HEADERS,
};

/** The headers of everything the Worker answers itself. */
export const API_HEADERS: Readonly<Record<string, string>> = {
	"Content-Security-Policy": API_CONTENT_POLICY,
	...COMMON_HEADERS,
};

/** API answers are per person and must never be stored by a shared cache or the browser. */
export const API_CACHE_CONTROL = "no-store";

/** The content of `public/_headers`: every asset gets every page header. */
export function headersFile(): string {
	const lines = [
		"# Generated from shared/security-headers.ts by `node scripts/checks/headers.ts --write`.",
		"# Do not edit by hand: `pnpm static headers` fails when this file and that list differ.",
		"/*",
		...Object.entries(PAGE_HEADERS).map(([name, value]) => `  ${name}: ${value}`),
	];
	return `${lines.join("\n")}\n`;
}
