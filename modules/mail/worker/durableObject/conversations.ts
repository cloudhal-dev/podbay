// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified by the Podbay contributors.

/**
 * The list of a place by conversation, and its count: raw SQL, too involved for the query
 * builder. Moved out of `./index.ts` unchanged, which calls these with the mailbox's own
 * database and adds the labels and what a message says about its way out.
 */
import { Folders } from "../../shared/folders";
import { conversationOrderSql } from "../lib/list-options";
import type { GetEmailsOptions } from "./shapes";

/**
 * SQL expression to normalize email subjects by stripping common
 * reply/forward prefixes (Re:, Fwd:, FW:, AW:, WG:, Réf:, SV:).
 * Used for conversation grouping. Hardcoded to the `subject` column.
 */
const NORMALIZED_SUBJECT_SQL = `LOWER(TRIM(
	REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
		LOWER(subject),
		'aw: ', ''), 'wg: ', ''), 'réf: ', ''), 'sv: ', ''),
		're: ', ''), 'fwd: ', ''), 'fw: ', '')
))`;

/** The conversations of a place, one line each, with what the line needs of its conversation. */
export function listConversations(
	sql: SqlStorage,
	options: GetEmailsOptions & { folder: string },
): Record<string, unknown>[] {
	const { folder, page = 1, limit: rawLimit = 25, order } = options;
	const limit = Math.min(Math.max(rawLimit, 1), 100);

	const offset = (page - 1) * limit;

	// Thread grouping strategy:
	// For DRAFT folder: group by in_reply_to (the email being replied to).
	//   This ensures reply-drafts to different emails stay separate, even if
	//   they share a thread_id or subject. New drafts (no in_reply_to) each
	//   get their own group via their unique id.
	// For other folders:
	//   1. Primary: group by thread_id (from email threading headers)
	//   2. Fallback: group by normalized subject (strips Re:/Fwd:/FW: prefixes)
	//      for legacy emails that lack threading headers (thread_id IS NULL).
	const isDraftFolder = folder === Folders.DRAFT;

	if (isDraftFolder) {
		const result = sql.exec(
			`WITH
			folder_emails AS (
				SELECT *,
					COALESCE(in_reply_to, id) as draft_group_key
				FROM emails
				WHERE folder_id = (SELECT id FROM folders WHERE name = ?1 OR id = ?1 LIMIT 1)
			),
			draft_stats AS (
				SELECT
					draft_group_key,
					COUNT(*) as thread_count,
					SUM(CASE WHEN read = 0 THEN 1 ELSE 0 END) as thread_unread_count,
					SUM(CASE WHEN starred = 1 THEN 1 ELSE 0 END) as thread_starred_count,
					GROUP_CONCAT(DISTINCT sender) as participants
				FROM folder_emails
				GROUP BY draft_group_key
			),
			latest_per_group AS (
				SELECT
					fe.*,
					ROW_NUMBER() OVER (
						PARTITION BY fe.draft_group_key
						ORDER BY fe.date DESC
					) as rn
				FROM folder_emails fe
			)
			SELECT
				lp.id, lp.subject, lp.sender, lp.recipient, lp.date,
				lp.read, lp.starred, lp.thread_id, lp.folder_id,
				lp.in_reply_to, lp.email_references,
				SUBSTR(lp.body, 1, 300) as snippet,
				ds.thread_count, ds.thread_unread_count, ds.participants
			FROM latest_per_group lp
			JOIN draft_stats ds ON lp.draft_group_key = ds.draft_group_key
			WHERE lp.rn = 1
			ORDER BY ${conversationOrderSql(order, {
				unread: "ds.thread_unread_count",
				starred: "ds.thread_starred_count",
				date: "lp.date",
			})}
			LIMIT ?2 OFFSET ?3`,
			folder,
			limit,
			offset,
		);

		const rows = [...result];
		const list = rows.map((row) => ({
			...row,
			read: !!row.read,
			starred: !!row.starred,
			thread_count: row.thread_count || 1,
			thread_unread_count: row.thread_unread_count || 0,
			participants: row.participants || row.sender,
		}));
		return list;
	}

	// Non-draft folders: full threading logic
	const result = sql.exec(
		`WITH
		folder_emails AS (
			SELECT *,
				COALESCE(thread_id, id) as raw_thread_id,
				${NORMALIZED_SUBJECT_SQL} as normalized_subject
			FROM emails
			WHERE folder_id = (SELECT id FROM folders WHERE name = ?1 OR id = ?1 LIMIT 1)
		),
		thread_to_conversation AS (
			SELECT
				raw_thread_id,
				normalized_subject,
				CASE
					WHEN thread_id IS NOT NULL THEN raw_thread_id
					ELSE MIN(raw_thread_id) OVER (PARTITION BY normalized_subject)
				END as conversation_id
			FROM folder_emails
			GROUP BY raw_thread_id, normalized_subject, thread_id
		),
		all_emails_with_conversation AS (
			SELECT
				e.*,
				COALESCE(tc.conversation_id, COALESCE(e.thread_id, e.id)) as conversation_id
			FROM emails e
			LEFT JOIN thread_to_conversation tc
				ON COALESCE(e.thread_id, e.id) = tc.raw_thread_id
		),
		conversation_stats AS (
			SELECT
				conversation_id,
				COUNT(*) as thread_count,
				SUM(CASE WHEN read = 0 THEN 1 ELSE 0 END) as thread_unread_count,
				SUM(CASE WHEN read = 1 THEN 1 ELSE 0 END) as thread_read_count,
				SUM(CASE WHEN starred = 1 THEN 1 ELSE 0 END) as thread_starred_count,
				GROUP_CONCAT(DISTINCT sender) as participants,
				SUM(CASE WHEN folder_id = (SELECT id FROM folders WHERE name = 'draft' LIMIT 1) THEN 1 ELSE 0 END) as has_draft
			FROM all_emails_with_conversation
			WHERE conversation_id IN (
				SELECT DISTINCT conversation_id FROM all_emails_with_conversation
				WHERE folder_id = (SELECT id FROM folders WHERE name = ?1 OR id = ?1 LIMIT 1)
			)
			GROUP BY conversation_id
		),
		latest_message_per_conversation AS (
			SELECT
				conversation_id,
				folder_id,
				ROW_NUMBER() OVER (PARTITION BY conversation_id ORDER BY date DESC) as rn
			FROM all_emails_with_conversation
		),
		latest_in_folder AS (
			SELECT
				fe.*,
				COALESCE(tc.conversation_id, fe.raw_thread_id) as conversation_id,
				ROW_NUMBER() OVER (
					PARTITION BY COALESCE(tc.conversation_id, fe.raw_thread_id)
					ORDER BY fe.date DESC
				) as rn
			FROM folder_emails fe
			LEFT JOIN thread_to_conversation tc
				ON fe.raw_thread_id = tc.raw_thread_id
		)
		SELECT
			lif.id, lif.subject, lif.sender, lif.recipient, lif.date,
			lif.read, lif.starred, lif.thread_id, lif.folder_id,
			lif.in_reply_to, lif.email_references,
			SUBSTR(lif.body, 1, 300) as snippet,
			cs.thread_count, cs.thread_unread_count, cs.participants,
			CASE WHEN lmc.folder_id != (SELECT id FROM folders WHERE name = 'sent' LIMIT 1)
				AND lmc.folder_id != (SELECT id FROM folders WHERE name = 'draft' LIMIT 1)
				AND cs.thread_read_count > 0
				THEN 1 ELSE 0 END as needs_reply,
			CASE WHEN cs.has_draft > 0 THEN 1 ELSE 0 END as has_draft
		FROM latest_in_folder lif
		JOIN conversation_stats cs ON lif.conversation_id = cs.conversation_id
		LEFT JOIN latest_message_per_conversation lmc
			ON lmc.conversation_id = lif.conversation_id AND lmc.rn = 1
		WHERE lif.rn = 1
		ORDER BY ${conversationOrderSql(order, {
			unread: "cs.thread_unread_count",
			starred: "cs.thread_starred_count",
			date: "lif.date",
		})}
		LIMIT ?2 OFFSET ?3`,
		folder,
		limit,
		offset,
	);

	const rows = [...result];
	const list = rows.map((row) => ({
		...row,
		read: !!row.read,
		starred: !!row.starred,
		thread_count: row.thread_count || 1,
		thread_unread_count: row.thread_unread_count || 0,
		participants: row.participants || row.sender,
		needs_reply: !!row.needs_reply,
		has_draft: !!row.has_draft,
	}));
	return list;
}

/**
 * Count threaded conversations in a folder (for pagination).
 * Returns the number of conversation groups, not individual emails.
 */
export function countConversations(sql: SqlStorage, folder: string): number {
	const isDraftFolder = folder === Folders.DRAFT;

	if (isDraftFolder) {
		const row = [
			...sql.exec(
				`SELECT COUNT(DISTINCT COALESCE(in_reply_to, id)) as total
				 FROM emails
				 WHERE folder_id = (SELECT id FROM folders WHERE name = ?1 OR id = ?1 LIMIT 1)`,
				folder,
			),
		][0] as { total: number } | undefined;
		return row?.total ?? 0;
	}

	const row = [
		...sql.exec(
			`WITH
			folder_emails AS (
				SELECT
					COALESCE(thread_id, id) as raw_thread_id,
					thread_id,
				${NORMALIZED_SUBJECT_SQL} as normalized_subject
				FROM emails
				WHERE folder_id = (SELECT id FROM folders WHERE name = ?1 OR id = ?1 LIMIT 1)
			),
			thread_to_conversation AS (
				SELECT
					raw_thread_id,
					CASE
						WHEN thread_id IS NOT NULL THEN raw_thread_id
						WHEN normalized_subject != '' THEN MIN(raw_thread_id) OVER (PARTITION BY normalized_subject)
						ELSE raw_thread_id
					END as conversation_id
				FROM folder_emails
				GROUP BY raw_thread_id, normalized_subject, thread_id
			)
			SELECT COUNT(DISTINCT conversation_id) as total
			FROM thread_to_conversation`,
			folder,
		),
	][0] as { total: number } | undefined;
	return row?.total ?? 0;
}
