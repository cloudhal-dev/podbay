// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified by the Podbay contributors.

/**
 * Which conversation an incoming message belongs to.
 *
 * A message names the messages it answers by their `Message-ID`, in `In-Reply-To` and
 * `References`. Those are written by the sender, so they are a claim, not a fact: the message
 * joins a conversation only when a message with one of those ids is in this mailbox **and** has
 * the same subject, reply prefixes aside. Without the second half, anyone who learned a
 * `Message-ID` could put their mail into someone else's conversation.
 */

const REPLY_PREFIXES = /^(?:(?:re|fwd?|fw|aw|wg|r[eé]f|sv)\s*:\s*)+/i;
/** A query takes at most 100 bound parameters (docs/cloudflare/ledger.json). */
const MOST_IDS = 50;

/** A subject without its reply and forward prefixes, for comparing two messages. */
export function normalizeSubject(subject: string): string {
	return subject.replace(REPLY_PREFIXES, "").trim().toLowerCase();
}

/**
 * The conversation of the nearest message this one says it answers, or null when none of them
 * is here with the same subject. `messageIds` is oldest first, the message answered last.
 */
export function threadOfReferences(
	sql: SqlStorage,
	messageIds: readonly string[],
	subject: string,
): string | null {
	const ids = [...new Set(messageIds.filter((id) => id !== ""))].slice(-MOST_IDS);
	if (ids.length === 0) return null;
	const marks = ids.map(() => "?").join(", ");
	const found = [
		...sql.exec(
			`SELECT id, message_id, thread_id, subject FROM emails WHERE message_id IN (${marks})`,
			...ids,
		),
	];
	const wanted = normalizeSubject(subject);
	for (const id of ids.reverse()) {
		const answered = found.find(
			(row) => row.message_id === id && normalizeSubject(String(row.subject ?? "")) === wanted,
		);
		if (answered) return String(answered.thread_id ?? answered.id);
	}
	return null;
}

/**
 * The conversation of a recent message with the same subject that this sender took part in, for
 * a message that names nothing it answers. Moved out of the mailbox object's file unchanged.
 */
export function threadOfSubject(
	sql: SqlStorage,
	subject: string,
	senderAddress?: string,
): string | null {
	const normalized = normalizeSubject(subject);
	if (!normalized) return null;

	const result = sql.exec(
		`SELECT thread_id, subject,
		        GROUP_CONCAT(DISTINCT LOWER(sender)) as senders,
		        GROUP_CONCAT(DISTINCT LOWER(recipient)) as recipients
		 FROM emails
		 WHERE thread_id IS NOT NULL
		   AND thread_id != id
		   AND date >= datetime('now', '-7 days')
		 GROUP BY thread_id
		 ORDER BY MAX(date) DESC
		 LIMIT 50`,
	);

	const normalizedSender = senderAddress?.toLowerCase().trim();

	for (const row of result) {
		if (normalizeSubject(String(row.subject || "")) !== normalized) continue;

		if (normalizedSender) {
			const threadSenders = String(row.senders || "");
			const threadRecipients = String(row.recipients || "");
			const allParticipants = `${threadSenders},${threadRecipients}`;
			if (!allParticipants.includes(normalizedSender)) {
				continue;
			}
		}

		return String(row.thread_id);
	}
	return null;
}
