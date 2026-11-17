import { describe, expect, it } from "vitest";
import {
	addressesOf,
	completeAddress,
	joinTyped,
	lastAddress,
	looksLikeAddress,
	splitTyped,
	suggestAddresses,
	typeInto,
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

describe("addresses as they are typed", () => {
	it("splits a list into what is done and what is in hand, and writes it back the same", () => {
		expect(splitTyped("ada@sender.test, gr")).toEqual({ done: ["ada@sender.test"], typing: "gr" });
		expect(splitTyped("ada@sender.test, ")).toEqual({ done: ["ada@sender.test"], typing: "" });
		expect(splitTyped("gr")).toEqual({ done: [], typing: "gr" });
		expect(splitTyped("")).toEqual({ done: [], typing: "" });
		expect(splitTyped("a@x.test, A@X.test, a@x.test, ").done).toEqual(["a@x.test"]);
		for (const value of ["a@x.test, b@y.test, ", "a@x.test, b", "b", ""]) {
			const { done, typing } = splitTyped(value);
			expect(joinTyped(done, typing)).toBe(value);
		}
	});

	it("ends an address at a comma, a semicolon or a line break, also when several are pasted", () => {
		expect(typeInto([], "ada@sender.test,")).toBe("ada@sender.test, ");
		expect(typeInto(["a@x.test"], "b@y.test; c@z.test\nd")).toBe("a@x.test, b@y.test, c@z.test, d");
		expect(typeInto(["a@x.test"], " , ,")).toBe("a@x.test, ");
	});

	it("knows the shape of an address, and leaves the rest to the Worker", () => {
		for (const good of ["ada@sender.test", " a.b+c@x.example.org "]) {
			expect(looksLikeAddress(good), good).toBe(true);
		}
		for (const bad of [
			"ada",
			"ada@",
			"@x.test",
			"ada@x",
			"a b@x.test",
			"a@x.test, b@y.test",
			"<a@x.test>",
		]) {
			expect(looksLikeAddress(bad), bad).toBe(false);
		}
	});
});

describe("the addresses a mailbox knows", () => {
	it("gathers them from the mail on screen, each once, without the mailbox's own", () => {
		const known = addressesOf(
			[
				{ folder_id: "inbox", sender: "Ada@sender.test", recipient: "me@example.com" },
				{
					folder_id: "sent",
					sender: "me@example.com",
					recipient: "grace@navy.test, ada@sender.test",
				},
				{
					folder_id: "inbox",
					sender: "bob@sender.test",
					cc: "carol@example.net",
					participants: "bob@sender.test",
				},
				{ folder_id: "inbox", sender: "not an address" },
			],
			"ME@example.com",
		);
		expect(known).toEqual([
			"Ada@sender.test",
			"bob@sender.test",
			"carol@example.net",
			"grace@navy.test",
		]);
	});

	it("learns nothing from Spam or Trash", () => {
		const known = addressesOf([
			{ folder_id: "spam", sender: "prize@unwanted.test", recipient: "me@example.com" },
			{ folder_id: "trash", sender: "old@thrown.test" },
			{ folder_id: "archive", sender: "kept@friend.test" },
		]);
		expect(known).toEqual(["kept@friend.test"]);
		expect(known).not.toContain("prize@unwanted.test");
		expect(known).not.toContain("old@thrown.test");
	});
});
