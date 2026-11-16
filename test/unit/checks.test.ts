import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { importProblems } from "../../scripts/checks/imports.ts";
import { checkLicences, licenceAllowed } from "../../scripts/checks/licences.ts";
import { forbiddenWords } from "../../scripts/checks/names.ts";
import { compare } from "../../scripts/checks/ratchets.ts";

describe("licences", () => {
	it.each(["MIT", "Apache-2.0", "(MIT OR GPL-3.0)", "MIT AND ISC", "BSD-3-Clause", "MPL-2.0"])(
		"allows %s",
		(licence) => {
			expect(licenceAllowed(licence, "some-package")).toBe(true);
		},
	);

	it.each([
		"AGPL-3.0",
		"AGPL-3.0-only",
		"GPL-2.0",
		"GPL-3.0-or-later",
		"SSPL-1.0",
		"MIT AND GPL-3.0",
		"UNLICENSED",
		"Unknown",
		"SEE LICENSE IN LICENSE",
	])("rejects %s", (licence) => {
		expect(licenceAllowed(licence, "some-package")).toBe(false);
	});

	it("accepts LGPL only for the named native tooling", () => {
		expect(licenceAllowed("LGPL-3.0-or-later", "@img/sharp-libvips-darwin-arm64")).toBe(true);
		expect(licenceAllowed("LGPL-3.0-or-later", "some-library")).toBe(false);
	});

	it("names the offending package", () => {
		expect(checkLicences({ "AGPL-3.0": [{ name: "bad-pkg" }], MIT: [{ name: "ok" }] })).toEqual([
			'bad-pkg: licence "AGPL-3.0" is not on the allow-list',
		]);
	});
});

describe("names", () => {
	const digest = (word: string) => createHash("sha256").update(word).digest("hex");

	it("finds a listed name in any casing, inside prose or code", () => {
		const digests = new Set([digest("otherproduct")]);
		expect(forbiddenWords("Inspired by OtherProduct, of course.", digests)).toEqual([
			"otherproduct",
		]);
		expect(forbiddenWords('import x from "@otherproduct/sdk";', digests)).toEqual(["otherproduct"]);
	});

	it("does not flag ordinary text", () => {
		expect(
			forbiddenWords("Podbay is an original work.", new Set([digest("otherproduct")])),
		).toEqual([]);
	});
});

describe("imports", () => {
	it("rejects a Node-only import in Worker code", () => {
		expect(
			importProblems("workers/lib/x.ts", 'import { readFileSync } from "node:fs";'),
		).toHaveLength(1);
	});

	it("rejects the UI importing the Worker and the Worker importing the UI", () => {
		expect(importProblems("app/x.tsx", 'import { a } from "../workers/lib/a";')).toHaveLength(1);
		expect(importProblems("workers/x.ts", 'import { a } from "~/components/A";')).toHaveLength(1);
	});

	it("rejects shipped code importing tests or tooling", () => {
		expect(importProblems("workers/x.ts", 'import { a } from "../test/helpers";')).toHaveLength(1);
	});

	it("accepts shared code and package imports", () => {
		expect(
			importProblems(
				"app/x.tsx",
				'import { Folders } from "shared/folders";\nimport { z } from "zod";',
			),
		).toEqual([]);
		expect(
			importProblems(
				"workers/x.ts",
				'import { Folders } from "../shared/folders";\nawait import("postal-mime");',
			),
		).toEqual([]);
	});
});

describe("ratchets", () => {
	const base = { lintWarnings: 10, consoleCalls: 5, oversizedFiles: { "a.ts": 900 } };

	it("passes when nothing moved", () => {
		expect(compare(base, base)).toEqual([]);
	});

	it("fails when a number grows", () => {
		expect(compare(base, { ...base, lintWarnings: 11 })).toHaveLength(1);
		expect(compare(base, { ...base, consoleCalls: 6 })).toHaveLength(1);
	});

	it("asks for a lower baseline when a number shrinks", () => {
		expect(compare(base, { ...base, lintWarnings: 9 })[0]).toContain("lower the baseline");
	});

	it("fails on a new oversized file and on a listed one that grew", () => {
		expect(compare(base, { ...base, oversizedFiles: { "a.ts": 900, "b.ts": 801 } })).toHaveLength(
			1,
		);
		expect(compare(base, { ...base, oversizedFiles: { "a.ts": 901 } })).toHaveLength(1);
	});

	it("asks to drop a file that is no longer oversized", () => {
		expect(compare(base, { ...base, oversizedFiles: {} })[0]).toContain("no longer oversized");
	});
});
