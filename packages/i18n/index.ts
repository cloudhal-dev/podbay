// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * The words of the app in the reader's language (rule D8).
 *
 * A message is named by its English text: `t("Archive")`. English needs no catalog, a missing
 * translation falls back to the English it stands for, and the code reads as the screen does.
 * A value goes in by name: `t("{count} selected", { count })`.
 *
 * `t` is a plain function, not a hook: it reads the language when it is called, and the whole
 * app is drawn again when the language changes (`app/router.tsx`). So it is called while
 * drawing or acting, never when a module loads: a constant that holds words holds the English,
 * and is passed through `t` where it is shown.
 */
export const LANGUAGES = ["en", "tr"] as const;
export type Language = (typeof LANGUAGES)[number];

/** What each language calls itself, for the settings. */
export const LANGUAGE_NAMES: Record<Language, string> = { en: "English", tr: "Türkçe" };

/**
 * The catalog of each language but English, handed in by the app (`addCatalog`): a catalog
 * belongs to the code whose words it holds (ADR-0018, decision 8), and the runtime names none.
 */
const CATALOGS: Partial<Record<Language, Readonly<Record<string, string>>>> = {};

/** Gives the runtime the words of one language. A language's words are handed in once. */
export function addCatalog(
	next: Exclude<Language, "en">,
	catalog: Readonly<Record<string, string>>,
): void {
	if (CATALOGS[next] !== undefined) throw new Error(`the catalog of ${next} is handed in twice`);
	CATALOGS[next] = catalog;
}

let language: Language = "en";

/** The language the words are in now. */
export function currentLanguage(): Language {
	return language;
}

/** The language of this device, when it is one the app has; English otherwise. */
export function deviceLanguage(): Language {
	const wanted = typeof navigator === "undefined" ? "en" : navigator.language.toLowerCase();
	return LANGUAGES.find((known) => wanted === known || wanted.startsWith(`${known}-`)) ?? "en";
}

/** Sets the language of the words and of the document, for assistive technology. */
export function setLanguage(next: Language): void {
	language = next;
	if (typeof document !== "undefined") document.documentElement.lang = next;
}

/**
 * A message may begin with a word and a bar that say what it is about, as in `place|Archive`:
 * the same English can need two translations. English is the text after the bar.
 */
const CONTEXT = /^[a-z]+\|/;

/** The message in the reader's language, with its values put in. */
export function t(text: string, values?: Readonly<Record<string, string | number>>): string {
	const found = CATALOGS[language]?.[text] ?? text.replace(CONTEXT, "");
	if (values === undefined) return found;
	return found.replace(/\{(\w+)\}/g, (whole, name: string) =>
		name in values ? String(values[name]) : whole,
	);
}

/**
 * Marks English words that are kept in a constant and shown later through `t(variable)`, so
 * the catalog check finds them. It gives back what it was given.
 */
export function m(text: string): string {
	return text;
}

/**
 * A count with its noun. English has a form for one and a form for the rest, and each is a
 * message of its own; the count goes in as `{count}`.
 */
export function plural(
	count: number,
	one: string,
	other: string,
	values?: Readonly<Record<string, string | number>>,
): string {
	return t(count === 1 ? one : other, { ...values, count });
}

/**
 * The language to write dates and numbers in. English leaves it to the device, so a reader
 * keeps the date order of their region.
 */
export function dateLanguage(): string | undefined {
	return language === "en" ? undefined : language;
}

/**
 * The language of the date on a quoted or forwarded message. English is written one way
 * wherever the writer is, as it was before the app had languages.
 */
export function quoteLanguage(): string {
	return language === "en" ? "en-US" : language;
}
