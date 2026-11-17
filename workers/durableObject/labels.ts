// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Labels in a mailbox's database (ADR-0007). The mailbox object's methods call these; they are
 * here because the object's own file is at its size limit.
 *
 * - A label belongs to this mailbox. Its id is opaque; its name is unique without regard to case.
 * - A label is on messages. People act on conversations: labelling one labels every message of
 *   it that is not in Spam or Trash, and a line in a list shows what any of its messages carry.
 * - Deleting a label deletes no mail. Deleting a message removes its label rows here, without
 *   relying on the database to cascade.
 */
import { Folders } from "../../shared/folders";
import { LABEL_LIMITS, labelKey, newLabelId } from "../../shared/labels";

export interface Label {
	id: string;
	name: string;
	color: number;
	/** Messages that carry it, outside Spam and Trash. */
	total: number;
	unread: number;
}

/** Why a change was refused. */
export type LabelRefusal = "exists" | "limit" | "not_found";

/** What a transaction needs: the object's storage. */
interface Storage {
	sql: SqlStorage;
	transactionSync: <T>(closure: () => T) => T;
}

/**
 * Constants of the code, never input: a label's list and a conversation's labels skip these,
 * and so does a search that names no place. What is in Spam or Trash is found by asking there.
 */
export const HIDDEN = `('${Folders.SPAM}', '${Folders.TRASH}')`;
/** A query takes at most 100 bound parameters (docs/cloudflare/ledger.json). */
const CHUNK = 90;

const rows = <T>(cursor: Iterable<unknown>): T[] => [...cursor] as T[];

export function listLabels(sql: SqlStorage): Label[] {
	return rows<Label>(
		sql.exec(
			`SELECT l.id, l.name, l.color,
				COUNT(e.id) AS total,
				COALESCE(SUM(CASE WHEN e.read = 0 THEN 1 ELSE 0 END), 0) AS unread
			FROM labels l
			LEFT JOIN email_labels el ON el.label_id = l.id
			LEFT JOIN emails e ON e.id = el.email_id AND e.folder_id NOT IN ${HIDDEN}
			GROUP BY l.id
			ORDER BY l.name COLLATE NOCASE`,
		),
	);
}

/** The id of another label with the same name, whatever its case. */
function namesake(sql: SqlStorage, name: string, except?: string): string | undefined {
	const key = labelKey(name);
	return rows<{ id: string; name: string }>(sql.exec(`SELECT id, name FROM labels`)).find(
		(label) => label.id !== except && labelKey(label.name) === key,
	)?.id;
}

function one(sql: SqlStorage, id: string): Label | undefined {
	return listLabels(sql).find((label) => label.id === id);
}

/** `name` and `color` are already cleaned by the caller (`shared/labels.ts`). */
export function createLabel(sql: SqlStorage, name: string, color: number): Label | LabelRefusal {
	const count = rows<{ n: number }>(sql.exec(`SELECT COUNT(*) AS n FROM labels`))[0]?.n ?? 0;
	if (count >= LABEL_LIMITS.perMailbox) return "limit";
	if (namesake(sql, name)) return "exists";
	const id = newLabelId();
	sql.exec(
		`INSERT INTO labels (id, name, color, created_at) VALUES (?, ?, ?, ?)`,
		id,
		name,
		color,
		new Date().toISOString(),
	);
	return { id, name, color, total: 0, unread: 0 };
}

export function updateLabel(
	sql: SqlStorage,
	id: string,
	change: { name?: string; color?: number },
): Label | LabelRefusal {
	if (!one(sql, id)) return "not_found";
	if (change.name !== undefined) {
		if (namesake(sql, change.name, id)) return "exists";
		sql.exec(`UPDATE labels SET name = ? WHERE id = ?`, change.name, id);
	}
	if (change.color !== undefined) {
		sql.exec(`UPDATE labels SET color = ? WHERE id = ?`, change.color, id);
	}
	return one(sql, id) ?? "not_found";
}

/** Takes the label off every message and removes it. No message is deleted or moved. */
export function deleteLabel(storage: Storage, id: string): boolean {
	if (!one(storage.sql, id)) return false;
	storage.transactionSync(() => {
		storage.sql.exec(`DELETE FROM email_labels WHERE label_id = ?`, id);
		storage.sql.exec(`DELETE FROM labels WHERE id = ?`, id);
	});
	return true;
}

/** A message that is deleted for good takes its label rows with it (rule S13). */
export function forgetLabelsOf(sql: SqlStorage, emailId: string): void {
	sql.exec(`DELETE FROM email_labels WHERE email_id = ?`, emailId);
}

class OverTheLimit extends Error {}

/**
 * Give labels to, and take labels from, the conversation a message belongs to. Returns the
 * labels the conversation carries afterwards, or why nothing was changed.
 */
export function labelConversation(
	storage: Storage,
	emailId: string,
	add: readonly string[],
	remove: readonly string[],
): { labels: string[] } | LabelRefusal {
	const { sql } = storage;
	const email = rows<{ conversation: string }>(
		sql.exec(`SELECT COALESCE(thread_id, id) AS conversation FROM emails WHERE id = ?`, emailId),
	)[0];
	if (!email) return "not_found";
	const wanted = [...new Set([...add, ...remove])];
	if (wanted.length > CHUNK) return "limit";
	if (wanted.length > 0) {
		const marks = wanted.map(() => "?").join(", ");
		const known = rows(sql.exec(`SELECT id FROM labels WHERE id IN (${marks})`, ...wanted));
		// A label of another mailbox does not exist here.
		if (known.length !== wanted.length) return "not_found";
	}
	// A message that waits to leave is changed by nothing but its own way out (ADR-0016).
	const members = `SELECT id FROM emails WHERE COALESCE(thread_id, id) = ? AND folder_id NOT IN ${HIDDEN} AND folder_id != '${Folders.SCHEDULED}'`;
	try {
		storage.transactionSync(() => {
			for (const label of add) {
				sql.exec(
					`INSERT OR IGNORE INTO email_labels (email_id, label_id) SELECT id, ? FROM (${members})`,
					label,
					email.conversation,
				);
			}
			for (const label of remove) {
				sql.exec(
					`DELETE FROM email_labels WHERE label_id = ? AND email_id IN (${members})`,
					label,
					email.conversation,
				);
			}
			const most =
				rows<{ n: number }>(
					sql.exec(
						`SELECT MAX(n) AS n FROM (
							SELECT COUNT(*) AS n FROM email_labels WHERE email_id IN (${members}) GROUP BY email_id
						)`,
						email.conversation,
					),
				)[0]?.n ?? 0;
			if (most > LABEL_LIMITS.perMessage) throw new OverTheLimit();
		});
	} catch (error) {
		if (error instanceof OverTheLimit) return "limit";
		throw error;
	}
	return { labels: labelsOfConversations(sql, [email.conversation]).get(email.conversation) ?? [] };
}

/** For each conversation, the ids of the labels any of its messages carry, in name order. */
export function labelsOfConversations(
	sql: SqlStorage,
	conversations: readonly string[],
): Map<string, string[]> {
	const found = new Map<string, string[]>();
	const unique = [...new Set(conversations)];
	for (let start = 0; start < unique.length; start += CHUNK) {
		const chunk = unique.slice(start, start + CHUNK);
		const marks = chunk.map(() => "?").join(", ");
		const result = rows<{ conversation: string; label_id: string }>(
			sql.exec(
				`SELECT DISTINCT COALESCE(e.thread_id, e.id) AS conversation, el.label_id
				FROM email_labels el
				JOIN emails e ON e.id = el.email_id
				JOIN labels l ON l.id = el.label_id
				WHERE COALESCE(e.thread_id, e.id) IN (${marks}) AND e.folder_id NOT IN ${HIDDEN}
				ORDER BY l.name COLLATE NOCASE`,
				...chunk,
			),
		);
		for (const row of result) {
			found.set(row.conversation, [...(found.get(row.conversation) ?? []), row.label_id]);
		}
	}
	return found;
}

/** The same rows, each with the labels of its conversation. A row has an `id` and may have a `thread_id`. */
export function withLabels<T extends object>(
	sql: SqlStorage,
	list: readonly T[],
): (T & { labels: string[] })[] {
	const conversation = (row: T) => {
		const { id, thread_id } = row as { id?: unknown; thread_id?: unknown };
		return String(thread_id ?? id);
	};
	const found = labelsOfConversations(sql, list.map(conversation));
	return list.map((row) => ({ ...row, labels: found.get(conversation(row)) ?? [] }));
}
