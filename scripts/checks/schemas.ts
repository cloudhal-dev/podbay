/**
 * A tool's configuration names the version that is pinned (V1). `biome.json` names its schema
 * by version; when `@biomejs/biome` is updated and the schema line is not, every run prints a
 * note that fails nothing. This check fails instead: the version in the schema's address must
 * be the exact version the workspace's catalog pins. And a domain of Biome's rules that a catalog
 * entry would have turned on is named in biome.json (ADR-0018, step 1).
 */
import { readAll } from "../pins.ts";
import { type Check, readJson } from "./lib.ts";

const SCHEMA = /^https:\/\/biomejs\.dev\/schemas\/(\d+\.\d+\.\d+)\/schema\.json$/;

/**
 * Biome turns a domain of rules on by itself when a dependency is declared with a version at
 * least this (biomejs.dev/linter/domains, read 2026-11-19). A dependency named as `catalog:`
 * carries no version, so in this workspace no domain turns on by itself: biome.json names every
 * one the catalog would have turned on, or its rules stop without a word.
 */
export const DOMAIN_TRIGGERS: Readonly<Record<string, readonly (readonly [string, string])[]>> = {
	astro: [["astro", "1.0.0"]],
	drizzle: [["drizzle-orm", "0.9.0"]],
	next: [["next", "14.0.0"]],
	playwright: [["@playwright/test", "1.0.0"]],
	qwik: [
		["@builder.io/qwik", "1.0.0"],
		["@qwik.dev/core", "2.0.0"],
	],
	react: [["react", "16.0.0"]],
	reactNative: [["react-native", "0.60.0"]],
	solid: [["solid", "1.0.0"]],
	svelte: [["svelte", "3.0.0"]],
	tailwind: [["tailwindcss", "4.0.0"]],
	tanstackQuery: [
		["@tanstack/react-query", "4.0.0"],
		["@tanstack/preact-query", "5.0.0"],
		["@tanstack/solid-query", "4.0.0"],
		["@tanstack/svelte-query", "4.0.0"],
		["@tanstack/vue-query", "4.0.0"],
	],
	test: [
		["jest", "26.0.0"],
		["mocha", "8.0.0"],
		["ava", "2.0.0"],
		["vitest", "1.0.0"],
	],
	turborepo: [["turbo", "1.0.0"]],
	vue: [["vue", "3.0.0"]],
};

const atLeast = (version: string, floor: string) => {
	const a = version.split(".").map(Number);
	const b = floor.split(".").map(Number);
	for (let i = 0; i < 3; i++) {
		if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
	}
	return true;
};

interface Biome {
	$schema?: unknown;
	linter?: { domains?: Record<string, unknown> };
}

/** What is wrong, given biome.json and the catalog of the workspace. */
export function schemaProblems(biome: Biome, catalog: Readonly<Record<string, string>>): string[] {
	const problems: string[] = [];
	const pinned = catalog["@biomejs/biome"];
	if (pinned === undefined) return ["pnpm-workspace.yaml: @biomejs/biome is not in the catalog"];
	const schema = typeof biome.$schema === "string" ? SCHEMA.exec(biome.$schema) : null;
	if (schema === null) {
		problems.push('biome.json: "$schema" is not https://biomejs.dev/schemas/<version>/schema.json');
	} else if (schema[1] !== pinned) {
		problems.push(
			`biome.json: the schema is ${schema[1]} and @biomejs/biome is pinned at ${pinned}; set "$schema" to ${pinned}`,
		);
	}
	const named = biome.linter?.domains ?? {};
	for (const [domain, triggers] of Object.entries(DOMAIN_TRIGGERS)) {
		const by = triggers.find(([name, floor]) => {
			const version = catalog[name];
			return version !== undefined && atLeast(version, floor);
		});
		if (by && !(domain in named)) {
			problems.push(
				`biome.json: the catalog has ${by[0]}, which turns Biome's "${domain}" rules on; name it under linter.domains, as a catalog entry turns nothing on by itself`,
			);
		}
	}
	return problems;
}

export const check: Check = {
	name: "schemas",
	run() {
		const read = readAll();
		if ("problems" in read) return read.problems;
		return schemaProblems(readJson("biome.json"), read.workspace.catalog);
	},
};
