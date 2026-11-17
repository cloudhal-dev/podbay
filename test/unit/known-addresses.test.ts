import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	addressesOf,
	completeAddress,
	joinTyped,
	lastAddress,
	looksLikeAddress,
	mergeSuggestions,
	splitTyped,
	suggestAddresses,
	typeInto,
} from "../../app/lib/address-suggestions.ts";
import {
	isKnownId,
	KNOWN_LIMITS,
	typedForCompletion,
	typedLength,
} from "../../shared/known-addresses.ts";
import { MCP_TOOLS } from "../../shared/mcp-tools.ts";

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

describe("what is offered while an address is typed (ADR-0012, decision 21)", () => {
	const written = [
		{ id: "k1", address: "grace@navy.test", name: "Grace Hopper" },
		{ id: "k2", address: "greg@example.org", name: null },
	];
	const loaded = ["ada@sender.test", "Grace@navy.test", "gregor@sender.test", "gr@x.test"];

	it("shows the mailbox's own answers first, then what the loaded lists show, each once", () => {
		expect(mergeSuggestions(written, loaded, "gr")).toEqual([
			{ id: "k1", address: "grace@navy.test", name: "Grace Hopper" },
			{ id: "k2", address: "greg@example.org", name: null },
			// From the lists: no id, so nothing to forget, and no name.
			{ id: null, address: "gr@x.test", name: null },
			{ id: null, address: "gregor@sender.test", name: null },
		]);
	});

	it("offers nothing until something is typed, and never an address already in the field", () => {
		expect(mergeSuggestions(written, loaded, "")).toEqual([]);
		expect(mergeSuggestions(written, loaded, "grace@navy.test, ")).toEqual([]);
		expect(
			mergeSuggestions(written, loaded, "GRACE@navy.test, gr").map((one) => one.address),
		).toEqual(["greg@example.org", "gr@x.test", "gregor@sender.test"]);
	});

	it("does not offer again what the person just had forgotten, from either source", () => {
		expect(
			mergeSuggestions(written, loaded, "gr", new Set(["grace@navy.test"])).map(
				(one) => one.address,
			),
		).toEqual(["greg@example.org", "gr@x.test", "gregor@sender.test"]);
	});

	it("offers a handful", () => {
		const many = Array.from({ length: 12 }, (_value, n) => ({
			id: `k${n}`,
			address: `g${n}@many.test`,
			name: null,
		}));
		expect(mergeSuggestions(many, loaded, "g")).toHaveLength(KNOWN_LIMITS.suggestions);
		expect(mergeSuggestions(many, loaded, "g", new Set(), 3)).toHaveLength(3);
	});
});

describe("what the completion takes (ADR-0012, decisions 19 and 23)", () => {
	it("is 1 to 64 characters, without the room around them", () => {
		expect(typedForCompletion("  ada ")).toBe("ada");
		expect(typedForCompletion("a")).toBe("a");
		expect(typedForCompletion("a".repeat(64))).toBe("a".repeat(64));
		for (const refused of ["", "   ", "a".repeat(65), "𝒜".repeat(65)]) {
			expect(typedForCompletion(refused), refused).toBeNull();
		}
		// A letter outside the basic plane is one character, not two.
		expect(typedLength("𝒜b")).toBe(2);
		expect(typedForCompletion("𝒜".repeat(64))).not.toBeNull();
	});

	it("has the limits the record chose", () => {
		expect(KNOWN_LIMITS).toEqual({
			addresses: 5000,
			address: 254,
			name: 120,
			typed: 64,
			suggestions: 8,
			forgottenAfterMs: 2 * 365 * 24 * 60 * 60 * 1000,
		});
	});

	it("knows the shape of an id, so nothing else reaches the mailbox as one", () => {
		expect(isKnownId("3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b")).toBe(true);
		for (const bad of [
			"",
			"k1",
			"%",
			"3F2B8C1E-9A4D-4E6F-8B7A-1C2D3E4F5A6B",
			"' OR 1=1 --",
			null,
			7,
		]) {
			expect(isKnownId(bad), String(bad)).toBe(false);
		}
	});
});

describe("who learns and who asks (ADR-0012, decisions 14 and 19)", () => {
	const source = (path: string) => readFileSync(path, "utf8");
	const KNOWN = /known[-_ ]?address|completeAddress|forgetAddress|known\.learn|#learn/i;

	it("gives the assistant and MCP no way to the known addresses", () => {
		const tools = [
			...readdirSync("workers/agent").map((name) => `workers/agent/${name}`),
			"workers/mcp/server.ts",
			"workers/lib/tools.ts",
			"shared/mcp-tools.ts",
		];
		for (const file of tools) expect(source(file), file).not.toMatch(KNOWN);
		expect(
			MCP_TOOLS.map((tool) => tool.name).filter((name) =>
				/known|address|contact|complet|recipient/.test(name),
			),
		).toEqual([]);
	});

	it("learns in one place only: where the mailbox object stores a sent message", () => {
		// Nothing on the way of incoming mail names the table or the step.
		for (const file of [
			"workers/arrival.ts",
			"workers/durableObject/originals.ts",
			"workers/app.ts",
		]) {
			expect(source(file), file).not.toMatch(KNOWN);
		}
		const object = source("workers/durableObject/index.ts");
		// Twice called: a new row in Sent, and a draft that becomes the sent message.
		expect(object.match(/this\.#learn\(/g)).toHaveLength(2);
		expect(object).toContain("if (isSent) this.#learn(email);");
		expect(object).toContain(`if (!("refused" in sent)) this.#learn(fields);`);
	});
});
