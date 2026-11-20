// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * What mail's entries give the shell (ADR-0018, decision 2). The app takes mail's shared code
 * through one entry, so whatever that entry passes on as values is loaded by every page: a file
 * that builds a schema with the schema library is given as types only, or not at all, so the
 * library stays out of the app's bundle.
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ENTRY = "modules/mail/shared/index.ts";
const entry = readFileSync(ENTRY, "utf8");

/** The files the entry passes on as values: `export *` and `export { … }`, not `export type`. */
function valueSources(source: string): string[] {
	const sources: string[] = [];
	for (const match of source.matchAll(
		/^export\s+(type\s+)?(?:\*|\{[^}]*\})\s*from\s*"\.\/([^"]+)"/gm,
	)) {
		if (match[1]) continue;
		const names = match[0].match(/\{([^}]*)\}/)?.[1];
		// A list made only of types passes no value on.
		if (names?.split(",").every((name) => /^\s*(type\s|$)/.test(name))) continue;
		sources.push(match[2] ?? "");
	}
	return sources;
}

describe("mail's shared entry", () => {
	it("passes on, as values, no file that loads the schema library", () => {
		const loaders = valueSources(entry).filter((file) =>
			/from\s*"zod"/.test(readFileSync(`modules/mail/shared/${file}`, "utf8")),
		);
		expect(loaders).toEqual([]);
	});

	it("does not give the strict schema of the rules at all", () => {
		expect(entry).not.toMatch(/from\s*"\.\/rules-schema/);
	});

	it("is read as the test reads it: it does pass values on", () => {
		expect(valueSources(entry).length).toBeGreaterThan(10);
		expect(
			valueSources(
				'export * from "./a.ts";\nexport type * from "./b.ts";\nexport { type C, d } from "./e.ts";\nexport { type F } from "./g.ts";',
			),
		).toEqual(["a.ts", "e.ts"]);
	});
});

describe("mail's router", () => {
	it("is mounted once, by the shell's API behind its guard: only workers/index.ts takes it", () => {
		const shipped = ["workers", "app", "shared", "packages", "modules"].flatMap((root) =>
			readdirSync(root, { recursive: true, encoding: "utf8" })
				.filter((name) => /\.tsx?$/.test(name))
				.map((name) => `${root}/${name}`),
		);
		const takers = shipped.filter((file) =>
			/\{[^}]*\bapp\b[^}]*\}\s*from\s*"(@podbay\/mail\/worker|[./]*router(\.ts)?)"/.test(
				readFileSync(file, "utf8"),
			),
		);
		// The entry itself gives it on; the shell's API is the one that mounts it.
		expect(takers.sort()).toEqual(["modules/mail/worker/index.ts", "workers/index.ts"]);
	});
});
