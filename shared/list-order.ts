// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * The order of a list (ADR-0014, decision 25): newest first, or the conversations with an
 * unread or a starred message on top and newest first inside each group. It is a parameter of
 * the request; the Worker never acts on a stored choice.
 */
export const LIST_ORDERS = ["newest", "unread", "starred"] as const;
export type ListOrder = (typeof LIST_ORDERS)[number];

/** The order a value names, or undefined when it names none. */
export function parseListOrder(value: unknown): ListOrder | undefined {
	return LIST_ORDERS.find((order) => order === value);
}
