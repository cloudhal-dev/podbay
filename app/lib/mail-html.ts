// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * The only way mail HTML reaches the screen (rule S4).
 *
 * A message body is written by a stranger. It is shown in three layers, each of which holds on
 * its own:
 *
 * 1. `sanitizeMailHtml` removes script, forms, frames, embedded objects and event handlers,
 *    takes remote resources out unless the reader asked for them, and takes out every resource
 *    address that is neither embedded data nor remote: a relative address would resolve against
 *    the app itself. It takes out every transition and animation, so nothing in a message moves by
 *    itself. It also folds the quoted text at the end of a reply away behind one line.
 * 2. `mailDocument` wraps the result in a document whose content policy allows no script except
 *    the one sizing script (by nonce), no network load unless remote content was allowed, no
 *    form submission and no `<base>`.
 * 3. The component shows that document in a sandboxed frame without same-origin access.
 *
 * The frame is a `srcdoc` document, so the page's own content policy applies to it as well
 * (shared/security-headers.ts): the two are designed together, and a test holds the page's
 * policy to allowing exactly what this document needs.
 *
 * Nothing else in the app may inject HTML from a message.
 */

import { MAIL_FRAME_SCRIPT } from "shared/mail-frame";
import { m, t } from "../i18n";

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
/** A resource that is in the message itself. Nothing is fetched for it. */
const EMBEDDED_URL = /^\s*data:/i;
const CSS_REMOTE_URL = /url\(\s*['"]?\s*(?:https?:)?\/\//i;
const RESOURCE_ATTRIBUTES = ["src", "srcset", "poster", "background"];
/** A property that makes the message move by itself: a transition or an animation, prefixed or not. */
const MOTION_PROPERTY = /^(?:-[a-z]+-)?(?:transition|animation)(?:-|$)/i;

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

/** The addresses a resource attribute names: one, or several in a `srcset`. */
function addressesOf(attribute: string, value: string): string[] {
	return attribute === "srcset" ? value.split(",") : [value];
}

/**
 * What a resource attribute would load: `embedded` data that is in the message, a `remote`
 * address, or `neither`. A relative address is neither: in the mail frame it would resolve
 * against the app's own address, and a message has no business asking the app for anything.
 */
function resourceKind(attribute: string, value: string): "embedded" | "remote" | "neither" {
	const addresses = addressesOf(attribute, value);
	if (addresses.every((address) => EMBEDDED_URL.test(address))) return "embedded";
	if (addresses.every((address) => EMBEDDED_URL.test(address) || REMOTE_URL.test(address))) {
		return "remote";
	}
	return "neither";
}

/** The words on the line that stands for folded quoted text. */
export const QUOTE_SUMMARY = m("Show quoted text");
const QUOTE_CLASS = "podbay-quote";

/** Whether a node has something to read or to look at. */
function hasContent(node: Node): boolean {
	if ((node.textContent ?? "").trim() !== "") return true;
	if (node.nodeType !== 1) return false;
	const element = node as Element;
	return element.tagName === "IMG" || element.querySelector("img") !== null;
}

/**
 * Whether an element is the quoted text at the end of a reply: a `blockquote` that is not
 * inside another quote, has nothing to read after it, and is not the whole message.
 */
function isTrailingQuote(node: Element): boolean {
	if (node.tagName !== "BLOCKQUOTE" || !hasContent(node)) return false;
	if (node.parentElement?.closest(`blockquote, details`) != null) return false;
	let top: Element = node;
	for (let at: Element = node; at.parentElement !== null; at = at.parentElement) {
		for (let next = at.nextSibling; next !== null; next = next.nextSibling) {
			if (hasContent(next)) return false;
		}
		top = at.parentElement;
	}
	// Something of the message must stay on screen.
	return (top.textContent ?? "").trim().length > (node.textContent ?? "").trim().length;
}

/** Puts the quote inside a `details` element, which folds and opens without any script. */
function foldQuote(node: Element): void {
	const document = node.ownerDocument;
	const details = document.createElement("details");
	details.setAttribute("class", QUOTE_CLASS);
	const summary = document.createElement("summary");
	summary.textContent = t(QUOTE_SUMMARY);
	node.parentNode?.insertBefore(details, node);
	details.appendChild(summary);
	details.appendChild(node);
}

/**
 * Takes every transition and animation out of an element's own style. Nothing in a message needs
 * to move by itself, and a height that changes some time after the frame took it would look to
 * the sizing script like a message at rest (#110: `transition: height 0s .2s` on a height in
 * `vh`). The declarations are read by the browser's own parser, the one the frame uses, so what
 * is taken out is what the frame would have applied. A style the message writes elsewhere cannot
 * reach the frame: `<style>` is forbidden and the document's own sheet defines no keyframes.
 */
function stillStyle(node: Element): void {
	const style = (node as Partial<ElementCSSInlineStyle>).style;
	if (!node.hasAttribute("style") || style === undefined) return;
	const moving: string[] = [];
	for (let index = 0; index < style.length; index++) {
		const name = style.item(index);
		if (MOTION_PROPERTY.test(name)) moving.push(name);
	}
	for (const name of moving) style.removeProperty(name);
	if (style.length === 0) node.removeAttribute("style");
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
		for (const attribute of RESOURCE_ATTRIBUTES) {
			const value = node.getAttribute(attribute);
			if (value === null) continue;
			const kind = resourceKind(attribute, value);
			if (kind === "neither") {
				// Never loadable, whatever the reader allowed: not counted as something to allow.
				node.removeAttribute(attribute);
			} else if (kind === "remote" && !allowRemote) {
				node.removeAttribute(attribute);
				blockedRemote++;
			}
		}
		const style = node.getAttribute("style");
		if (!allowRemote && style !== null && CSS_REMOTE_URL.test(style)) {
			node.removeAttribute("style");
			blockedRemote++;
		}
		stillStyle(node);
		if (isTrailingQuote(node)) foldQuote(node);
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
	// Embedded images arrive as `data:` URLs (app/lib/attachments.ts); nothing is fetched for them.
	const images = options.allowRemote ? "img-src data: https:" : "img-src data:";
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
details.podbay-quote > summary {
	display: inline-block; list-style: none; cursor: pointer; user-select: none;
	margin: 8px 0; padding: 0 10px; border: 1px solid #d1d5db; border-radius: 9999px;
	font-size: 12px; line-height: 20px; color: #6b7280; background: #f9fafb;
}
details.podbay-quote > summary::-webkit-details-marker { display: none; }
pre { background: #f3f4f6; padding: 12px; border-radius: 6px; overflow-x: auto; font-size: 13px; }
table { border-collapse: collapse; max-width: 100%; }
td, th { padding: 4px 8px; }
p { margin: 4px 0; }
h1, h2, h3 { margin: 8px 0 4px; }
ul, ol { padding-left: 20px; margin: 4px 0; }
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
	const bodyStyle = options.autoSize
		? "padding: 0; overflow: hidden; display: flow-root;"
		: "padding: 24px;";
	const script = options.autoSize
		? `<script nonce="${options.nonce}">${MAIL_FRAME_SCRIPT}</script>`
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
