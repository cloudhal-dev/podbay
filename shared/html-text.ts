// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Text of an HTML fragment, without a DOM: for list snippets and quoted replies.
 *
 * The input may be cut anywhere (a snippet is the first few hundred characters of a body), so an
 * unclosed tag, comment, `<script>` or `<style>` at the end is dropped rather than shown. The
 * content of `<script>`, `<style>` and similar elements is never text. Linear scan, no regular
 * expression over the whole input.
 */

const RAW_TEXT_ELEMENTS = ["script", "style", "noscript", "template", "title", "head"];

function nameAt(html: string, from: number): string {
	let end = from;
	while (end < html.length && /[a-zA-Z0-9]/.test(html[end] ?? "")) end++;
	return html.slice(from, end).toLowerCase();
}

/**
 * Index just past the `</name ...>` that closes a raw-text element, or -1 when it never closes.
 * `lower` is the whole input in lower case, made once for each call of `htmlToText`: made here,
 * the work would grow with the square of the input, one copy for every such element.
 */
function endOfRawText(html: string, lower: string, from: number, name: string): number {
	let at = from;
	while (at < html.length) {
		const close = lower.indexOf(`</${name}`, at);
		if (close === -1) return -1;
		const after = lower[close + 2 + name.length];
		if (after === undefined || after === ">" || /\s|\//.test(after)) {
			const gt = html.indexOf(">", close);
			return gt === -1 ? -1 : gt + 1;
		}
		at = close + 2;
	}
	return -1;
}

const LINE_BREAK_ELEMENTS = [
	"p",
	"div",
	"li",
	"tr",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"blockquote",
];
/** Elements that separate words. An inline element such as `<b>` separates nothing. */
const BLOCK_ELEMENTS = new Set([
	...LINE_BREAK_ELEMENTS,
	"br",
	"td",
	"th",
	"table",
	"ul",
	"ol",
	"dl",
	"dt",
	"dd",
	"hr",
	"pre",
	"section",
	"article",
	"header",
	"footer",
	"img",
]);

/**
 * `keepLineBreaks` turns block boundaries into newlines (for quoting a message in a reply);
 * without it all whitespace collapses to single spaces (for a one-line snippet).
 */
export function htmlToText(html: string, options: { keepLineBreaks?: boolean } = {}): string {
	// A paragraph ends with a blank line, a line break or another block with a newline.
	const separator = (name: string, closing: boolean): string => {
		if (!BLOCK_ELEMENTS.has(name)) return "";
		if (!options.keepLineBreaks) return " ";
		if (name === "br") return "\n";
		if (!closing || !LINE_BREAK_ELEMENTS.includes(name)) return " ";
		return name === "p" ? "\n\n" : "\n";
	};
	let out = "";
	let i = 0;
	// Only for finding where a raw-text element closes; nothing is read from it as text.
	let lower: string | null = null;
	while (i < html.length) {
		const lt = html.indexOf("<", i);
		if (lt === -1) {
			out += html.slice(i);
			break;
		}
		out += html.slice(i, lt);
		if (html.startsWith("<!--", lt)) {
			const end = html.indexOf("-->", lt + 4);
			if (end === -1) break;
			i = end + 3;
			continue;
		}
		const closing = html[lt + 1] === "/";
		const name = nameAt(html, lt + (closing ? 2 : 1));
		if (name === "") {
			// A bare "<" that starts no tag ("a < b") is text.
			out += "<";
			i = lt + 1;
			continue;
		}
		const gt = html.indexOf(">", lt);
		if (gt === -1) break;
		if (!closing && RAW_TEXT_ELEMENTS.includes(name)) {
			lower ??= html.toLowerCase();
			const end = endOfRawText(html, lower, gt + 1, name);
			if (end === -1) break;
			i = end;
			out += " ";
			continue;
		}
		out += separator(name, closing);
		i = gt + 1;
	}
	if (!options.keepLineBreaks) return out.replace(/\s+/g, " ").trim();
	return out
		.split("\n")
		.map((line) => line.replace(/[ \t\r\f\v]+/g, " ").trim())
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

const NAMED: Record<string, string> = {
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
	amp: "&",
};

/** Character references back to characters, each once: what one makes is not read again. */
export function decodeEntities(text: string): string {
	return text.replace(
		/&(#\d{1,7}|#x[0-9a-f]{1,6}|lt|gt|quot|apos|nbsp|amp);/gi,
		(match: string, name: string) => {
			const lower = name.toLowerCase();
			if (!lower.startsWith("#")) return NAMED[lower] ?? match;
			const code = lower.startsWith("#x")
				? Number.parseInt(lower.slice(2), 16)
				: Number(lower.slice(1));
			return Number.isInteger(code) && code > 0 && code <= 0x10ffff
				? String.fromCodePoint(code)
				: match;
		},
	);
}

/**
 * The text form of a message written as HTML, as it leaves beside the HTML (ADR-0016): the
 * mailbox keeps one body and makes the text from it when the message leaves.
 */
export function plainTextOf(html: string): string {
	return decodeEntities(htmlToText(html, { keepLineBreaks: true }));
}

/**
 * The text of an HTML fragment on one line, its character references decoded once: for what a
 * model, a tool or a quoted reply is given. Text, never markup: whatever uses it as HTML
 * escapes it first.
 */
export function oneLineTextOf(html: string): string {
	return decodeEntities(htmlToText(html));
}
