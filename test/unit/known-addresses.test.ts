import { describe, expect, it } from "vitest";
import {
	completeAddress,
	lastAddress,
	suggestAddresses,
} from "../../app/lib/address-suggestions.ts";

const KNOWN = ["ada@sender.test", "grace@navy.test", "adam@example.com", "bob@sender.test"];

describe("address suggestions", () => {
	it("looks at what follows the last comma", () => {
		expect(lastAddress("ada@sender.test, gr")).toBe("gr");
		expect(lastAddress("gr")).toBe("gr");
		expect(lastAddress("ada@sender.test, ")).toBe("");
	});

	it("offers nothing until something is typed", () => {
		expect(suggestAddresses(KNOWN, "")).toEqual([]);
		expect(suggestAddresses(KNOWN, "ada@sender.test, ")).toEqual([]);
	});

	it("offers what fits, addresses that start with it first, and never one already there", () => {
		expect(suggestAddresses(KNOWN, "ada")).toEqual(["ada@sender.test", "adam@example.com"]);
		expect(suggestAddresses(KNOWN, "sender")).toEqual(["ada@sender.test", "bob@sender.test"]);
		expect(suggestAddresses(KNOWN, "ada@sender.test, sender")).toEqual(["bob@sender.test"]);
		expect(suggestAddresses(KNOWN, "ADA@S")).toEqual(["ada@sender.test"]);
		expect(suggestAddresses(KNOWN, "t", 2)).toHaveLength(2);
	});

	it("puts a taken address in place of what was typed, ready for the next", () => {
		expect(completeAddress("gr", "grace@navy.test")).toBe("grace@navy.test, ");
		expect(completeAddress("ada@sender.test, gr", "grace@navy.test")).toBe(
			"ada@sender.test, grace@navy.test, ",
		);
	});
});
