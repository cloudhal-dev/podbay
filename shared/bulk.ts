// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * One request acts on many conversations (ADR-0014). The request of `POST …/bulk` is checked by
 * the schema here, which the Worker parses with and the app takes its types from (rule D2).
 *
 * The app imports types only from this module, so the schema library stays out of its bundle.
 */
import { z } from "zod";

/** Chosen in ADR-0014, decision 12, to be revised from use. */
export const BULK_LIMITS = {
	/** Message ids in one request: the largest page of a list. */
	ids: 100,
	/** Characters in one id. */
	idLength: 128,
	/** Labels in one change, given and taken together. */
	labels: 10,
	/** Characters in each text of a filter. */
	text: 200,
	/** Found messages read in one step of a filter deed. */
	step: 500,
	/** How long after asking a filter deed may still be started. */
	startWithinMs: 10 * 60_000,
	/** How long the mailbox keeps the record of a deed, and so how long it can be undone. */
	keptForMs: 60 * 60_000,
} as const;

/** Where a deed may move mail. Sent and Drafts are never a target (decision 3). */
export const BULK_MOVES = ["inbox", "archive", "spam", "trash"] as const;
export type BulkMove = (typeof BULK_MOVES)[number];

export const BULK_UNITS = ["conversation", "message"] as const;
export type BulkUnit = (typeof BULK_UNITS)[number];

const text = z.string().max(BULK_LIMITS.text);
const labelId = z.string().max(64);

/** The search route's fields (decision 30). A label is named by its id. */
export const BulkFilterSchema = z.strictObject({
	folder: text.optional(),
	label: labelId.optional(),
	query: text.optional(),
	from: text.optional(),
	to: text.optional(),
	subject: text.optional(),
	date_start: text.optional(),
	date_end: text.optional(),
	is_read: z.boolean().optional(),
	is_starred: z.boolean().optional(),
	has_attachment: z.boolean().optional(),
});
export type BulkFilter = z.infer<typeof BulkFilterSchema>;

export const BulkChangeSchema = z
	.strictObject({
		move: z.enum(BULK_MOVES).optional(),
		read: z.boolean().optional(),
		starred: z.boolean().optional(),
		labels: z
			.strictObject({
				add: z.array(labelId).max(BULK_LIMITS.labels).optional(),
				remove: z.array(labelId).max(BULK_LIMITS.labels).optional(),
			})
			.optional(),
	})
	.refine(
		(change) =>
			(change.labels?.add?.length ?? 0) + (change.labels?.remove?.length ?? 0) <=
			BULK_LIMITS.labels,
		{ message: "too many labels", params: { limit: true } },
	);
export type BulkChange = z.infer<typeof BulkChangeSchema>;

export const BulkRequestSchema = z.strictObject({
	/** The ticked lines, each by the id of its message. */
	ids: z.array(z.string().min(1).max(BULK_LIMITS.idLength)).min(1).max(BULK_LIMITS.ids).optional(),
	/** "Everything in this place", "everything this search finds". */
	filter: BulkFilterSchema.optional(),
	/** What a line is: a conversation unless this says a message (decision 8). */
	unit: z.enum(BULK_UNITS).optional(),
	change: BulkChangeSchema,
});
export type BulkRequest = z.infer<typeof BulkRequestSchema>;

/** The labels a change gives and takes, without repeats. */
export function labelsOf(change: BulkChange): { add: string[]; remove: string[] } {
	return {
		add: [...new Set(change.labels?.add ?? [])],
		remove: [...new Set(change.labels?.remove ?? [])],
	};
}

/** Whether a change changes anything: an empty one is refused. */
export function changesSomething(change: BulkChange): boolean {
	const { add, remove } = labelsOf(change);
	return (
		change.move !== undefined ||
		change.read !== undefined ||
		change.starred !== undefined ||
		add.length + remove.length > 0
	);
}

/**
 * Whether a filter names something. An empty one is refused, so there is no deed on a whole
 * mailbox (decision 7). An empty text and "no attachment asked for" name nothing, as in a search.
 */
export function namesSomething(filter: BulkFilter): boolean {
	const texts = [
		filter.folder,
		filter.label,
		filter.query,
		filter.from,
		filter.to,
		filter.subject,
		filter.date_start,
		filter.date_end,
	];
	return (
		texts.some((value) => value !== undefined && value !== "") ||
		filter.is_read !== undefined ||
		filter.is_starred !== undefined ||
		filter.has_attachment === true
	);
}

/** Lines that were left out of a deed, by why (decision 14). */
export interface BulkSkipped {
	/** No such message in this mailbox. */
	not_found: number;
	/** A place the line cannot go to, or a line that takes no label where it is. */
	place: number;
	/** A message of the conversation would carry more labels than one can. */
	label_limit: number;
}

/** The answer to a request with ids, and to each step of a filter deed. */
export interface BulkStepAnswer {
	deed: string;
	/** Lines in which something was changed by this call. */
	conversations: number;
	/** Messages changed by this call. */
	messages: number;
	skipped: BulkSkipped;
	/** Whether the deed has more to do: call `…/bulk/:deedId/run` again. */
	more: boolean;
}

/** The answer to a request with a filter: what was counted. Nothing was changed. */
export interface BulkCountAnswer {
	deed: string;
	conversations: number;
	messages: number;
}

/** The answer to each step of an undo. */
export interface BulkUndoAnswer {
	/** Messages put back by this call. */
	messages: number;
	more: boolean;
}

const DEED_ID = /^deed_[0-9a-f]{24}$/;

/** Whether a value has the shape of a deed's id. An id is opaque. */
export function isDeedId(value: unknown): value is string {
	return typeof value === "string" && DEED_ID.test(value);
}

export function newDeedId(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(12));
	return `deed_${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
