/**
 * A tool's configuration names the version that is pinned (V1). `biome.json` names its schema
 * by version; when `@biomejs/biome` is updated and the schema line is not, every run prints a
 * note that fails nothing. This check fails instead: the version in the schema's address must
 * be the exact version `package.json` pins.
 */
import { type Check, readJson } from "./lib.ts";

const SCHEMA = /^https:\/\/biomejs\.dev\/schemas\/(\d+\.\d+\.\d+)\/schema\.json$/;

interface Manifest {
	devDependencies?: Record<string, string>;
	dependencies?: Record<string, string>;
}

/** What is wrong, given the two files as JSON. */
export function schemaProblems(biome: { $schema?: unknown }, manifest: Manifest): string[] {
	const pinned =
		manifest.devDependencies?.["@biomejs/biome"] ?? manifest.dependencies?.["@biomejs/biome"];
	if (pinned === undefined) return ["package.json: @biomejs/biome is not a dependency"];
	const schema = typeof biome.$schema === "string" ? SCHEMA.exec(biome.$schema) : null;
	if (schema === null) {
		return ['biome.json: "$schema" is not https://biomejs.dev/schemas/<version>/schema.json'];
	}
	if (schema[1] !== pinned) {
		return [
			`biome.json: the schema is ${schema[1]} and @biomejs/biome is pinned at ${pinned}; set "$schema" to ${pinned}`,
		];
	}
	return [];
}

export const check: Check = {
	name: "schemas",
	run: () => schemaProblems(readJson("biome.json"), readJson("package.json")),
};
