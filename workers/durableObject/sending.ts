// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { Folders } from "../../shared/folders";

/** How much a mailbox may send. */
export const SENDS_PER_HOUR = 20;
export const SENDS_PER_DAY = 100;

/** Dates are ISO text with a `T`; `datetime()` writes a space there, which sorts before it. */
const SINCE = (span: string) => `strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '${span}')`;

function sentSince(sql: SqlStorage, span: "-1 hour" | "-1 day"): number {
	const row = [
		...sql.exec(
			`SELECT COUNT(*) AS cnt FROM emails WHERE folder_id = ?1 AND date >= ${SINCE(span)}`,
			Folders.SENT,
		),
	][0] as { cnt: number } | undefined;
	return row?.cnt ?? 0;
}

/** Why the mailbox may not send now, or `null` when it may. */
export function sendRefusal(sql: SqlStorage): string | null {
	if (sentSince(sql, "-1 hour") >= SENDS_PER_HOUR) {
		return `Rate limit exceeded: max ${SENDS_PER_HOUR} emails per hour per mailbox`;
	}
	if (sentSince(sql, "-1 day") >= SENDS_PER_DAY) {
		return `Rate limit exceeded: max ${SENDS_PER_DAY} emails per day per mailbox`;
	}
	return null;
}
