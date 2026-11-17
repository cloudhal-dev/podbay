import { describe, expect, it } from "vitest";
import { labelTree } from "../../app/lib/label-tree.ts";

const tree = (...names: string[]) =>
	labelTree(names.map((name) => ({ name }))).map((placed) => [placed.depth, placed.short]);

describe("labels as a tree", () => {
	it("puts a label under the label its name starts with, children right after it", () => {
		expect(tree("Clients/Acme/Invoices", "Work", "Clients", "Clients/Acme", "Clients B")).toEqual([
			[0, "Clients"],
			[1, "Acme"],
			[2, "Invoices"],
			[0, "Clients B"],
			[0, "Work"],
		]);
	});

	it("keeps the whole name where the parent is not a label", () => {
		expect(tree("Projects/2026", "Archive")).toEqual([
			[0, "Archive"],
			[0, "Projects/2026"],
		]);
	});

	it("goes under the nearest label that exists, skipping a part that does not", () => {
		expect(tree("A", "A/B/C")).toEqual([
			[0, "A"],
			[1, "B/C"],
		]);
	});

	it("does not care about case when it looks for a parent", () => {
		expect(tree("clients", "Clients/Acme")).toEqual([
			[0, "clients"],
			[1, "Acme"],
		]);
	});
});
