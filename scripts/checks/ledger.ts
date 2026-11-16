/**
 * V5: Cloudflare facts come from current sources, never memory. Every Cloudflare surface the code
 * relies on has an entry in docs/cloudflare/ledger.json with the source URL, the date it was read
 * and a quote from it. This check fails when:
 *
 * - an entry is malformed (see `entryProblems`);
 * - `wrangler.jsonc` uses a configuration key, a binding kind or a compatibility flag that no
 *   entry covers, or the ledger has a `wrangler.*` entry for something the file no longer uses.
 *
 * Staleness is a report, not a failure:
 *
 *   node scripts/checks/ledger.ts --stale    entries that are unverified or older than 90 days
 */
import { existsSync } from "node:fs";
import { type Check, read } from "./lib.ts";

export const LEDGER_PATH = "docs/cloudflare/ledger.json";
export const WRANGLER_PATH = "wrangler.jsonc";
export const MAX_EVIDENCE = 200;
export const MAX_AGE_DAYS = 90;
export const UNVERIFIED_PREFIX = "needs verification:";
export const KINDS: readonly string[] = ["config", "runtime", "limit", "plan", "tooling"];

export interface LedgerEntry {
	/** Unique, dotted: `wrangler.send_email`, `runtime.r2.head`, `limit.queues.message_size`. */
	readonly id: string;
	readonly kind: string;
	/** One or two sentences: what Podbay relies on. */
	readonly relies: string;
	readonly source: string;
	/** The page's own "Last updated" date; null when the source shows none. */
	readonly pageUpdated: string | null;
	/** The day the source was read and the fact confirmed; null when it could not be confirmed. */
	readonly verifiedAt: string | null;
	/** A verbatim quote from the source, or `needs verification: …` when `verifiedAt` is null. */
	readonly evidence: string;
	/** Repository files that rely on the fact. */
	readonly code: readonly string[];
	/** Optional: where the source is narrower than the code assumes, or disagrees with it. */
	readonly note?: string;
}

const FIELDS = [
	"id",
	"kind",
	"relies",
	"source",
	"pageUpdated",
	"verifiedAt",
	"evidence",
	"code",
] as const;
const OPTIONAL_FIELDS: readonly string[] = ["note"];
const ID = /^[a-z][A-Za-z0-9_.-]*$/;
const SOURCE =
	/^https:\/\/(developers\.cloudflare\.com|raw\.githubusercontent\.com\/cloudflare)\/\S+$/;
const DAY = 86_400_000;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

/** A real calendar day written as `yyyy-mm-dd`. */
export function isIsoDate(value: unknown): value is string {
	if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const time = Date.parse(`${value}T00:00:00Z`);
	return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function dateProblem(name: string, value: unknown): string | null {
	if (value === null || isIsoDate(value)) return null;
	return `"${name}" must be a yyyy-mm-dd date or null`;
}

function evidenceProblems(evidence: string, verifiedAt: unknown): string[] {
	const problems: string[] = [];
	if (evidence.length > MAX_EVIDENCE) {
		problems.push(`"evidence" has ${evidence.length} characters; the limit is ${MAX_EVIDENCE}`);
	}
	const unverified = evidence.startsWith(UNVERIFIED_PREFIX);
	if (verifiedAt === null && !unverified) {
		problems.push(`"verifiedAt" is null, so "evidence" must start with "${UNVERIFIED_PREFIX}"`);
	}
	if (isIsoDate(verifiedAt) && unverified) {
		problems.push(`"evidence" starts with "${UNVERIFIED_PREFIX}", so "verifiedAt" must be null`);
	}
	return problems;
}

function codeProblems(code: unknown, exists: (path: string) => boolean): string[] {
	if (!Array.isArray(code) || code.length === 0) {
		return ['"code" must be a non-empty list of repository paths'];
	}
	const problems: string[] = [];
	for (const path of code) {
		if (!isText(path)) problems.push('"code" holds a value that is not a path');
		else if (!exists(path)) problems.push(`"code" names ${path}, which does not exist`);
	}
	return problems;
}

/** Problems of one entry. `exists` says whether a repository path exists. */
export function entryProblems(
	entry: unknown,
	label: string,
	exists: (path: string) => boolean,
): string[] {
	if (!isRecord(entry)) return [`${label}: is not an object`];
	const name = isText(entry.id) ? `ledger entry "${entry.id}"` : label;
	const problems: string[] = [];
	for (const field of FIELDS) {
		if (!(field in entry)) problems.push(`missing "${field}"`);
	}
	for (const key of Object.keys(entry)) {
		const known = (FIELDS as readonly string[]).includes(key) || OPTIONAL_FIELDS.includes(key);
		if (!known) problems.push(`unknown field "${key}"`);
	}
	for (const field of ["id", "kind", "relies", "source", "evidence"] as const) {
		if (field in entry && !isText(entry[field])) {
			problems.push(`"${field}" must be a non-empty string`);
		}
	}
	if (isText(entry.id) && !ID.test(entry.id)) {
		problems.push('"id" must be dotted words, starting with a lower-case letter');
	}
	if (isText(entry.kind) && !KINDS.includes(entry.kind)) {
		problems.push(`"kind" must be one of ${KINDS.join(", ")}`);
	}
	if (isText(entry.source) && !SOURCE.test(entry.source)) {
		problems.push(
			'"source" must start with https://developers.cloudflare.com/ or https://raw.githubusercontent.com/cloudflare/',
		);
	}
	for (const field of ["pageUpdated", "verifiedAt"] as const) {
		const problem = field in entry ? dateProblem(field, entry[field]) : null;
		if (problem) problems.push(problem);
	}
	if (isText(entry.evidence) && "verifiedAt" in entry) {
		problems.push(...evidenceProblems(entry.evidence, entry.verifiedAt));
	}
	if ("code" in entry) problems.push(...codeProblems(entry.code, exists));
	if ("note" in entry && !isText(entry.note)) problems.push('"note" must be a non-empty string');
	return problems.map((problem) => `${name}: ${problem}`);
}

/** Problems of the whole ledger document: its shape, every entry, duplicate ids. */
export function ledgerProblems(ledger: unknown, exists: (path: string) => boolean): string[] {
	if (!isRecord(ledger) || !Array.isArray(ledger.entries)) {
		return [`${LEDGER_PATH}: must be an object with an "entries" list`];
	}
	const problems: string[] = [];
	const seen = new Set<string>();
	ledger.entries.forEach((entry: unknown, index: number) => {
		problems.push(...entryProblems(entry, `ledger entry #${index + 1}`, exists));
		if (!isRecord(entry) || !isText(entry.id)) return;
		if (seen.has(entry.id)) problems.push(`ledger entry "${entry.id}": duplicate id`);
		seen.add(entry.id);
	});
	return problems;
}

/** The ids of the entries that have one. */
export function ledgerIds(ledger: unknown): string[] {
	if (!isRecord(ledger) || !Array.isArray(ledger.entries)) return [];
	const ids: string[] = [];
	for (const entry of ledger.entries) {
		if (isRecord(entry) && isText(entry.id)) ids.push(entry.id);
	}
	return ids;
}

/** JSONC to JSON: removes `//` and block comments and trailing commas, never inside a string. */
export function stripJsonComments(text: string): string {
	let out = "";
	let i = 0;
	while (i < text.length) {
		const char = text[i] ?? "";
		const next = text[i + 1] ?? "";
		if (char === '"') {
			const start = i++;
			while (i < text.length && text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
			out += text.slice(start, ++i);
		} else if (char === "/" && next === "/") {
			while (i < text.length && text[i] !== "\n") i++;
		} else if (char === "/" && next === "*") {
			const end = text.indexOf("*/", i + 2);
			i = end === -1 ? text.length : end + 2;
		} else {
			out += char;
			i++;
		}
	}
	return out.replace(/("(?:[^"\\]|\\.)*")|,(\s*[}\]])/g, (_, quoted, close) => quoted ?? close);
}

export function parseJsonc(text: string): unknown {
	return JSON.parse(stripJsonComments(text));
}

/** Keys of the configuration file that are not a Cloudflare surface. */
const IGNORED_KEYS: readonly string[] = ["$schema"];

/**
 * The ledger ids a Wrangler configuration needs:
 *
 * - a top-level key or binding kind `send_email` needs `wrangler.send_email`;
 * - each compatibility flag needs `wrangler.compatibility_flags.<flag>`;
 * - each key under `assets` needs `wrangler.assets.<key>`;
 * - each migration directive (every key of a step except `tag`) needs `wrangler.migrations.<key>`;
 * - each environment under `env` needs the same ids as the top level.
 */
export function expectedWranglerIds(config: unknown): string[] {
	const ids = new Set<string>();
	if (!isRecord(config)) return [];
	for (const [key, value] of Object.entries(config)) {
		if (IGNORED_KEYS.includes(key)) continue;
		if (key === "compatibility_flags" && Array.isArray(value)) {
			for (const flag of value) ids.add(`wrangler.compatibility_flags.${String(flag)}`);
		} else if (key === "assets" && isRecord(value)) {
			for (const sub of Object.keys(value)) ids.add(`wrangler.assets.${sub}`);
		} else if (key === "migrations" && Array.isArray(value)) {
			for (const step of value) {
				if (!isRecord(step)) continue;
				for (const directive of Object.keys(step)) {
					if (directive !== "tag") ids.add(`wrangler.migrations.${directive}`);
				}
			}
		} else if (key === "env" && isRecord(value)) {
			for (const environment of Object.values(value)) {
				for (const id of expectedWranglerIds(environment)) ids.add(id);
			}
		} else {
			ids.add(`wrangler.${key}`);
		}
	}
	return [...ids].sort();
}

/** Configuration without a ledger entry, and `wrangler.*` entries without configuration. */
export function wranglerProblems(config: unknown, ids: readonly string[]): string[] {
	const expected = expectedWranglerIds(config);
	const have = new Set(ids);
	const problems: string[] = [];
	for (const id of expected) {
		if (have.has(id)) continue;
		const surface = id.slice("wrangler.".length);
		problems.push(
			`${WRANGLER_PATH}: ${surface} has no ledger entry; add "${id}" to ${LEDGER_PATH} (rule V5)`,
		);
	}
	for (const id of [...have].sort()) {
		if (!id.startsWith("wrangler.") || expected.includes(id)) continue;
		problems.push(
			`${LEDGER_PATH}: "${id}" matches nothing in ${WRANGLER_PATH}; remove or rename the entry`,
		);
	}
	return problems;
}

/** One line per entry that is unverified, or was verified more than `maxAgeDays` before `today`. */
export function staleEntries(
	entries: readonly Pick<LedgerEntry, "id" | "verifiedAt" | "evidence">[],
	today: string,
	maxAgeDays: number = MAX_AGE_DAYS,
): string[] {
	const now = Date.parse(`${today}T00:00:00Z`);
	const stale: string[] = [];
	for (const entry of entries) {
		if (entry.verifiedAt === null) {
			stale.push(`${entry.id}: unverified (${entry.evidence})`);
			continue;
		}
		const age = Math.floor((now - Date.parse(`${entry.verifiedAt}T00:00:00Z`)) / DAY);
		if (age > maxAgeDays) {
			stale.push(`${entry.id}: verified ${entry.verifiedAt}, ${age} days ago`);
		}
	}
	return stale;
}

function readLedger(): { ledger: unknown; problems: string[] } {
	if (!existsSync(LEDGER_PATH)) return { ledger: null, problems: [`${LEDGER_PATH}: is missing`] };
	try {
		return { ledger: JSON.parse(read(LEDGER_PATH)), problems: [] };
	} catch (error) {
		const reason = (error as Error).message;
		return { ledger: null, problems: [`${LEDGER_PATH}: is not valid JSON (${reason})`] };
	}
}

export const check: Check = {
	name: "ledger",
	run() {
		const { ledger, problems } = readLedger();
		if (problems.length > 0) return problems;
		problems.push(...ledgerProblems(ledger, existsSync));
		if (!existsSync(WRANGLER_PATH)) return [...problems, `${WRANGLER_PATH}: is missing`];
		try {
			problems.push(...wranglerProblems(parseJsonc(read(WRANGLER_PATH)), ledgerIds(ledger)));
		} catch (error) {
			problems.push(`${WRANGLER_PATH}: cannot be parsed (${(error as Error).message})`);
		}
		return problems;
	},
};

if (import.meta.url === `file://${process.argv[1]}`) {
	if (process.argv.includes("--stale")) {
		const { ledger, problems } = readLedger();
		const valid = problems.length === 0 && ledgerProblems(ledger, existsSync).length === 0;
		if (!valid) {
			process.stdout.write(`${LEDGER_PATH} is not valid; run the check without --stale first\n`);
		} else {
			const entries = (ledger as { entries: LedgerEntry[] }).entries;
			const stale = staleEntries(entries, new Date().toISOString().slice(0, 10));
			for (const line of stale) process.stdout.write(`${line}\n`);
			process.stdout.write(
				`${stale.length} of ${entries.length} entries are unverified or older than ${MAX_AGE_DAYS} days\n`,
			);
		}
	} else {
		const problems = await check.run();
		for (const problem of problems) process.stdout.write(`${problem}\n`);
		process.exitCode = problems.length === 0 ? 0 : 1;
	}
}
