// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * The only way mail HTML reaches the screen (rule S4).
 *
 * A message body is written by a stranger. It is shown in three layers, each of which holds on
 * its own:
 *
 * 1. `sanitizeMailHtml` removes script, forms, frames, embedded objects and event handlers, and
 *    takes remote resources out unless the reader asked for them.
 * 2. `mailDocument` wraps the result in a document whose content policy allows no script except
 *    the one sizing script (by nonce), no network load unless remote content was allowed, no
 *    form submission and no `<base>`.
 * 3. The component shows that document in a sandboxed frame without same-origin access.
 *
 * Nothing else in the app may inject HTML from a message.
 */

/** The part of DOMPurify this module uses. Tests pass an instance bound to their own DOM. */
export interface Purifier {
	sanitize(html: string, config: Record<string, unknown>): string;
	addHook(name: "afterSanitizeAttributes", hook: (node: Element) => void): void;
	removeHook(name: "afterSanitizeAttributes"): void;
}

export interface SanitizedMail {
	readonly html: string;
	/** How many remote resources were taken out. Zero when remote content is allowed. */
	readonly blockedRemote: number;
}

const REMOTE_URL = /^\s*(?:https?:)?\/\//i;
const CSS_REMOTE_URL = /url\(\s*['"]?\s*(?:https?:)?\/\//i;
const RESOURCE_ATTRIBUTES = ["src", "srcset", "poster", "background"];

const SANITIZE_CONFIG = {
	USE_PROFILES: { html: true },
	FORBID_TAGS: [
		"style",
		"form",
		"input",
		"button",
		"select",
		"textarea",
		"option",
		"iframe",
		"frame",
		"frameset",
		"object",
		"embed",
		"base",
		"meta",
		"link",
		"audio",
		"video",
		"source",
		"track",
	],
	FORBID_ATTR: ["action", "formaction", "ping", "srcdoc"],
	ADD_ATTR: ["target"],
	FORCE_BODY: true,
};

function isRemote(attribute: string, value: string): boolean {
	if (attribute === "srcset") return value.split(",").some((part) => REMOTE_URL.test(part));
	return REMOTE_URL.test(value);
}

/**
 * Sanitise a message body. With `allowRemote` false, every attribute that would load a remote
 * resource is removed and counted, so the reader can be told and can choose to load them.
 */
export function sanitizeMailHtml(
	body: string,
	options: { readonly allowRemote: boolean; readonly purify: Purifier },
): SanitizedMail {
	let blockedRemote = 0;
	const { purify, allowRemote } = options;
	purify.addHook("afterSanitizeAttributes", (node) => {
		if (node.tagName === "A") {
			// A link opens outside the frame and tells the destination nothing about the reader.
			node.setAttribute("target", "_blank");
			node.setAttribute("rel", "noopener noreferrer nofollow");
		}
		if (allowRemote) return;
		for (const attribute of RESOURCE_ATTRIBUTES) {
			const value = node.getAttribute(attribute);
			if (value !== null && isRemote(attribute, value)) {
				node.removeAttribute(attribute);
				blockedRemote++;
			}
		}
		const style = node.getAttribute("style");
		if (style !== null && CSS_REMOTE_URL.test(style)) {
			node.removeAttribute("style");
			blockedRemote++;
		}
	});
	try {
		return { html: purify.sanitize(body, SANITIZE_CONFIG), blockedRemote };
	} finally {
		purify.removeHook("afterSanitizeAttributes");
	}
}

/** The content policy of the mail document. Remote images load only when the reader allowed them. */
export function mailContentPolicy(options: {
	readonly allowRemote: boolean;
	readonly nonce: string;
}): string {
	const images = options.allowRemote ? "img-src data: cid: https:" : "img-src data: cid:";
	return [
		"default-src 'none'",
		"style-src 'unsafe-inline'",
		images,
		`script-src 'nonce-${options.nonce}'`,
		"form-action 'none'",
		"base-uri 'none'",
	].join("; ");
}

const NONCE = /^[A-Za-z0-9+/_-]{16,}={0,2}$/;

const BASE_STYLE = `
* { box-sizing: border-box; }
html { background: #ffffff; color-scheme: light; }
body {
	font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
	font-size: 14px;
	line-height: 1.6;
	color: #1a1a1a;
	background: #ffffff;
	margin: 0;
	word-wrap: break-word;
	overflow-wrap: break-word;
}
[style*="position: fixed"], [style*="position:fixed"], [style*="position: absolute"], [style*="position:absolute"] {
	position: relative !important;
}
a { color: #2563eb; }
img { max-width: 100%; height: auto; }
blockquote { border-left: 3px solid #d1d5db; padding-left: 1em; margin-left: 0; color: #6b7280; }
pre { background: #f3f4f6; padding: 12px; border-radius: 6px; overflow-x: auto; font-size: 13px; }
table { border-collapse: collapse; max-width: 100%; }
td, th { padding: 4px 8px; }
p { margin: 4px 0; }
h1, h2, h3 { margin: 8px 0 4px; }
ul, ol { padding-left: 20px; margin: 4px 0; }
`;

/** The one script in the document: it tells the parent how tall the content is. */
const HEIGHT_SCRIPT = `
function reportHeight() {
	var h = document.body.scrollHeight;
	if (h > 0) parent.postMessage({ __emailIframeHeight: true, height: h }, "*");
}
reportHeight();
setTimeout(reportHeight, 50);
setTimeout(reportHeight, 150);
setTimeout(reportHeight, 400);
`;

/**
 * The full document for the sandboxed frame. `sanitizedBody` must come from `sanitizeMailHtml`.
 * `nonce` must be fresh random data for each document.
 */
export function mailDocument(options: {
	readonly sanitizedBody: string;
	readonly autoSize: boolean;
	readonly allowRemote: boolean;
	readonly nonce: string;
}): string {
	if (!NONCE.test(options.nonce)) throw new Error("mailDocument: the nonce is not base64 text");
	const policy = mailContentPolicy(options);
	const bodyStyle = options.autoSize ? "padding: 0; overflow: hidden;" : "padding: 24px;";
	const script = options.autoSize
		? `<script nonce="${options.nonce}">${HEIGHT_SCRIPT}</script>`
		: "";
	return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${policy}">
<meta name="referrer" content="no-referrer">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${BASE_STYLE}body { ${bodyStyle} }</style>
</head>
<body>${options.sanitizedBody}${script}</body>
</html>`;
}

/** A fresh nonce for one mail document. */
export function freshNonce(): string {
	const bytes = new Uint8Array(18);
	crypto.getRandomValues(bytes);
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}
