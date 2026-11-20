import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hostProblems } from "../../scripts/checks/hosts.ts";
import {
	authImports,
	debtProblems,
	importProblems,
	type World,
} from "../../scripts/checks/imports.ts";
import { checkLicences, licenceAllowed } from "../../scripts/checks/licences.ts";
import { forbiddenWords } from "../../scripts/checks/names.ts";
import { compare } from "../../scripts/checks/ratchets.ts";

/** A repository of three packages, one of them with a dependency, and two modules. */
const WORLD: World = {
	manifest(root) {
		const exports = { "./worker": "", "./app": "", "./shared": "" };
		const manifests: Record<string, NonNullable<ReturnType<World["manifest"]>>> = {
			"packages/platform": {},
			"packages/i18n": {},
			"packages/ui": { dependencies: { react: "catalog:" } },
			"modules/mail": {
				exports,
				dependencies: { zod: "catalog:", "@cloudflare/kumo": "catalog:" },
			},
			"modules/calendar": { exports },
		};
		return manifests[root] ?? null;
	},
};
const imports = (file: string, spec: string) =>
	importProblems(file, `import { a } from "${spec}";`, WORLD);

describe("what a package or a module may import, from its own path and manifest", () => {
	it("lets a package import its own files, other packages and what it declares, and nothing else", () => {
		const file = "packages/ui/src/x.ts";
		for (const spec of [
			"./y",
			"../index.ts",
			"@podbay/platform/log",
			"react",
			"react/jsx-runtime",
		]) {
			expect(imports(file, spec), spec).toEqual([]);
		}
		for (const spec of [
			"../../platform/log.ts", // another package, by path
			"../../../shared/folders", // product code, by path
			"../../../workers/lib/a",
			"../../../app/lib/a",
			"shared/folders", // product code, by alias
			"~/components/A",
			"zod", // not declared here
			"@podbay/mail/shared", // a module
			"@podbay/nothing",
			"node:fs",
			"cloudflare:workers",
		]) {
			expect(imports(file, spec), spec).not.toEqual([]);
		}
		// A package that declares nothing imports nothing but packages.
		expect(imports("packages/platform/log.ts", "react")).not.toEqual([]);
	});

	it("lets each side of a module import itself and its shared code, packages, and what it declares", () => {
		expect(imports("modules/mail/worker/a.ts", "./b")).toEqual([]);
		expect(imports("modules/mail/worker/routes/a.ts", "../../shared/rules")).toEqual([]);
		expect(imports("modules/mail/app/a.tsx", "../shared/rules")).toEqual([]);
		expect(imports("modules/mail/shared/a.ts", "./b")).toEqual([]);
		expect(imports("modules/mail/worker/a.ts", "zod")).toEqual([]);
		expect(imports("modules/mail/app/a.tsx", "@cloudflare/kumo")).toEqual([]);
		expect(imports("modules/mail/worker/a.ts", "@podbay/i18n/dates")).toEqual([]);
		expect(imports("modules/mail/worker/a.ts", "cloudflare:workers")).toEqual([]);

		// One side never reaches the other, and shared reaches neither.
		expect(imports("modules/mail/worker/a.ts", "../app/screen")).not.toEqual([]);
		expect(imports("modules/mail/app/a.tsx", "../worker/route")).not.toEqual([]);
		expect(imports("modules/mail/shared/a.ts", "../worker/route")).not.toEqual([]);
		expect(imports("modules/mail/shared/a.ts", "../app/screen")).not.toEqual([]);
		// Nor the shell, nor another module, by path; nor a dependency it does not declare.
		expect(imports("modules/mail/app/a.tsx", "../../../app/components/Confirm")).not.toEqual([]);
		expect(imports("modules/mail/worker/a.ts", "../../calendar/worker/x")).not.toEqual([]);
		expect(imports("modules/mail/app/a.tsx", "react-dom")).not.toEqual([]);
		expect(imports("modules/mail/app/a.tsx", "cloudflare:workers")).not.toEqual([]);
		expect(imports("modules/mail/app/a.tsx", "~/i18n")).not.toEqual([]);
	});

	it("lets a module take another only by an entry it exports for its side, and never itself by name", () => {
		expect(imports("modules/calendar/worker/a.ts", "@podbay/mail/worker")).toEqual([]);
		expect(imports("modules/calendar/worker/a.ts", "@podbay/mail/shared")).toEqual([]);
		expect(imports("modules/calendar/app/a.tsx", "@podbay/mail/app")).toEqual([]);
		expect(imports("modules/calendar/app/a.tsx", "@podbay/mail/worker")).not.toEqual([]);
		expect(imports("modules/calendar/shared/a.ts", "@podbay/mail/app")).not.toEqual([]);
		expect(imports("modules/calendar/worker/a.ts", "@podbay/mail/worker/routes")).not.toEqual([]);
		expect(imports("modules/mail/worker/a.ts", "@podbay/mail/shared")).not.toEqual([]);
	});

	it("lets the shell reach a module only by an entry it exports", () => {
		expect(imports("workers/app.ts", "@podbay/mail/worker")).toEqual([]);
		expect(imports("app/router.tsx", "@podbay/mail/app")).toEqual([]);
		expect(imports("workers/app.ts", "../modules/mail/worker/index.ts")).not.toEqual([]);
		expect(imports("app/router.tsx", "@podbay/mail/app/routes/inbox")).not.toEqual([]);
	});

	it("lets a module's Worker side import the shell's sign-in and access code only as a counted debt", () => {
		// By path from the Worker side it is not refused file by file; it is counted.
		expect(
			imports("modules/mail/worker/routes/a.ts", "../../../../workers/auth/middleware"),
		).toEqual([]);
		expect(imports("modules/mail/app/a.tsx", "../../../workers/auth/middleware")).not.toEqual([]);
		const files: [string, string][] = [
			[
				"modules/mail/worker/a.ts",
				'import { a } from "../../../workers/auth/store";\nimport { b } from "../../../workers/auth/store.ts";',
			],
			["modules/mail/worker/routes/b.ts", 'import { a } from "../../../../workers/auth/store";'],
			["modules/mail/worker/c.ts", 'import { g } from "../../../workers/auth/middleware";'],
			["workers/app.ts", 'import { a } from "./auth/store";'],
		];
		const counts = authImports(files);
		expect(Object.fromEntries(counts)).toEqual({
			"workers/auth/store.ts": 2,
			"workers/auth/middleware.ts": 1,
		});
		const debt = { "workers/auth/store.ts": 2, "workers/auth/middleware.ts": 1 };
		expect(debtProblems(counts, debt)).toEqual([]);
		// A count above the debt, a file not on it, and a count below it are each refused.
		expect(debtProblems(new Map([...counts, ["workers/auth/store.ts", 3]]), debt)).toHaveLength(1);
		expect(debtProblems(new Map([...counts, ["workers/auth/keys.ts", 1]]), debt)).toHaveLength(1);
		expect(debtProblems(new Map([["workers/auth/store.ts", 2]]), debt)).toHaveLength(1);
	});
});

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

	it("lets only the app's entry for words take them from the runtime", () => {
		const screen = "app/components/A.tsx";
		expect(importProblems(screen, 'import { t } from "@podbay/i18n";')).toHaveLength(1);
		expect(
			importProblems(screen, 'import { t } from "../../packages/i18n/index.ts";'),
		).toHaveLength(1);
		expect(importProblems(screen, 'import { t } from "~/i18n";')).toEqual([]);
		expect(importProblems(screen, 'import { formatListDate } from "@podbay/i18n/dates";')).toEqual(
			[],
		);
		expect(
			importProblems("app/i18n/index.ts", 'import { addCatalog } from "@podbay/i18n";'),
		).toEqual([]);
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

describe("hosts", () => {
	it("rejects a cloudhal.com host in a deployment configuration", () => {
		const config = '{ "routes": [{ "pattern": "podbay.cloudhal.com", "custom_domain": true }] }';
		expect(hostProblems("wrangler.jsonc", config)).toEqual([
			"wrangler.jsonc: names podbay.cloudhal.com; nothing runs under cloudhal.com (ADR-0003)",
		]);
		expect(hostProblems("wrangler.production.jsonc", '"pattern": "cloudhal.com/*"')).toHaveLength(
			1,
		);
	});

	it("rejects one in a workflow", () => {
		expect(
			hostProblems(".github/workflows/deploy.yml", "url: https://Mail.CloudHal.com"),
		).toHaveLength(1);
	});

	it("accepts cloudhal.dev and look-alike hosts", () => {
		const config =
			'"pattern": "podbay.cloudhal.dev", "other": "notcloudhal.com", "x": "cloudhal.com.example.org"';
		expect(hostProblems("wrangler.jsonc", config)).toEqual([]);
	});

	it("does not scan documents or contact addresses", () => {
		expect(hostProblems("SECURITY.md", "email security@cloudhal.com")).toEqual([]);
		expect(hostProblems("docs/adr/0003.md", "nothing runs under cloudhal.com")).toEqual([]);
	});
});
