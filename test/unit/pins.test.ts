// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Tier 0: every version of the workspace is written once, in the catalog of pnpm-workspace.yaml,
 * exactly (V1, V3; ADR-0018, decision 4), and every package of the workspace is held to it, a
 * second package as much as the root.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { allPins, checkPins, newestSettled, readAll } from "../../scripts/pins.ts";
import { type Manifest, readWorkspace, type Workspace } from "../../scripts/workspace.ts";

const DAY = 86_400_000;

const workspace = (
	catalog: Record<string, string>,
	pinExceptions: Record<string, string> = {},
): Workspace => ({
	packages: [".", "packages/*"],
	catalog,
	pinExceptions,
});
const packages = (...list: [string, Manifest][]) => new Map(list);
const root: [string, Manifest] = [".", { name: "root", dependencies: { a: "catalog:" } }];

describe("checkPins", () => {
	it("accepts exact stable versions in the catalog, named as catalog: by every package", () => {
		const second: [string, Manifest] = [
			"packages/second",
			{ name: "second", devDependencies: { b: "catalog:", root: "workspace:*" } },
		];
		expect(checkPins(workspace({ a: "1.2.3", b: "10.0.0" }), packages(root, second))).toEqual([]);
	});

	it.each(["^1.2.3", "~1.2.3", "1.x", "latest", "1.2.3-beta.1", "1.2", ">=1.0.0"])(
		"refuses %j in the catalog",
		(version) => {
			expect(checkPins(workspace({ a: version }), packages(root))).toHaveLength(1);
		},
	);

	it("refuses a second package that writes a version of its own, pinned or not", () => {
		for (const spec of ["^2.0.0", "2.0.0", "latest"]) {
			const second: [string, Manifest] = [
				"packages/second",
				{ name: "second", dependencies: { c: spec } },
			];
			const problems = checkPins(workspace({ a: "1.2.3" }), packages(root, second));
			expect(problems, spec).toEqual([
				`packages/second: c is "${spec}"; a version is written once, in the catalog of pnpm-workspace.yaml, and the package says "catalog:"`,
			]);
		}
	});

	it("refuses a package that names a catalog entry that is not there, and an entry nobody uses", () => {
		const second: [string, Manifest] = [
			"packages/second",
			{ name: "second", dependencies: { gone: "catalog:" } },
		];
		expect(checkPins(workspace({ a: "1.2.3", unused: "1.0.0" }), packages(root, second))).toEqual([
			"packages/second: gone is not in the catalog",
			"catalog: unused is used by no package",
		]);
	});

	it("refuses workspace: for a package that is not of the workspace", () => {
		const second: [string, Manifest] = [
			"packages/second",
			{ name: "second", dependencies: { stranger: "workspace:*" } },
		];
		expect(checkPins(workspace({ a: "1.2.3" }), packages(root, second))).toHaveLength(1);
	});

	it("wants a dated exception for a 0.x release", () => {
		expect(checkPins(workspace({ a: "0.4.0" }), packages(root))).toHaveLength(1);
		expect(
			checkPins(workspace({ a: "0.4.0" }, { a: "2026-11-17: no 1.0 yet" }), packages(root)),
		).toEqual([]);
	});

	it("refuses an exception for a package that is not in the catalog", () => {
		expect(
			checkPins(workspace({ a: "1.2.3" }, { gone: "2026-11-17: old" }), packages(root)),
		).toHaveLength(1);
	});

	it("passes on this repository", () => {
		const read = readAll();
		if ("problems" in read) throw new Error(read.problems.join("; "));
		expect(allPins(read.workspace).length).toBeGreaterThan(20);
		expect(checkPins(read.workspace, read.packages)).toEqual([]);
	});
});

describe("the workspace file", () => {
	it("reads packages, the catalog and the other settings of one line", () => {
		const read = readWorkspace(
			'packages:\n  - "."\n  - "packages/*"\n\nminimumReleaseAge: 4320\n# a comment\ncatalog:\n  "@scope/a": 1.2.3\n  b: 4.5.6 # why\nallowBuilds:\n  esbuild: true\n',
		);
		expect(read).toEqual({
			packages: [".", "packages/*"],
			catalog: { "@scope/a": "1.2.3", b: "4.5.6" },
			pinExceptions: {},
		});
	});

	it.each([
		["a named catalog", "catalogs:\n  react18:\n    react: 18.0.0\n"],
		["a catalog written on one line", "catalog: { a: 1.0.0 }\n"],
		["an entry the reader does not read", "catalog:\n    a: 1.0.0\n"],
		["a package that is not a list item", "packages:\n  packages/*\n"],
		["an indented line outside the sections", "minimumReleaseAge: 4320\n  stray: 1\n"],
	])("refuses %s", (_what, text) => {
		expect(readWorkspace(text)).toHaveProperty("problems");
	});

	describe("on disk", () => {
		const dir = mkdtempSync(join(tmpdir(), "podbay-pins-"));
		afterAll(() => rmSync(dir, { recursive: true, force: true }));

		it("finds every package of the workspace and refuses the second one's own version", () => {
			writeFileSync(
				join(dir, "pnpm-workspace.yaml"),
				'packages:\n  - "."\n  - "packages/*"\ncatalog:\n  a: 1.2.3\n',
			);
			writeFileSync(
				join(dir, "package.json"),
				JSON.stringify({ name: "root", dependencies: { a: "catalog:" }, pinExceptions: {} }),
			);
			mkdirSync(join(dir, "packages", "second"), { recursive: true });
			writeFileSync(
				join(dir, "packages", "second", "package.json"),
				JSON.stringify({ name: "second", dependencies: { b: "^1.0.0" } }),
			);
			const read = readAll(dir);
			if ("problems" in read) throw new Error(read.problems.join("; "));
			expect([...read.packages.keys()]).toEqual([".", "packages/second"]);
			expect(checkPins(read.workspace, read.packages)).toEqual([
				'packages/second: b is "^1.0.0"; a version is written once, in the catalog of pnpm-workspace.yaml, and the package says "catalog:"',
			]);
		});
	});
});

describe("newestSettled", () => {
	const now = Date.parse("2026-11-17T00:00:00Z");
	const at = (daysAgo: number) => new Date(now - daysAgo * DAY).toISOString();

	it("picks the newest stable version that is old enough", () => {
		const times = {
			created: at(900),
			modified: at(0),
			"1.0.0": at(400),
			"1.9.0": at(30),
			"1.10.0": at(10),
			"2.0.0": at(1),
			"2.0.0-rc.1": at(20),
		};
		expect(newestSettled(times, now, 3)).toBe("1.10.0");
	});

	it("returns nothing when every version is too new", () => {
		expect(newestSettled({ "1.0.0": at(1) }, now, 3)).toBeUndefined();
	});
});
