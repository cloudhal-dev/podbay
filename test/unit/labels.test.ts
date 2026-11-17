import { describe, expect, it } from "vitest";
import {
	cleanLabelName,
	isLabelId,
	LABEL_COLOR_COUNT,
	LABEL_LIMITS,
	labelColor,
	labelKey,
	newLabelId,
} from "../../shared/labels.ts";

describe("label names", () => {
	it("stores a name trimmed, with single spaces and tidy parts", () => {
		expect(cleanLabelName("  Projects \t 2026 ")).toBe("Projects 2026");
		expect(cleanLabelName("Clients / Acme")).toBe("Clients/Acme");
		expect(cleanLabelName("İş")).toBe("İş");
	});

	it.each([
		["empty", ""],
		["only spaces", "   "],
		["a quote, which would end a quoted search value", 'a"b'],
		["a control character", "a\u0007b"],
		["a line break inside a part", "a\u0000b"],
		["an empty part", "a//b"],
		["a slash at the start", "/a"],
		["a slash at the end", "a/"],
		["too long", "x".repeat(LABEL_LIMITS.nameLength + 1)],
		["not a string", 7],
	])("refuses %s", (_what, raw) => {
		expect(cleanLabelName(raw)).toBeNull();
	});

	it("counts characters, not bytes, and allows exactly the limit", () => {
		expect(cleanLabelName("ş".repeat(LABEL_LIMITS.nameLength))).not.toBeNull();
		expect(cleanLabelName("😀".repeat(LABEL_LIMITS.nameLength))).not.toBeNull();
	});

	it("treats names that differ only in case or width as one label", () => {
		expect(labelKey("Work")).toBe(labelKey("WORK"));
		expect(labelKey("Ｗork")).toBe(labelKey("work"));
		expect(labelKey("Work")).not.toBe(labelKey("Works"));
	});
});

describe("label ids and colours", () => {
	it("makes ids of one shape, different every time", () => {
		const made = new Set(Array.from({ length: 50 }, newLabelId));
		expect(made.size).toBe(50);
		for (const id of made) expect(isLabelId(id)).toBe(true);
	});

	it.each([
		"",
		"inbox",
		"lbl_",
		"lbl_XYZ",
		`lbl_${"a".repeat(23)}`,
		`lbl_${"a".repeat(25)}`,
		`lbl_${"A".repeat(24)}`,
		`lbl_${"a".repeat(24)}' OR 1=1`,
		null,
		42,
	])("does not take %j for an id", (value) => {
		expect(isLabelId(value)).toBe(false);
	});

	it("keeps a colour inside the palette", () => {
		expect(labelColor(3)).toBe(3);
		for (const bad of [-1, LABEL_COLOR_COUNT, 1.5, "2", null, undefined, Number.NaN]) {
			expect(labelColor(bad)).toBe(0);
		}
	});
});
