// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import type { MailEnv as Env } from "../env";

/** What the mailbox answers for a message that waits to leave: it is not deleted (ADR-0016). */
type Waits = "scheduled";

/** The mailbox calls that name a message's objects and delete its rows. */
interface Deleter {
	messageKeys(id: string): Promise<string[] | null | Waits>;
	deleteEmail(id: string): Promise<string[] | null | Waits>;
}

/** One call to the bucket deletes at most this many objects (docs/cloudflare/ledger.json). */
export const DELETE_AT_ONCE = 1000;

/** Deletes objects from the bucket, a thousand at a time. */
export async function deleteObjects(bucket: Env["BUCKET"], keys: readonly string[]): Promise<void> {
	for (let from = 0; from < keys.length; from += DELETE_AT_ONCE) {
		await bucket.delete(keys.slice(from, from + DELETE_AT_ONCE));
	}
}

/**
 * Deletes a message for good: the objects that hold its files, stored or not, and its
 * original, and then its rows (rule S13; ADR-0011, decision 9; ADR-0015, decision 22). Every
 * path that deletes one message goes through here, so none can leave an object behind.
 * Objects go before rows: a failure in between leaves rows that can be deleted again, never
 * an object that no row names. False when there is no such message, and `scheduled` for one
 * that waits to leave: nothing of it is deleted, it is taken back first.
 */
export async function deleteMessage(
	bucket: Env["BUCKET"],
	stub: Deleter,
	id: string,
): Promise<boolean | Waits> {
	const keys = await stub.messageKeys(id);
	if (keys === null) return false;
	if (keys === "scheduled") return keys;
	await deleteObjects(bucket, keys);
	// The rows say what the message had when they went: a file that was declared in between
	// is deleted now, so that it is not left without its row.
	const last = await stub.deleteEmail(id);
	if (last === null) return true;
	// Sent in the moment between: its rows stay, and it fails at leaving for want of its files.
	if (last === "scheduled") return last;
	const gone = new Set(keys);
	await deleteObjects(
		bucket,
		last.filter((key) => !gone.has(key)),
	);
	return true;
}
