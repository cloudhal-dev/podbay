// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified by the Podbay contributors.

/**
 * Searching a mailbox: the conditions a search is made of, the list and its count. Moved out
 * of `./index.ts`, which calls these with the mailbox's own database.
 */

import { type ListOrder, messageOrderSql, type SearchFilterOptions } from "../lib/list-options";
import { HIDDEN } from "./labels";

/**
 * Build WHERE conditions and params for search queries.
 * Shared between searchEmails and countSearchResults, and by the deed on everything a search
 * finds (ADR-0014, decision 7: `./deeds`), so the three cannot differ.
 */
export function buildSearchConditions(
	options: SearchFilterOptions,
	tableAlias = "",
): { conditions: string[]; params: (string | number)[] } {
	const {
		query,
		folder,
		from,
		to,
		subject,
		date_start,
		date_end,
		is_read,
		is_starred,
		has_attachment,
	} = options;
	const prefix = tableAlias ? `${tableAlias}.` : "";
	const conditions: string[] = [];
	const params: (string | number)[] = [];
	let paramIdx = 0;

	const addParam = (value: string | number) => {
		paramIdx++;
		params.push(value);
		return `?${paramIdx}`;
	};

	if (query) {
		const p1 = addParam(`%${query}%`);
		const p2 = addParam(`%${query}%`);
		const p3 = addParam(`%${query}%`);
		const p4 = addParam(`%${query}%`);
		conditions.push(
			`(${prefix}subject LIKE ${p1} OR ${prefix}body LIKE ${p2} OR ${prefix}sender LIKE ${p3} OR ${prefix}recipient LIKE ${p4} OR ${prefix}cc LIKE ${p4} OR ${prefix}bcc LIKE ${p4})`,
		);
	}
	if (folder) {
		const p = addParam(folder);
		conditions.push(
			`${prefix}folder_id = (SELECT id FROM folders WHERE name = ${p} OR id = ${p} LIMIT 1)`,
		);
	} else conditions.push(`${prefix}folder_id NOT IN ${HIDDEN}`);
	if (from) {
		const p = addParam(`%${from}%`);
		conditions.push(`${prefix}sender LIKE ${p}`);
	}
	if (to) {
		const p = addParam(`%${to}%`);
		conditions.push(
			`(${prefix}recipient LIKE ${p} OR ${prefix}cc LIKE ${p} OR ${prefix}bcc LIKE ${p})`,
		);
	}
	if (subject) {
		const p = addParam(`%${subject}%`);
		conditions.push(`${prefix}subject LIKE ${p}`);
	}
	if (date_start) {
		const p = addParam(date_start);
		conditions.push(`${prefix}date >= ${p}`);
	}
	if (date_end) {
		const p = addParam(date_end);
		conditions.push(`${prefix}date <= ${p}`);
	}
	if (is_read !== undefined) {
		const p = addParam(is_read ? 1 : 0);
		conditions.push(`${prefix}read = ${p}`);
	}
	if (is_starred !== undefined) {
		const p = addParam(is_starred ? 1 : 0);
		conditions.push(`${prefix}starred = ${p}`);
	}
	if (has_attachment) {
		conditions.push(
			`${prefix}id IN (SELECT DISTINCT email_id FROM attachments WHERE uploading_since IS NULL)`,
		);
	}
	if (options.label) {
		// A label's list never shows what is in Spam or Trash (ADR-0007, decision 8).
		const p = addParam(options.label);
		conditions.push(
			`${prefix}id IN (SELECT email_id FROM email_labels WHERE label_id = ${p}) AND ${prefix}folder_id NOT IN ('spam', 'trash')`,
		);
	}

	return { conditions, params };
}

export function searchEmails(
	sql: SqlStorage,
	options: SearchFilterOptions & { page?: number; limit?: number; order?: ListOrder },
) {
	const { page = 1, limit: rawLimit = 25 } = options;
	const limit = Math.min(Math.max(rawLimit, 1), 100);
	const { conditions, params } = buildSearchConditions(options, "e");

	const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
	const offset = (page - 1) * limit;

	const query = `
		SELECT e.id, e.subject, e.sender, e.recipient, e.cc, e.bcc, e.date,
			e.read, e.starred, e.in_reply_to, e.email_references,
			e.thread_id, e.folder_id,
			SUBSTR(e.body, 1, 300) as snippet,
			f.name as folder_name
		FROM emails e
		LEFT JOIN folders f ON e.folder_id = f.id
		${where}
		ORDER BY ${messageOrderSql(options.order, "e.")} LIMIT ?${params.length + 1} OFFSET ?${params.length + 2}`;
	params.push(limit, offset);

	const result = sql.exec(query, ...params);
	const list = [...result].map((row) => ({
		...row,
		read: !!row.read,
		starred: !!row.starred,
	}));
	return list;
}

/**
 * Count total search results matching the given filters (for pagination).
 */
export function countSearchResults(sql: SqlStorage, options: SearchFilterOptions): number {
	const { conditions, params } = buildSearchConditions(options);

	const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
	const query = `SELECT COUNT(*) as total FROM emails ${where}`;

	const row = [...sql.exec(query, ...params)][0] as { total: number } | undefined;
	return row?.total ?? 0;
}
