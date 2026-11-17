// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Options for listing and searching a mailbox. Values arrive as query strings, so every one is
 * parsed against a closed set here before it reaches the mailbox object (rule D2).
 */
import { type ListOrder, parseListOrder } from "../../shared/list-order";

export { type ListOrder, parseListOrder };

export interface SearchFilterOptions {
	query: string;
	folder?: string;
	from?: string;
	to?: string;
	subject?: string;
	date_start?: string;
	date_end?: string;
	is_read?: boolean;
	is_starred?: boolean;
	has_attachment?: boolean;
	/** A label id: only messages that carry it, outside Spam and Trash. */
	label?: string;
}

/**
 * `ORDER BY` for a list of messages, by the order asked for (ADR-0014, decision 25). The text
 * is chosen from this closed set and never built from input. `alias` is the table's alias with
 * its dot, or nothing.
 */
export function messageOrderSql(order: ListOrder | undefined, alias = ""): string {
	const newest = `${alias}date DESC`;
	if (order === "unread") return `${alias}read ASC, ${newest}`;
	if (order === "starred") return `${alias}starred DESC, ${newest}`;
	return newest;
}

/**
 * The same for a list of conversations: `unread` and `starred` are the names of the columns
 * that count the unread and the starred messages of each conversation.
 */
export function conversationOrderSql(
	order: ListOrder | undefined,
	columns: { unread: string; starred: string; date: string },
): string {
	const newest = `${columns.date} DESC`;
	if (order === "unread") return `(${columns.unread} > 0) DESC, ${newest}`;
	if (order === "starred") return `(${columns.starred} > 0) DESC, ${newest}`;
	return newest;
}
