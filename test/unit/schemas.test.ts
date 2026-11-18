// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Tier 0: `biome.json` follows what the workspace's catalog pins (`pnpm static schemas`): it names
 * the schema of that Biome, so an update of the tool cannot leave its configuration behind, and it
 * names every domain of Biome's rules a catalog entry would turn on, since an entry written as
 * `catalog:` turns none on by itself.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { schemaProblems } from "../../scripts/checks/schemas.ts";
import { readAll } from "../../scripts/pins.ts";

const at = (version: string) => ({ $schema: `https://biomejs.dev/schemas/${version}/schema.json` });
const pinned = (version: string) => ({ "@biomejs/biome": version });

describe("the schema biome.json names", () => {
	it("is the pinned version", () => {
		expect(schemaProblems(at("2.6.8"), pinned("2.6.8"))).toEqual([]);
	});

	it("is refused when the tool moved on and the schema did not", () => {
		expect(schemaProblems(at("2.6.7"), pinned("2.6.8"))).toEqual([
			'biome.json: the schema is 2.6.7 and @biomejs/biome is pinned at 2.6.8; set "$schema" to 2.6.8',
		]);
	});

	it.each([
		["no schema", {}],
		["a schema of another address", { $schema: "https://example.test/schemas/2.6.8/schema.json" }],
		["a schema without a version", { $schema: "https://biomejs.dev/schemas/latest/schema.json" }],
	])("is refused with %s", (_what, biome) => {
		expect(schemaProblems(biome, pinned("2.6.8"))).toHaveLength(1);
	});

	it("is refused when the tool is not in the catalog", () => {
		expect(schemaProblems(at("2.6.8"), {})).toHaveLength(1);
	});

	it("holds for this repository", () => {
		const read = readAll();
		if ("problems" in read) throw new Error(read.problems.join("; "));
		const biome = JSON.parse(readFileSync(new URL("../../biome.json", import.meta.url), "utf8"));
		expect(schemaProblems(biome, read.workspace.catalog)).toEqual([]);
	});
});

describe("the domains of Biome's rules", () => {
	const named = (...domains: string[]) => ({
		...at("2.6.8"),
		linter: { domains: Object.fromEntries(domains.map((one) => [one, "recommended"])) },
	});

	it("are named for every catalog entry that would turn one on", () => {
		const catalog = { ...pinned("2.6.8"), react: "19.3.1", vitest: "5.1.0" };
		expect(schemaProblems(named("react", "test"), catalog)).toEqual([]);
		expect(schemaProblems(named("react"), catalog)).toEqual([
			'biome.json: the catalog has vitest, which turns Biome\'s "test" rules on; name it under linter.domains, as a catalog entry turns nothing on by itself',
		]);
	});

	it("are not asked for below the version that turns them on", () => {
		expect(schemaProblems(named(), { ...pinned("2.6.8"), react: "15.6.2" })).toEqual([]);
	});
});
