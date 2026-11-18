// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Tier 0: `biome.json` names the schema of the Biome that `package.json` pins
 * (`pnpm static schemas`), so an update of the tool cannot leave its configuration behind.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { schemaProblems } from "../../scripts/checks/schemas.ts";

const at = (version: string) => ({ $schema: `https://biomejs.dev/schemas/${version}/schema.json` });
const pinned = (version: string) => ({ devDependencies: { "@biomejs/biome": version } });

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

	it("is refused when the tool is not a dependency", () => {
		expect(schemaProblems(at("2.6.8"), { devDependencies: {} })).toHaveLength(1);
	});

	it("holds for this repository", () => {
		const read = (path: string) =>
			JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")) as never;
		expect(schemaProblems(read("biome.json"), read("package.json"))).toEqual([]);
	});
});
