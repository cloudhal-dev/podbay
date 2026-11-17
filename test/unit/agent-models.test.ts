// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Rule V5 for model ids: one module names them, each is used, and each has a ledger entry that
 * was read from a current Cloudflare page.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { MODELS } from "../../workers/lib/models.ts";

const ROOT = join(import.meta.dirname, "../..");
const MODELS_FILE = "workers/lib/models.ts";

function workerSources(): { path: string; source: string }[] {
	const dir = join(ROOT, "workers");
	return readdirSync(dir, { recursive: true, encoding: "utf8" })
		.filter((file) => /\.tsx?$/.test(file))
		.map((file) => {
			const full = join(dir, file);
			return {
				path: relative(ROOT, full).replaceAll("\\", "/"),
				source: readFileSync(full, "utf8"),
			};
		});
}

interface LedgerEntry {
	id: string;
	relies: string;
	source: string;
	verifiedAt: string | null;
	evidence: string;
	code: string[];
}

function ledger(): LedgerEntry[] {
	const file = readFileSync(join(ROOT, "docs/cloudflare/ledger.json"), "utf8");
	return (JSON.parse(file) as { entries: LedgerEntry[] }).entries;
}

describe("model ids", () => {
	const ids = Object.values(MODELS);

	it("are Workers AI ids, each named once", () => {
		expect(ids.length).toBeGreaterThan(0);
		for (const id of ids) expect(id).toMatch(/^@cf\/[a-z0-9-]+\/[A-Za-z0-9._-]+$/);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("appear as string literals only in the model module", () => {
		const offenders: string[] = [];
		for (const { path, source } of workerSources()) {
			if (path === MODELS_FILE) continue;
			source.split("\n").forEach((line, index) => {
				if (/["'`]@(cf|hf)\//.test(line)) offenders.push(`${path}:${index + 1}`);
			});
		}
		expect(offenders).toEqual([]);
	});

	it("are all used, through the model module", () => {
		const sources = workerSources().filter(({ path }) => path !== MODELS_FILE);
		for (const key of Object.keys(MODELS)) {
			const users = sources.filter(({ source }) => source.includes(`MODELS.${key}`));
			expect(
				users.map((user) => user.path),
				`MODELS.${key}`,
			).not.toEqual([]);
		}
	});

	it("each have a ledger entry verified against a current Cloudflare page", () => {
		const entries = ledger().filter((entry) => entry.id.startsWith("runtime.ai.model."));
		for (const id of ids) {
			const entry = entries.find((candidate) => candidate.relies.includes(`\`${id}\``));
			expect(entry, id).toBeDefined();
			expect(entry?.verifiedAt, id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
			expect(entry?.source, id).toBe(
				`https://developers.cloudflare.com/workers-ai/models/${id.split("/")[2]}/`,
			);
			expect(entry?.code, id).toContain(MODELS_FILE);
		}
	});

	it("leave no ledger entry for a model the code no longer names", () => {
		const entries = ledger().filter((entry) => entry.id.startsWith("runtime.ai.model."));
		const stale = entries.filter((entry) => !ids.some((id) => entry.relies.includes(`\`${id}\``)));
		expect(stale.map((entry) => entry.id)).toEqual([]);
	});
});
