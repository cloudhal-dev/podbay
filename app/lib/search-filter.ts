// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import type { BulkFilter } from "@podbay/mail/shared";
import { labelKey } from "@podbay/mail/shared";
import { parseSearchQuery } from "~/lib/search-parser";
import type { Label } from "~/types";

/**
 * What a search asks the mailbox, from the words in the search box. The list of results and
 * the deed on "everything this search finds" (ADR-0014) are both made from it, so they name
 * the same mail. A label is asked for by name and sent by id; a name that is no label is sent
 * as something that finds nothing.
 */
export function filterOf(query: string, labels: readonly Label[]): BulkFilter {
	const parsed = parseSearchQuery(query);
	const filter: BulkFilter = {};
	if (parsed.query) filter.query = parsed.query;
	if (parsed.from) filter.from = parsed.from;
	if (parsed.to) filter.to = parsed.to;
	if (parsed.subject) filter.subject = parsed.subject;
	if (parsed.folder) filter.folder = parsed.folder;
	if (parsed.date_start) filter.date_start = parsed.date_start;
	if (parsed.date_end) filter.date_end = parsed.date_end;
	if (parsed.is_read !== undefined) filter.is_read = parsed.is_read;
	if (parsed.is_starred !== undefined) filter.is_starred = parsed.is_starred;
	if (parsed.has_attachment) filter.has_attachment = true;
	if (parsed.label !== undefined) {
		const wanted = labelKey(parsed.label);
		filter.label = labels.find((label) => labelKey(label.name) === wanted)?.id ?? "none";
	}
	return filter;
}

/** The same filter as the parameters of the search route. */
export function filterParams(filter: BulkFilter): Record<string, string> {
	const params: Record<string, string> = {};
	for (const [name, value] of Object.entries(filter)) {
		if (value !== undefined) params[name] = String(value);
	}
	return params;
}
