// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified by the Podbay contributors.

/**
 * Parse a Gmail-style search query into structured filters.
 *
 * Supported operators:
 *   from:user@example.com    — filter by sender
 *   to:user@example.com      — filter by recipient
 *   subject:hello             — filter by subject
 *   in:inbox / in:sent        — filter by folder
 *   is:unread / is:read       — filter by read status
 *   is:starred                — filter by starred status
 *   has:attachment             — filter by attachment presence
 *   label:name                — conversations that carry a label
 *   before:2025-01-01         — emails before date
 *   after:2025-01-01          — emails after date
 *
 * Quoted values are supported: from:"John Doe" subject:"Re: Hello"
 * Everything that isn't an operator becomes the free-text query.
 */

export interface ParsedSearch {
	query: string;
	from?: string;
	to?: string;
	subject?: string;
	folder?: string;
	is_read?: boolean;
	is_starred?: boolean;
	has_attachment?: boolean;
	/** A label's name, as the person wrote it. */
	label?: string;
	date_start?: string;
	date_end?: string;
}

// Matches operator:value or operator:"quoted value"
const OPERATOR_RE = /\b(from|to|subject|in|is|has|label|before|after):(?:"([^"]*?)"|(\S+))/gi;

export function parseSearchQuery(input: string): ParsedSearch {
	const result: ParsedSearch = { query: "" };

	// Extract all operators
	let remaining = input;
	let match: RegExpExecArray | null;

	// Reset lastIndex since we reuse the regex
	OPERATOR_RE.lastIndex = 0;
	const matches: { fullMatch: string; op: string; value: string }[] = [];

	while ((match = OPERATOR_RE.exec(input)) !== null) {
		const op = match[1].toLowerCase();
		const value = match[2] ?? match[3]; // quoted or unquoted
		matches.push({ fullMatch: match[0], op, value });
	}

	// Remove matched operators from the input to get the free-text query
	for (const m of matches) {
		remaining = remaining.replace(m.fullMatch, "");
	}

	// Clean up remaining text as the free-text query
	result.query = remaining.replace(/\s+/g, " ").trim();

	// Apply operators
	for (const { op, value } of matches) {
		switch (op) {
			case "from":
				result.from = value;
				break;
			case "to":
				result.to = value;
				break;
			case "subject":
				result.subject = value;
				break;
			case "in":
				result.folder = value.toLowerCase();
				break;
			case "is":
				switch (value.toLowerCase()) {
					case "unread":
						result.is_read = false;
						break;
					case "read":
						result.is_read = true;
						break;
					case "starred":
						result.is_starred = true;
						break;
					case "unstarred":
						result.is_starred = false;
						break;
				}
				break;
			case "has":
				if (value.toLowerCase() === "attachment") {
					result.has_attachment = true;
				}
				break;
			case "label":
				result.label = value;
				break;
			case "before":
				result.date_end = normalizeDate(value);
				break;
			case "after":
				result.date_start = normalizeDate(value);
				break;
		}
	}

	return result;
}

/**
 * Normalize a date string to ISO format. Accepts YYYY-MM-DD or various
 * Date-parseable strings.
 */
function normalizeDate(value: string): string | undefined {
	try {
		const d = new Date(value);
		if (isNaN(d.getTime())) return undefined;
		return d.toISOString();
	} catch {
		return undefined;
	}
}

/** What the search options dialog collects. Dates are days, as a date field gives them. */
export interface SearchOptions {
	words: string;
	from: string;
	to: string;
	subject: string;
	/** A folder id, or "" for everywhere. */
	folder: string;
	/** A label's name, or "" for any. */
	label: string;
	hasAttachment: boolean;
	unreadOnly: boolean;
	after: string;
	before: string;
}

export const NO_SEARCH_OPTIONS: SearchOptions = {
	words: "",
	from: "",
	to: "",
	subject: "",
	folder: "",
	label: "",
	hasAttachment: false,
	unreadOnly: false,
	after: "",
	before: "",
};

/** A value as an operator takes it: quoted when it has a space, never with a quote inside. */
function operand(value: string): string {
	const clean = value.replace(/"/g, "").trim();
	return /\s/.test(clean) ? `"${clean}"` : clean;
}

/** The query that says the same as the options, in the form `parseSearchQuery` reads. */
export function buildSearchQuery(options: SearchOptions): string {
	const parts: string[] = [];
	const add = (operator: string, value: string) => {
		if (operand(value) !== "") parts.push(`${operator}:${operand(value)}`);
	};
	add("from", options.from);
	add("to", options.to);
	add("subject", options.subject);
	add("in", options.folder);
	add("label", options.label);
	if (options.hasAttachment) parts.push("has:attachment");
	if (options.unreadOnly) parts.push("is:unread");
	add("after", options.after);
	add("before", options.before);
	const words = options.words.replace(/\s+/g, " ").trim();
	if (words !== "") parts.push(words);
	return parts.join(" ");
}

/** The options a query stands for, to fill the dialog with what the search box already says. */
export function searchOptionsOf(query: string): SearchOptions {
	const parsed = parseSearchQuery(query);
	return {
		words: parsed.query,
		from: parsed.from ?? "",
		to: parsed.to ?? "",
		subject: parsed.subject ?? "",
		folder: parsed.folder ?? "",
		label: parsed.label ?? "",
		hasAttachment: parsed.has_attachment === true,
		unreadOnly: parsed.is_read === false,
		after: parsed.date_start?.slice(0, 10) ?? "",
		before: parsed.date_end?.slice(0, 10) ?? "",
	};
}

/** Whether a query carries an operator such as `has:attachment`, as a word of its own. */
export function hasOperator(query: string, operator: string): boolean {
	return query.split(/\s+/).some((word) => word.toLowerCase() === operator.toLowerCase());
}

/** The query with an operator added, or taken out when it is there. Nothing else changes. */
export function toggleOperator(query: string, operator: string): string {
	const words = query.split(/\s+/).filter((word) => word !== "");
	return hasOperator(query, operator)
		? words.filter((word) => word.toLowerCase() !== operator.toLowerCase()).join(" ")
		: [...words, operator].join(" ");
}
