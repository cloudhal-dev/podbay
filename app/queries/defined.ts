// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * A value a query needs, in a query that runs only when it is there (`enabled`). It never
 * throws while `enabled` says what the query needs; if it ever ran without it, the query fails
 * with an error instead of asking the API about `undefined`.
 */
export function defined<T>(value: T | null | undefined): T {
	if (value === undefined || value === null) throw new Error("A query ran without what it needs.");
	return value;
}
