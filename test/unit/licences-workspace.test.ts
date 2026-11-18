// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Tier 0: the licence check reads every package of the workspace, not the root's alone
 * (`pnpm static licences`; S15, S17; ADR-0018, decision 4). A throwaway workspace is installed
 * from local folders, nothing is fetched, and the dependency of its second package declares a
 * licence the list refuses.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { licenceProblems } from "../../scripts/checks/licences.ts";

const json = (path: string, value: object) => writeFileSync(path, JSON.stringify(value));

describe("the licence check in a workspace of two packages", () => {
	const dir = mkdtempSync(join(tmpdir(), "podbay-licences-"));
	afterAll(() => rmSync(dir, { recursive: true, force: true }));

	beforeAll(() => {
		writeFileSync(join(dir, "pnpm-workspace.yaml"), 'packages:\n  - "."\n  - "packages/*"\n');
		for (const [name, license] of [
			["permissive-thing", "MIT"],
			["copyleft-thing", "GPL-3.0-only"],
		] as const) {
			mkdirSync(join(dir, "vendor", name), { recursive: true });
			json(join(dir, "vendor", name, "package.json"), { name, version: "1.0.0", license });
		}
		json(join(dir, "package.json"), {
			name: "root-thing",
			version: "1.0.0",
			private: true,
			dependencies: { "permissive-thing": "file:./vendor/permissive-thing" },
		});
		mkdirSync(join(dir, "packages", "second"), { recursive: true });
		json(join(dir, "packages", "second", "package.json"), {
			name: "second",
			version: "1.0.0",
			private: true,
			dependencies: { "copyleft-thing": "file:../../vendor/copyleft-thing" },
		});
		execFileSync("pnpm", ["install", "--offline"], { cwd: dir, stdio: "ignore" });
	}, 60_000);

	it("refuses a licence of the second package's dependency", () => {
		expect(licenceProblems(dir)).toEqual([
			'copyleft-thing: licence "GPL-3.0-only" is not on the allow-list',
		]);
	});

	it("is what pnpm lists only when asked for every package", () => {
		const rootOnly = JSON.parse(
			execFileSync("pnpm", ["licenses", "list", "--json"], { cwd: dir, encoding: "utf8" }),
		) as Record<string, unknown>;
		expect(Object.keys(rootOnly)).toEqual(["MIT"]);
	});
});
