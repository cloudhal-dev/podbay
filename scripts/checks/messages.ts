/**
 * D8: the app's words are messages. A message is named by its English text and shown through
 * `t("…")`, `plural(…)` or `rich("…")`, or kept in a constant under `m("…")`; every other
 * language has a catalog in `app/i18n/<language>.ts`.
 *
 * This check holds four things:
 *  - every message the code names has a translation in every catalog, with the same `{values}`;
 *  - a catalog holds nothing the code no longer names;
 *  - every call of `plural` is one it can read: a plain count and two literal strings. One it
 *    cannot read would name messages it never sees, and pass with no translation; it is refused;
 *  - words do not stand bare in the markup of a screen (text between tags, and the attributes
 *    a person reads or hears).
 *
 * It reads the source as text. Words built in other ways (a string handed to a toast, say) are
 * not seen by the third part; the first two still cover them once they are in `t`.
 */
import { existsSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { type Check, read, repoFiles } from "./lib.ts";

const UI_FILE = /^app\/.*\.(ts|tsx)$/;
const CATALOG_DIR = "app/i18n";
/** Files of the translation module that are not catalogs. */
const NOT_A_CATALOG = new Set(["index.ts", "rich.ts"]);

const STRING = String.raw`("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')`;
const NAMED = new RegExp(String.raw`(?<![\w.])(?:t|m|rich)\(\s*${STRING}`, "g");
const PLURAL = new RegExp(String.raw`(?<![\w.])plural\(\s*[^,()]+,\s*${STRING},\s*${STRING}`, "g");
/** Every call of `plural`, read or not; a definition (`function plural(`) is not a call. */
const PLURAL_CALL = /(?<![\w.])(?<!function\s+)plural\(/g;
const VALUE = /\{(\w+)\}/g;

/** Names and code are not words: they read the same in every language. */
const NOT_WORDS = new Set(["Podbay", "MCP", "Model Context Protocol"]);
const SPOKEN_ATTRIBUTE =
	/\s(aria-label|title|placeholder|label|alt|description)="([^"]*\p{L}{2,}[^"]*)"/gu;
/** Text between two tags on one line: `<p>Words</p>`. */
const INLINE_TEXT = /<(?!code\b)[A-Za-z][^<>]*[^=/]>\s*([^<>{}]*\p{L}{2,}[^<>{}]*?)\s*<\//gu;
/** A line of a screen that is nothing but words. */
const TEXT_LINE = /^\s*(\p{Lu}[\p{L}\p{N} ,.'’:;!?()-]*\p{L}[.!?:]?)\s*$/u;

/** The text a string literal of the source stands for. */
function literal(source: string): string {
	const body = source.slice(1, -1);
	return body.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|.)/g, (_, code: string) => {
		if (code === "n") return "\n";
		if (code === "t") return "\t";
		if (code.startsWith("u{")) return String.fromCodePoint(Number.parseInt(code.slice(2, -1), 16));
		if (code.startsWith("u")) return String.fromCharCode(Number.parseInt(code.slice(1), 16));
		return code;
	});
}

/** Comments are prose about the rule, not code that names a message. */
function withoutComments(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

/** The messages a file names. */
export function messagesOf(source: string): string[] {
	const code = withoutComments(source);
	const found: string[] = [];
	for (const match of code.matchAll(NAMED)) found.push(literal(match[1] ?? '""'));
	for (const match of code.matchAll(PLURAL)) {
		found.push(literal(match[1] ?? '""'), literal(match[2] ?? '""'));
	}
	return found;
}

/**
 * Calls of `plural` this check cannot read: anything but a plain count and two literal strings
 * (a count that is itself a call, say). Each would name messages the check never sees.
 */
export function unreadPlurals(file: string, source: string): string[] {
	const code = withoutComments(source);
	const problems: string[] = [];
	for (const call of code.matchAll(PLURAL_CALL)) {
		const at = call.index ?? 0;
		const read = new RegExp(PLURAL.source, "y");
		read.lastIndex = at;
		if (read.test(code)) continue;
		const line = code.slice(0, at).split("\n").length;
		problems.push(
			`${file}:${line}: plural() is given what this check cannot read; give it a plain count and two literal strings (rule D8)`,
		);
	}
	return problems;
}

const valuesOf = (text: string): string =>
	[...new Set([...text.matchAll(VALUE)].map((match) => match[1]))].sort().join(", ");

/** What is wrong between the messages the code names and one catalog. */
export function catalogProblems(
	language: string,
	named: ReadonlyMap<string, string>,
	catalog: Readonly<Record<string, string>>,
): string[] {
	const problems: string[] = [];
	for (const [message, file] of named) {
		const translation = catalog[message];
		if (translation === undefined) {
			problems.push(`${file}: ${JSON.stringify(message)} has no translation in ${language}`);
		} else if (translation.trim() === "") {
			problems.push(`${CATALOG_DIR}/${language}.ts: ${JSON.stringify(message)} is empty`);
		} else if (valuesOf(translation) !== valuesOf(message)) {
			problems.push(
				`${CATALOG_DIR}/${language}.ts: ${JSON.stringify(message)} takes {${valuesOf(message)}} but its translation has {${valuesOf(translation)}}`,
			);
		}
	}
	for (const message of Object.keys(catalog)) {
		if (!named.has(message)) {
			problems.push(
				`${CATALOG_DIR}/${language}.ts: ${JSON.stringify(message)} is not a message of the app any more`,
			);
		}
	}
	return problems;
}

/** Words that stand bare in the markup of a screen. */
export function bareWords(file: string, source: string): string[] {
	if (!file.endsWith(".tsx")) return [];
	const problems: string[] = [];
	const say = (line: number, words: string) => {
		// An address is not words either.
		if (NOT_WORDS.has(words.trim()) || /^[a-z]+:\/\/\S+$/.test(words.trim())) return;
		problems.push(
			`${file}:${line}: ${JSON.stringify(words.trim())} is not a message; use t() (rule D8)`,
		);
	};
	const lines = withoutComments(source).split("\n");
	lines.forEach((text, index) => {
		for (const match of text.matchAll(SPOKEN_ATTRIBUTE)) say(index + 1, match[2] ?? "");
		for (const match of text.matchAll(INLINE_TEXT)) say(index + 1, match[1] ?? "");
		const alone = TEXT_LINE.exec(text);
		// A line of words inside markup follows a line that ends a tag or a block of code.
		if (
			alone &&
			/[>})]\s*$/.test(lines[index - 1] ?? "") &&
			/^\s*[<{]/.test(lines[index + 1] ?? "")
		) {
			say(index + 1, alone[1] ?? "");
		}
	});
	return problems;
}

async function catalogs(): Promise<Map<string, Readonly<Record<string, string>>>> {
	const found = new Map<string, Readonly<Record<string, string>>>();
	if (!existsSync(CATALOG_DIR)) return found;
	for (const name of readdirSync(CATALOG_DIR).sort()) {
		if (!name.endsWith(".ts") || NOT_A_CATALOG.has(name)) continue;
		const language = name.slice(0, -3);
		const module: Record<string, unknown> = await import(
			pathToFileURL(`${process.cwd()}/${CATALOG_DIR}/${name}`).href
		);
		const catalog = module[language];
		if (typeof catalog === "object" && catalog !== null) {
			found.set(language, catalog as Readonly<Record<string, string>>);
		}
	}
	return found;
}

export const check: Check = {
	name: "messages",
	async run() {
		const problems: string[] = [];
		/** Each message, with the first file that names it. */
		const named = new Map<string, string>();
		for (const file of repoFiles()) {
			if (!UI_FILE.test(file) || file.startsWith(`${CATALOG_DIR}/`) || !existsSync(file)) continue;
			const source = read(file);
			for (const message of messagesOf(source)) if (!named.has(message)) named.set(message, file);
			problems.push(...unreadPlurals(file, source));
			problems.push(...bareWords(file, source));
		}
		for (const [language, catalog] of await catalogs()) {
			problems.push(...catalogProblems(language, named, catalog));
		}
		return problems;
	},
};
