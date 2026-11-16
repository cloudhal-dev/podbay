/** Shared helpers for the static checks. Node only; never imported by the Worker or the UI. */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** Every file git tracks or would track (not ignored), relative to the repository root. */
export function repoFiles(): string[] {
	const out = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
	});
	return out.split("\n").filter((f) => f.length > 0);
}

export function read(path: string): string {
	return readFileSync(path, "utf8");
}

export function readJson<T>(path: string): T {
	return JSON.parse(read(path)) as T;
}

export interface Check {
	readonly name: string;
	/** Returns one message per problem; an empty list passes. */
	run(): string[] | Promise<string[]>;
}
