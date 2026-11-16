import { describe, expect, it } from "vitest";
import {
	check,
	entryProblems,
	expectedWranglerIds,
	isIsoDate,
	ledgerIds,
	ledgerProblems,
	MAX_EVIDENCE,
	parseJsonc,
	staleEntries,
	stripJsonComments,
	wranglerProblems,
} from "../../scripts/checks/ledger.ts";

const exists = (path: string) => path !== "gone.ts";

function entry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		id: "wrangler.send_email",
		kind: "config",
		relies: "The Worker has a send binding.",
		source: "https://developers.cloudflare.com/email-service/api/send-emails/workers-api/",
		pageUpdated: "2026-10-30",
		verifiedAt: "2026-11-17",
		evidence: "Configure a `send_email` binding in your Wrangler configuration file",
		code: ["wrangler.jsonc"],
		...overrides,
	};
}

function without(field: string): Record<string, unknown> {
	const copy = entry();
	delete copy[field];
	return copy;
}

const problemsOf = (value: unknown) => entryProblems(value, "ledger entry #1", exists);

describe("entryProblems", () => {
	it("accepts a complete entry, with or without a note", () => {
		expect(problemsOf(entry())).toEqual([]);
		expect(problemsOf(entry({ note: "The page calls this legacy." }))).toEqual([]);
		expect(problemsOf(entry({ pageUpdated: null }))).toEqual([]);
	});

	it.each(["id", "kind", "relies", "source", "pageUpdated", "verifiedAt", "evidence", "code"])(
		"rejects an entry without %s",
		(field) => {
			const problems = problemsOf(without(field));
			expect(problems).toHaveLength(1);
			expect(problems[0]).toContain(`missing "${field}"`);
		},
	);

	it("names the entry by its id, or by its position when it has none", () => {
		expect(problemsOf(entry({ kind: "other" }))[0]).toMatch(
			/^ledger entry "wrangler.send_email": /,
		);
		expect(problemsOf(without("id"))[0]).toMatch(/^ledger entry #1: /);
		expect(problemsOf("text")).toEqual(["ledger entry #1: is not an object"]);
	});

	it.each([
		"http://developers.cloudflare.com/workers/",
		"https://developers.cloudflare.com/",
		"https://developers.cloudflare.com.example.org/workers/",
		"https://blog.cloudflare.com/a-post/",
		"https://raw.githubusercontent.com/someone/repo/main/file.ts",
		"https://example.org/docs/",
	])("rejects the source %s", (source) => {
		const problems = problemsOf(entry({ source }));
		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain('"source" must start with');
	});

	it("accepts a source in a Cloudflare repository", () => {
		const source = "https://raw.githubusercontent.com/cloudflare/workers-sdk/main/README.md";
		expect(problemsOf(entry({ source }))).toEqual([]);
	});

	it("rejects empty evidence and evidence over the limit", () => {
		expect(problemsOf(entry({ evidence: "" }))).toEqual([
			'ledger entry "wrangler.send_email": "evidence" must be a non-empty string',
		]);
		expect(problemsOf(entry({ evidence: "x".repeat(MAX_EVIDENCE) }))).toEqual([]);
		expect(problemsOf(entry({ evidence: "x".repeat(MAX_EVIDENCE + 1) }))).toEqual([
			`ledger entry "wrangler.send_email": "evidence" has ${MAX_EVIDENCE + 1} characters; the limit is ${MAX_EVIDENCE}`,
		]);
	});

	it.each(["17 November 2026", "2026-11-31", "2026-13-01", "2026-11-17T10:00:00Z", 20261117, ""])(
		"rejects verifiedAt %j",
		(verifiedAt) => {
			const problems = problemsOf(entry({ verifiedAt }));
			expect(problems).toHaveLength(1);
			expect(problems[0]).toContain('"verifiedAt" must be a yyyy-mm-dd date or null');
		},
	);

	it("rejects a pageUpdated that is not a date", () => {
		expect(problemsOf(entry({ pageUpdated: "Oct 30, 2026" }))).toEqual([
			'ledger entry "wrangler.send_email": "pageUpdated" must be a yyyy-mm-dd date or null',
		]);
	});

	it("wants an unverified entry to say what is missing", () => {
		const problems = problemsOf(entry({ verifiedAt: null }));
		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain('must start with "needs verification:"');
		expect(
			problemsOf(entry({ verifiedAt: null, evidence: "needs verification: the page returns 404" })),
		).toEqual([]);
	});

	it("rejects a verified entry whose evidence still asks for verification", () => {
		const problems = problemsOf(entry({ evidence: "needs verification: the page returns 404" }));
		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain('"verifiedAt" must be null');
	});

	it("rejects a code path that does not exist, and an empty list", () => {
		expect(problemsOf(entry({ code: ["wrangler.jsonc", "gone.ts"] }))).toEqual([
			'ledger entry "wrangler.send_email": "code" names gone.ts, which does not exist',
		]);
		expect(problemsOf(entry({ code: [] }))).toHaveLength(1);
		expect(problemsOf(entry({ code: "wrangler.jsonc" }))).toHaveLength(1);
	});

	it("rejects an unknown kind, an unknown field and a malformed id", () => {
		expect(problemsOf(entry({ kind: "guess" }))).toHaveLength(1);
		expect(problemsOf(entry({ verifiedat: "2026-11-17" }))).toEqual([
			'ledger entry "wrangler.send_email": unknown field "verifiedat"',
		]);
		expect(problemsOf(entry({ id: "Wrangler send email" }))).toHaveLength(1);
		expect(problemsOf(entry({ note: "" }))).toHaveLength(1);
	});
});

describe("ledgerProblems", () => {
	it("accepts a list of distinct entries", () => {
		const ledger = { version: 1, entries: [entry(), entry({ id: "wrangler.ai" })] };
		expect(ledgerProblems(ledger, exists)).toEqual([]);
		expect(ledgerIds(ledger)).toEqual(["wrangler.send_email", "wrangler.ai"]);
	});

	it("rejects duplicate ids", () => {
		expect(ledgerProblems({ entries: [entry(), entry()] }, exists)).toEqual([
			'ledger entry "wrangler.send_email": duplicate id',
		]);
	});

	it("rejects a document without an entries list", () => {
		expect(ledgerProblems([entry()], exists)).toHaveLength(1);
		expect(ledgerProblems({ entries: {} }, exists)).toHaveLength(1);
		expect(ledgerIds(null)).toEqual([]);
	});

	it("reports every malformed entry by position", () => {
		const problems = ledgerProblems({ entries: [entry(), without("id"), 7] }, exists);
		expect(problems).toEqual([
			'ledger entry #2: missing "id"',
			"ledger entry #3: is not an object",
		]);
	});
});

describe("stripJsonComments", () => {
	it("removes comments and trailing commas, and leaves strings alone", () => {
		const text = `{
			// a line comment
			"url": "https://example.com/a", /* a block
			comment */
			"paths": ["/api/*", "/mcp/*", "a // b", "quote \\" // still text",],
		}`;
		expect(parseJsonc(text)).toEqual({
			url: "https://example.com/a",
			paths: ["/api/*", "/mcp/*", "a // b", 'quote " // still text'],
		});
		expect(stripJsonComments('{"a": ",]"}')).toBe('{"a": ",]"}');
	});
});

describe("wrangler coverage", () => {
	const config = parseJsonc(`{
		"$schema": "node_modules/wrangler/config-schema.json",
		"name": "podbay",
		// moved forward every month
		"compatibility_date": "2026-11-16",
		"compatibility_flags": ["nodejs_compat"],
		"assets": { "not_found_handling": "single-page-application", "run_worker_first": ["/api/*"] },
		"send_email": [{ "name": "EMAIL" }],
		"durable_objects": { "bindings": [{ "name": "MAILBOX", "class_name": "MailboxDO" }] },
		"migrations": [
			{ "tag": "v1", "new_sqlite_classes": ["MailboxDO"] },
			{ "tag": "v2", "new_sqlite_classes": ["EmailAgent"] },
		],
	}`);
	const ids = [
		"wrangler.assets.not_found_handling",
		"wrangler.assets.run_worker_first",
		"wrangler.compatibility_date",
		"wrangler.compatibility_flags.nodejs_compat",
		"wrangler.durable_objects",
		"wrangler.migrations.new_sqlite_classes",
		"wrangler.name",
		"wrangler.send_email",
	];

	it("maps keys, binding kinds, flags, asset options and migration directives to ids", () => {
		expect(expectedWranglerIds(config)).toEqual(ids);
		expect(expectedWranglerIds(null)).toEqual([]);
	});

	it("passes when every surface has an entry; other entries are not its concern", () => {
		expect(wranglerProblems(config, [...ids, "runtime.r2.head"])).toEqual([]);
	});

	it("fails on a binding kind without an entry", () => {
		const withQueue = { ...(config as object), queues: { producers: [] } };
		expect(wranglerProblems(withQueue, ids)).toEqual([
			'wrangler.jsonc: queues has no ledger entry; add "wrangler.queues" to docs/cloudflare/ledger.json (rule V5)',
		]);
	});

	it("fails on a compatibility flag, an asset option or a migration directive without an entry", () => {
		const more = {
			compatibility_flags: ["nodejs_compat", "global_fetch_strictly_public"],
			assets: { html_handling: "none" },
			migrations: [{ tag: "v4", deleted_classes: ["EmailMCP"] }],
		};
		expect(wranglerProblems(more, ["wrangler.compatibility_flags.nodejs_compat"])).toEqual([
			expect.stringContaining('add "wrangler.assets.html_handling"'),
			expect.stringContaining('add "wrangler.compatibility_flags.global_fetch_strictly_public"'),
			expect.stringContaining('add "wrangler.migrations.deleted_classes"'),
		]);
	});

	it("reads the keys of every environment", () => {
		const withEnv = { name: "podbay", env: { staging: { kv_namespaces: [] } } };
		expect(expectedWranglerIds(withEnv)).toEqual(["wrangler.kv_namespaces", "wrangler.name"]);
	});

	it("fails on an entry whose key is no longer in the configuration", () => {
		expect(wranglerProblems(config, [...ids, "wrangler.kv_namespaces"])).toEqual([
			'docs/cloudflare/ledger.json: "wrangler.kv_namespaces" matches nothing in wrangler.jsonc; remove or rename the entry',
		]);
	});
});

describe("staleEntries", () => {
	const entries = [
		{ id: "fresh", verifiedAt: "2026-11-17", evidence: "a quote" },
		{ id: "edge", verifiedAt: "2026-08-19", evidence: "a quote" },
		{ id: "old", verifiedAt: "2026-08-18", evidence: "a quote" },
		{ id: "open", verifiedAt: null, evidence: "needs verification: the page returns 404" },
	];

	it("lists unverified entries and entries older than 90 days", () => {
		expect(staleEntries(entries, "2026-11-17")).toEqual([
			"old: verified 2026-08-18, 91 days ago",
			"open: unverified (needs verification: the page returns 404)",
		]);
	});

	it("takes another age limit", () => {
		expect(staleEntries(entries, "2026-11-17", 0)).toHaveLength(3);
		expect(staleEntries(entries, "2026-11-17", 365)).toHaveLength(1);
	});
});

describe("isIsoDate", () => {
	it("accepts real calendar days only", () => {
		expect(isIsoDate("2026-11-17")).toBe(true);
		expect(isIsoDate("2028-02-29")).toBe(true);
		expect(isIsoDate("2026-02-29")).toBe(false);
		expect(isIsoDate("2026-1-7")).toBe(false);
		expect(isIsoDate(null)).toBe(false);
	});
});

describe("this repository", () => {
	it("passes the ledger check", async () => {
		expect(await check.run()).toEqual([]);
	});
});
