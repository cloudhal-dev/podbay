// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * The strict half of the schema of a person's choices (ADR-0012, decision 3): what
 * `PUT /api/v1/me/choices` takes. It is built from the table in `shared/choices.ts`, so a
 * choice is written down once. A key that is not a travelling choice, or a value its choice
 * cannot take, refuses the whole request.
 *
 * Only the Worker loads this module: the app takes its types from `shared/choices.ts`, so the
 * schema library stays out of its bundle.
 */
import { z } from "zod";
import { CHOICES, type ChoicesChange, TRAVELLING } from "./choices";

/** One of the values a choice can take, or `null` to take it back to its default. */
const oneOf = (values: readonly (string | number | boolean)[]) =>
	z.union([z.null(), ...values.map((value) => z.literal(value))]).optional();

export const ChoicesChangeSchema = z.strictObject(
	Object.fromEntries(TRAVELLING.map((key) => [key, oneOf(CHOICES[key].values)])),
);

/** The change a request body is, or `null` when it is not one. */
export function parseChange(body: unknown): ChoicesChange | null {
	const parsed = ChoicesChangeSchema.safeParse(body);
	return parsed.success ? (parsed.data as ChoicesChange) : null;
}
