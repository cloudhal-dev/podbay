import { describe, expect, it } from "vitest";
import {
	parseSortColumn,
	parseSortDirection,
	SORT_COLUMNS,
} from "../../workers/lib/list-options.ts";

describe("parseSortColumn", () => {
	it.each([...SORT_COLUMNS])("accepts %s", (column) => {
		expect(parseSortColumn(column)).toBe(column);
	});

	it.each([undefined, "", "body", "DATE", "date; DROP TABLE emails", "date DESC", "1=1"])(
		"refuses %j",
		(value) => {
			expect(parseSortColumn(value)).toBeUndefined();
		},
	);
});

describe("parseSortDirection", () => {
	it("accepts both directions in any casing", () => {
		expect(parseSortDirection("asc")).toBe("ASC");
		expect(parseSortDirection("DESC")).toBe("DESC");
	});

	it.each([undefined, "", "up", "ASC; --", "desc nulls first"])("refuses %j", (value) => {
		expect(parseSortDirection(value)).toBeUndefined();
	});
});
