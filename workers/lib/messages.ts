// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import type { Env } from "../types";

/** The mailbox call that deletes a message's rows and names its files. */
interface Deleter {
	deleteEmail(id: string): Promise<{ id: string; filename: string }[] | null>;
}

/**
 * Deletes a message for good: its rows and the objects that held its files, stored or not
 * (rule S13, ADR-0011 decision 9). Every path that deletes one message goes through here, so
 * none can leave the files behind. False when there is no such message.
 */
export async function deleteMessage(
	bucket: Env["BUCKET"],
	stub: Deleter,
	id: string,
): Promise<boolean> {
	const files = await stub.deleteEmail(id);
	if (files === null) return false;
	if (files.length > 0) {
		await bucket.delete(files.map((file) => `attachments/${id}/${file.id}/${file.filename}`));
	}
	return true;
}
