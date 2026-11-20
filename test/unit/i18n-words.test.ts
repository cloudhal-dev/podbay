// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Every message keeps its exact words in both languages (rule D8). Each message of the Turkish
 * catalog is asked for through the app's own `t`, `plural` and `rich`: in Turkish it is the
 * catalog's text, and in English it is the English it is named by. It holds however the
 * catalogs reach the runtime, so moving the runtime (ADR-0018, step 2) must leave it as it is.
 */
import { afterEach, describe, expect, it } from "vitest";
import { currentLanguage, LANGUAGES, plural, setLanguage, t } from "../../app/i18n/index.ts";
import { rich } from "../../app/i18n/rich.ts";
import { tr } from "../../app/i18n/tr.ts";

const CONTEXT = /^[a-z]+\|/;
const messages = Object.keys(tr);

afterEach(() => setLanguage("en"));

describe("the words of every message", () => {
	it("has a catalog worth testing", () => {
		expect(LANGUAGES).toEqual(["en", "tr"]);
		expect(messages.length).toBeGreaterThan(500);
		// The messages the tests below ask for by name are translated.
		for (const message of [
			"{count} selected",
			"{count} conversation",
			"{count} conversations",
			"You were invited as {email}.",
		]) {
			expect(tr[message], message).toBeTruthy();
		}
	});

	it("are the catalog's own in Turkish", () => {
		setLanguage("tr");
		expect(currentLanguage()).toBe("tr");
		const differ = messages.filter((message) => t(message) !== tr[message]);
		expect(differ).toEqual([]);
	});

	it("are the English they are named by in English", () => {
		setLanguage("en");
		const differ = messages.filter((message) => t(message) !== message.replace(CONTEXT, ""));
		expect(differ).toEqual([]);
	});

	it("take their values by name in both languages", () => {
		const message = "{count} selected";
		setLanguage("tr");
		expect(t(message, { count: 3 })).toBe((tr[message] ?? "").replace("{count}", "3"));
		setLanguage("en");
		expect(t(message, { count: 3 })).toBe("3 selected");
	});

	it("choose the form of a count, and its words, in both languages", () => {
		const [one, other] = ["{count} conversation", "{count} conversations"];
		setLanguage("tr");
		expect(plural(1, one, other)).toBe((tr[one] ?? one).replace("{count}", "1"));
		expect(plural(4, one, other)).toBe((tr[other] ?? other).replace("{count}", "4"));
		setLanguage("en");
		expect([plural(1, one, other), plural(4, one, other)]).toEqual([
			"1 conversation",
			"4 conversations",
		]);
	});

	it("keep their sentence whole when an element is put in", () => {
		const message = "You were invited as {email}.";
		for (const language of LANGUAGES) {
			setLanguage(language);
			const pieces = rich(message, { email: "E" }) as { props: { children: unknown } }[];
			const text = pieces.map((piece) => String(piece.props.children)).join("");
			expect(text).toBe(t(message).replace("{email}", "E"));
		}
	});
});
