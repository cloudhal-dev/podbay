// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Tier 0: the app's words (rule D8). The translation call falls back to English, a catalog
 * can reorder a sentence, and the static check sees a message without a translation, a
 * translation without a message, and words that stand bare on a screen.
 */
import { isValidElement, type ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
	currentLanguage,
	dateLanguage,
	m,
	plural,
	quoteLanguage,
	setLanguage,
	t,
} from "../../app/i18n/index.ts";
import { rich } from "../../app/i18n/rich.ts";
import { tr } from "../../app/i18n/tr.ts";
import {
	bareWords,
	catalogProblems,
	messagesOf,
	unreadPlurals,
} from "../../scripts/checks/messages.ts";

afterEach(() => setLanguage("en"));

/** The pieces `rich` gives, as the text and element names a reader would meet. */
function pieces(node: ReactNode): string[] {
	if (!Array.isArray(node)) return [];
	return node.flatMap((piece: unknown) => {
		if (!isValidElement<{ children?: unknown }>(piece)) return [];
		const inner = piece.props.children;
		if (typeof inner === "string") return inner === "" ? [] : [inner];
		return isValidElement(inner) ? [`<${String(inner.type)}>`] : [];
	});
}

describe("the translation call", () => {
	it("is English until a language is set, and English for a message with no translation", () => {
		expect(currentLanguage()).toBe("en");
		expect(t("Archive")).toBe("Archive");
		setLanguage("tr");
		expect(t("Archive")).toBe("Arşivle");
		expect(t("A message nobody translated")).toBe("A message nobody translated");
	});

	it("puts values in by name, wherever the language wants them", () => {
		expect(t("On {date}, {sender} wrote:", { date: "Monday", sender: "Ada" })).toBe(
			"On Monday, Ada wrote:",
		);
		setLanguage("tr");
		expect(t("On {date}, {sender} wrote:", { date: "Pazartesi", sender: "Ada" })).toBe(
			"Ada, Pazartesi tarihinde şunu yazdı:",
		);
		// A value that was not given stays visible, so the mistake is seen.
		expect(t("{count} selected")).toContain("{count}");
	});

	it("lets one English word be two messages: the place and the action", () => {
		expect(t("place|Archive")).toBe("Archive");
		setLanguage("tr");
		expect(t("place|Archive")).toBe("Arşiv");
		expect(t("Archive")).toBe("Arşivle");
	});

	it("chooses the form for one and the form for the rest", () => {
		expect(plural(1, "{count} attachment", "{count} attachments")).toBe("1 attachment");
		expect(plural(3, "{count} attachment", "{count} attachments")).toBe("3 attachments");
		setLanguage("tr");
		expect(plural(3, "{count} attachment", "{count} attachments")).toBe("3 ek");
	});

	it("keeps an element inside its sentence, where the language puts it", () => {
		const sentence = "You were invited as {email}.";
		expect(pieces(rich(sentence, { email: "ada@example.test" }))).toEqual([
			"You were invited as ",
			"ada@example.test",
			".",
		]);
		setLanguage("tr");
		expect(pieces(rich(sentence, { email: "ada@example.test" }))).toEqual([
			"ada@example.test",
			" olarak davet edildiniz.",
		]);
	});

	it("marks a constant without changing it", () => {
		expect(m("Inbox")).toBe("Inbox");
	});

	it("leaves English dates to the device and names the language otherwise", () => {
		expect(dateLanguage()).toBeUndefined();
		expect(quoteLanguage()).toBe("en-US");
		setLanguage("tr");
		expect(dateLanguage()).toBe("tr");
		expect(quoteLanguage()).toBe("tr");
	});
});

describe("the Turkish catalog", () => {
	it("translates the words a mailbox opens with", () => {
		for (const message of ["place|Inbox", "Compose", "Reply", "Settings", "Search mail"]) {
			expect(tr[message], message).toBeTruthy();
			expect(tr[message], message).not.toBe(message);
		}
	});
});

describe("the messages check", () => {
	it("finds the messages a file names, in every way of naming one", () => {
		const source = `
			const a = t("Archive");
			const b = t('Delete the label "{name}"?', { name });
			const c = m("place|Inbox");
			const d = rich("You were invited as {email}.", { email });
			const e = plural(files.length, "{count} attachment", "{count} attachments");
			const f = t(
				"A long message on a line of its own",
			);
			// t("in a comment") is prose
			const g = list.at("not a message");
			const h = format("not one either");
		`;
		expect(messagesOf(source)).toEqual([
			"Archive",
			'Delete the label "{name}"?',
			"place|Inbox",
			"You were invited as {email}.",
			"A long message on a line of its own",
			"{count} attachment",
			"{count} attachments",
		]);
	});

	it("refuses a plural() it cannot read, so it passes only by having read every one", () => {
		const source = [
			'const a = plural(files.length, "{count} file", "{count} files");',
			"const b = plural(",
			"\tmessages,",
			'\t"{count} message",',
			'\t"{count} messages",',
			");",
			'const c = plural(count("owner"), "{count} owner", "{count} owners");',
			"const d = plural(n, ONE, OTHER);",
			'const e = plural(list.filter((x) => x.on).length, "{count} on", "{count} on");',
			"// plural(count(), words) in a comment is prose",
			"export function plural(count: number, one: string, other: string) {}",
		].join("\n");
		expect(unreadPlurals("app/x.tsx", source)).toEqual([
			"app/x.tsx:7: plural() is given what this check cannot read; give it a plain count and two literal strings (rule D8)",
			"app/x.tsx:8: plural() is given what this check cannot read; give it a plain count and two literal strings (rule D8)",
			"app/x.tsx:9: plural() is given what this check cannot read; give it a plain count and two literal strings (rule D8)",
		]);
	});

	it("names a message with no translation, and one with other values", () => {
		const named = new Map([
			["Archive", "app/a.tsx"],
			["{count} selected", "app/b.tsx"],
			["Reply", "app/c.tsx"],
			["Send", "app/d.tsx"],
		]);
		const problems = catalogProblems("tr", named, {
			"{count} selected": "{sayi} seçili",
			Reply: "Yanıtla",
			Send: " ",
			Gone: "Gitti",
		});
		expect(problems).toEqual([
			'app/a.tsx: "Archive" has no translation in tr',
			'app/i18n/tr.ts: "{count} selected" takes {count} but its translation has {sayi}',
			'app/i18n/tr.ts: "Send" is empty',
			'app/i18n/tr.ts: "Gone" is not a message of the app any more',
		]);
		expect(catalogProblems("tr", new Map([["Reply", "app/c.tsx"]]), { Reply: "Yanıtla" })).toEqual(
			[],
		);
	});

	it("sees words that stand bare on a screen", () => {
		const screen = [
			"export function Screen() {",
			"\treturn (",
			"\t\t<div>",
			"\t\t\t<h1>Welcome back</h1>",
			'\t\t\t<button type="button" aria-label="Close the window">',
			"\t\t\t\tClose it now",
			"\t\t\t</button>",
			"\t\t</div>",
			"\t);",
			"}",
		].join("\n");
		expect(bareWords("app/routes/screen.tsx", screen)).toEqual([
			'app/routes/screen.tsx:4: "Welcome back" is not a message; use t() (rule D8)',
			'app/routes/screen.tsx:5: "Close the window" is not a message; use t() (rule D8)',
			'app/routes/screen.tsx:6: "Close it now" is not a message; use t() (rule D8)',
		]);
	});

	it("lets messages, names and code be", () => {
		const screen = [
			"export function Screen() {",
			"\treturn (",
			"\t\t<div>",
			'\t\t\t<h1>{t("Welcome back")}</h1>',
			'\t\t\t<button type="button" aria-label={t("Close the window")} className="rounded border">',
			"\t\t\t\tPodbay",
			"\t\t\t</button>",
			"\t\t\t<code>SETUP_TOKEN</code>",
			'\t\t\t<input placeholder="https://example.com" />',
			"\t\t</div>",
			"\t);",
			"}",
		].join("\n");
		expect(bareWords("app/routes/screen.tsx", screen)).toEqual([]);
		// Only screens are read: a module of plain code has no markup.
		expect(bareWords("app/lib/words.ts", "<p>Words</p>")).toEqual([]);
	});
});
