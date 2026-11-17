// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Options for listing and searching a mailbox. Values arrive as query strings, so every one is
 * parsed against a closed set here before it reaches the mailbox object (rule D2).
 */

export const SORT_COLUMNS = [
	"id",
	"subject",
	"sender",
	"recipient",
	"date",
	"read",
	"starred",
] as const;
export type SortColumn = (typeof SORT_COLUMNS)[number];
export type SortDirection = "ASC" | "DESC";

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

/** The sort column, or undefined when the value is not one of the allowed columns. */
export function parseSortColumn(value: string | undefined): SortColumn | undefined {
	return SORT_COLUMNS.find((column) => column === value);
}

/** `ASC` or `DESC` (any casing), or undefined. */
export function parseSortDirection(value: string | undefined): SortDirection | undefined {
	const upper = value?.toUpperCase();
	return upper === "ASC" || upper === "DESC" ? upper : undefined;
}
