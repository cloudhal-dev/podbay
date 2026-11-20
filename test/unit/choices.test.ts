/**
 * Tier 0: the schema of a person's choices (ADR-0012, decisions 2 to 4): which choices there
 * are and which travel with the person, strict when writing, lenient when reading.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LANGUAGES } from "../../app/i18n/index.ts";
import {
	CHOICES,
	CHOICES_VERSION,
	type Choices,
	changeOf,
	chosenKeys,
	DEFAULT_CHOICES,
	isTravelling,
	LANGUAGE_CHOICES,
	MAX_CHOICES_BYTES,
	readChoices,
	readDocument,
	TRAVELLING,
	withDocument,
} from "../../shared/choices.ts";
import { ChoicesChangeSchema, parseChange } from "../../shared/choices-schema.ts";

/** Every source file under a folder. */
function sources(folder: string): string[] {
	return readdirSync(folder).flatMap((name) => {
		const path = join(folder, name);
		if (statSync(path).isDirectory()) return sources(path);
		return /\.tsx?$/.test(name) ? [path] : [];
	});
}

describe("which choices there are", () => {
	it("is the list the record fixed, with the values and defaults the app has", () => {
		// A pinned list: a new choice, a new value or another default is a decision.
		expect(
			Object.fromEntries(
				Object.entries(CHOICES).map(([key, rule]) => [key, [rule.values, rule.initial, rule.kept]]),
			),
		).toEqual({
			density: [["default", "comfortable", "compact"], "default", "device"],
			readingPane: [["none", "right", "below"], "none", "device"],
			pageSize: [[10, 25, 50, 100], 25, "person"],
			order: [["newest", "unread", "starred"], "newest", "person"],
			defaultReply: [["reply", "reply-all"], "reply", "person"],
			afterFiling: [["list", "newer", "older"], "list", "person"],
			shortcuts: [[true, false], true, "person"],
			appearance: [["system", "light", "dark"], "system", "person"],
			language: [["system", "en", "tr"], "system", "person"],
			conversationView: [[true, false], true, "person"],
			snippets: [[true, false], true, "person"],
			hoverActions: [[true, false], true, "person"],
			sendAndArchive: [[true, false], false, "person"],
			undoSeconds: [[5, 10, 30], 10, "person"],
			notifications: [[true, false], false, "device"],
		});
		expect(CHOICES_VERSION).toBe(1);
		expect(MAX_CHOICES_BYTES).toBe(4096);
		for (const [key, rule] of Object.entries(CHOICES)) {
			expect(rule.values, key).toContain(rule.initial);
		}
	});

	it("lets ten travel with the person, and the order of a list and the undo window with them; three stay with the device", () => {
		// Decision 4 of ADR-0012, in its order. The collapsed rail, the fourth choice of the
		// device, is not among these at all: it is kept by `useUIStore`.
		const record = [
			"pageSize",
			"defaultReply",
			"afterFiling",
			"shortcuts",
			"appearance",
			"language",
			"conversationView",
			"snippets",
			"hoverActions",
			"sendAndArchive",
		];
		// ADR-0014, decision 25: the order of a list is kept where the page size is kept.
		// ADR-0016, decision 10: the undo window of a send is a person's choice like the others.
		expect([...TRAVELLING].sort()).toEqual([...record, "order", "undoSeconds"].sort());
		const device = Object.keys(CHOICES).filter((key) => !isTravelling(key));
		expect(device).toEqual(["density", "readingPane", "notifications"]);
		expect(isTravelling("rail")).toBe(false);
		expect(isTravelling("v")).toBe(false);
	});

	it("offers the languages the app speaks, and this device's", () => {
		expect(LANGUAGE_CHOICES).toEqual(["system", ...LANGUAGES]);
	});

	it("has a default for every choice", () => {
		expect(DEFAULT_CHOICES).toEqual({
			density: "default",
			readingPane: "none",
			pageSize: 25,
			order: "newest",
			defaultReply: "reply",
			afterFiling: "list",
			shortcuts: true,
			appearance: "system",
			language: "system",
			conversationView: true,
			snippets: true,
			hoverActions: true,
			sendAndArchive: false,
			undoSeconds: 10,
			notifications: false,
		});
	});
});

describe("writing is strict", () => {
	it("takes every value a travelling choice can have, and null for its default", () => {
		for (const key of TRAVELLING) {
			for (const value of [...CHOICES[key].values, null]) {
				expect(parseChange({ [key]: value }), `${key} ${String(value)}`).toEqual({ [key]: value });
			}
		}
		expect(parseChange({})).toEqual({});
		expect(parseChange({ pageSize: 50, language: "tr", snippets: null })).toEqual({
			pageSize: 50,
			language: "tr",
			snippets: null,
		});
	});

	it("refuses a key it does not know, whole", () => {
		for (const change of [
			{ theme: "dark" },
			{ pageSize: 50, theme: "dark" },
			{ v: 1 },
			{ userId: "someone" },
			// The choices of the device are not sent.
			{ density: "compact" },
			{ readingPane: "right" },
			{ notifications: true },
			{ rail: "collapsed" },
			{ PageSize: 50 },
		]) {
			expect(parseChange(change), JSON.stringify(change)).toBeNull();
		}
	});

	it("refuses a value its choice cannot take, whole", () => {
		for (const change of [
			{ pageSize: 7 },
			{ pageSize: "25" },
			{ pageSize: 25.5 },
			{ order: "oldest" },
			{ defaultReply: "forward" },
			{ afterFiling: "" },
			{ shortcuts: 1 },
			{ shortcuts: "true" },
			{ appearance: "Dark" },
			{ language: "de" },
			{ conversationView: "on" },
			{ snippets: [] },
			{ hoverActions: {} },
			{ sendAndArchive: 0 },
			{ language: "tr", pageSize: 7 },
		]) {
			expect(parseChange(change), JSON.stringify(change)).toBeNull();
		}
		for (const notAChange of [null, undefined, "pageSize", 50, [], [{ pageSize: 50 }], true]) {
			expect(parseChange(notAChange), String(notAChange)).toBeNull();
		}
	});

	it("is a schema of the travelling choices and nothing else", () => {
		expect(Object.keys(ChoicesChangeSchema.shape).sort()).toEqual([...TRAVELLING].sort());
	});
});

describe("reading is lenient", () => {
	it("reads a stored value it does not know as the default, in the browser's copy", () => {
		expect(readChoices({ pageSize: 50, density: "huge", appearance: 7, snippets: "no" })).toEqual({
			...DEFAULT_CHOICES,
			pageSize: 50,
		});
		for (const nothing of [null, undefined, "text", 3, [], {}]) {
			expect(readChoices(nothing), String(nothing)).toEqual(DEFAULT_CHOICES);
		}
		// What the copy says beside the choices (whose it is, what is unsent) is not a choice.
		expect(readChoices({ owner: "u1", unsent: ["pageSize"], language: "tr" })).toEqual({
			...DEFAULT_CHOICES,
			language: "tr",
		});
	});

	it("gives on only what a document holds of the travelling choices, and no key it does not know", () => {
		expect(
			readDocument({
				v: 1,
				pageSize: 50,
				snippets: false,
				// Not known any more: reads as the default, so it is not in the answer.
				appearance: "sepia",
				language: 4,
				// Not a choice this version knows: left where it is, not given on.
				laterChoice: "wide",
				// A choice of the device has no place in the document.
				density: "compact",
				notifications: true,
			}),
		).toEqual({ v: 1, pageSize: 50, snippets: false });
		// A document from before it had a version is the first version.
		expect(readDocument({ pageSize: 10 })).toEqual({ v: 1, pageSize: 10 });
	});

	it("reads a document of a later version, and what is no document, as one without choices", () => {
		for (const stored of [
			{ v: 2, pageSize: 50 },
			{ v: 1.5, pageSize: 50 },
			{ v: "1", pageSize: 50 },
			{ v: null, pageSize: 50 },
			null,
			undefined,
			"{}",
			[],
			7,
		]) {
			expect(readDocument(stored), JSON.stringify(stored)).toEqual({ v: 1 });
		}
	});
});

describe("the browser's copy and the account's document", () => {
	const here: Choices = {
		...DEFAULT_CHOICES,
		density: "compact",
		readingPane: "right",
		notifications: true,
		pageSize: 100,
		language: "tr",
		snippets: false,
	};

	it("lets the account win for what travels, and leaves the device its own", () => {
		expect(withDocument(here, { v: 1, pageSize: 10, appearance: "dark" })).toEqual({
			...DEFAULT_CHOICES,
			// The device's own.
			density: "compact",
			readingPane: "right",
			notifications: true,
			// The account's; what it does not hold is the default, not what this browser had.
			pageSize: 10,
			appearance: "dark",
		});
		// Someone else's copy: the travelling part goes back to the defaults.
		expect(withDocument(here, { v: 1 })).toEqual({
			...DEFAULT_CHOICES,
			density: "compact",
			readingPane: "right",
			notifications: true,
		});
	});

	it("keeps a change made here that the account has not got yet", () => {
		expect(withDocument(here, { v: 1, pageSize: 10, language: "en" }, ["pageSize"])).toMatchObject({
			pageSize: 100,
			language: "en",
			snippets: true,
		});
	});

	it("sends only the keys that changed, and a default as null", () => {
		expect(changeOf(here, ["pageSize", "language"])).toEqual({ pageSize: 100, language: "tr" });
		expect(changeOf({ ...here, pageSize: 25 }, ["pageSize", "shortcuts"])).toEqual({
			pageSize: null,
			shortcuts: null,
		});
		expect(changeOf(here, [])).toEqual({});
		// What it sends is a change the Worker takes.
		expect(parseChange(changeOf(here, [...TRAVELLING]))).not.toBeNull();
	});

	it("brings along what differs from the defaults, and nothing of the device", () => {
		expect(chosenKeys(here).sort()).toEqual(["language", "pageSize", "snippets"]);
		expect(chosenKeys(DEFAULT_CHOICES)).toEqual([]);
	});
});

describe("where the schema is loaded", () => {
	it("keeps the schema library out of the app: the app never loads the strict half", () => {
		expect(readFileSync("shared/choices.ts", "utf8")).not.toMatch(/from "zod"/);
		expect(readFileSync("modules/mail/shared/known-addresses.ts", "utf8")).not.toMatch(
			/from "zod"/,
		);
		for (const file of sources("app")) {
			expect(readFileSync(file, "utf8"), file).not.toContain("choices-schema");
		}
	});

	it("gives nobody but the person's own two routes a way to the stored choices", () => {
		// The table is named in its migration, in the store that reads and merges it, and nowhere
		// else in the Worker: not in the list of people, not in a tool of the assistant or MCP.
		// Mail's Worker side is read too: its code moved out of workers/ (ADR-0018, step 3.1).
		const naming = [...sources("workers"), ...sources("modules/mail/worker")].filter((file) =>
			/user_choices|auth\/choices|shared\/choices/.test(readFileSync(file, "utf8")),
		);
		expect(naming.sort()).toEqual(["workers/auth/choices.ts", "workers/routes/choices.ts"]);
	});
});
