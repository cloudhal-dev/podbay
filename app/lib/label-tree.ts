// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/** Labels shown as a tree: a `/` in a name puts a label under the label named before it. */

export interface Placed<T> {
	item: T;
	/** How many labels it is under. */
	depth: number;
	/** Its name without the part its parent already says. */
	short: string;
}

const key = (name: string) => name.toLowerCase();

/** Names compared part by part, so a label's children follow it directly. */
function byPath(a: string, b: string): number {
	const left = a.split("/");
	const right = b.split("/");
	for (let at = 0; at < Math.min(left.length, right.length); at++) {
		const order = (left[at] ?? "").localeCompare(right[at] ?? "", undefined, {
			sensitivity: "base",
		});
		if (order !== 0) return order;
	}
	return left.length - right.length;
}

/**
 * The labels in the order of a tree, each with its depth. A label is under the longest label
 * whose name, followed by a slash, starts its own; where no such label exists it stands at the
 * top with its whole name, so nothing is hidden behind a parent that is not there.
 */
export function labelTree<T extends { name: string }>(labels: readonly T[]): Placed<T>[] {
	const names = new Set(labels.map((label) => key(label.name)));
	const depths = new Map<string, number>();
	return [...labels]
		.sort((a, b) => byPath(a.name, b.name))
		.map((item) => {
			const parts = item.name.split("/");
			for (let count = parts.length - 1; count > 0; count--) {
				const parent = key(parts.slice(0, count).join("/"));
				if (!names.has(parent)) continue;
				const depth = (depths.get(parent) ?? 0) + 1;
				depths.set(key(item.name), depth);
				return { item, depth, short: parts.slice(count).join("/") };
			}
			depths.set(key(item.name), 0);
			return { item, depth: 0, short: item.name };
		});
}
