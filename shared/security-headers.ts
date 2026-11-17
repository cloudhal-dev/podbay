// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * The response headers every page and every API answer carries (rule S11). One list, used twice:
 * the Worker sets it on what it answers, and `public/_headers` (generated from this list by
 * `node scripts/checks/headers.ts --write`) sets it on the static assets, which the Worker never
 * sees.
 *
 * Not here yet: a full content policy for scripts and images. The mail frame is a `srcdoc`
 * document and inherits the page's policy, so that policy has to be designed together with the
 * frame's own. Until then the page's policy only forbids being framed.
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
	// Nobody may put Podbay in a frame: no clickjacking of a signed-in inbox.
	"Content-Security-Policy": "frame-ancestors 'none'",
	"X-Frame-Options": "DENY",
	// A response is what its Content-Type says, never what its bytes look like.
	"X-Content-Type-Options": "nosniff",
	// A link out of Podbay tells the destination nothing about the mailbox it came from.
	"Referrer-Policy": "no-referrer",
	// Podbay is served over HTTPS only. Subdomains are the deployer's own business.
	"Strict-Transport-Security": "max-age=31536000",
	// Another window that Podbay opens, or that opens Podbay, gets no handle on it.
	"Cross-Origin-Opener-Policy": "same-origin",
	// Podbay uses none of these device features, so no script in it may either.
	"Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
};

/** API answers are per person and must never be stored by a shared cache or the browser. */
export const API_CACHE_CONTROL = "no-store";

/** The content of `public/_headers`: every asset gets every header. */
export function headersFile(): string {
	const lines = [
		"# Generated from shared/security-headers.ts by `node scripts/checks/headers.ts --write`.",
		"# Do not edit by hand: `pnpm static headers` fails when this file and that list differ.",
		"/*",
		...Object.entries(SECURITY_HEADERS).map(([name, value]) => `  ${name}: ${value}`),
	];
	return `${lines.join("\n")}\n`;
}
