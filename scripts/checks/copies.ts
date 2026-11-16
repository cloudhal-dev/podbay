/**
 * S17 and the Apache-2.0 notice duty: `copies.json` lists every file that came from the seed.
 *
 * - a listed file exists, or is marked `removed`;
 * - a file whose header carries the seed's copyright is listed;
 * - a listed file that differs from the import commit is marked `modified` and, when its format
 *   allows a comment, says so near the top ("Modified by the Podbay contributors").
 *
 *   node scripts/checks/copies.ts          check
 *   node scripts/checks/copies.ts --fix    set statuses and add the notice where it is missing
 */
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { type Check, read, readJson, repoFiles } from "./lib.ts";

const SEED_HEADER = "Copyright (c) 2026 Cloudflare, Inc.";
const NOTICE = "Modified by the Podbay contributors";
const COMMENTABLE = /\.(ts|tsx|css)$/;

interface CopyEntry {
	path: string | null;
	upstream: string;
	status: "verbatim" | "modified" | "removed";
	note?: string;
}
interface CopiesFile {
	$comment: string;
	importCommit: string;
	sources: { name: string; commit: string; files: CopyEntry[] }[];
}

function seedBlob(importCommit: string, upstream: string): string | null {
	try {
		return execFileSync("git", ["show", `${importCommit}:${upstream}`], {
			encoding: "utf8",
			maxBuffer: 64 * 1024 * 1024,
			stdio: ["ignore", "pipe", "ignore"],
		});
	} catch {
		return null;
	}
}

function withNotice(text: string): string {
	const lines = text.split("\n");
	const at = lines.findIndex((l) => l.includes(SEED_HEADER));
	if (at === -1) return text;
	// Keep the seed's licence lines together; the notice goes right after them.
	let end = at;
	while (end + 1 < lines.length && /^(\/\/|\s*\*|\/\*)/.test(lines[end + 1] ?? "")) end++;
	lines.splice(end + 1, 0, `// ${NOTICE}.`);
	return lines.join("\n");
}

export function checkCopies(fix = false): string[] {
	const file = readJson<CopiesFile>("copies.json");
	const problems: string[] = [];
	const listed = new Set<string>();
	let changed = false;

	for (const source of file.sources) {
		for (const entry of source.files) {
			if (entry.path === null) {
				if (entry.status !== "removed")
					problems.push(`${entry.upstream}: no path but not "removed"`);
				continue;
			}
			listed.add(entry.path);
			if (!existsSync(entry.path)) {
				if (fix) {
					entry.path = null;
					entry.status = "removed";
					changed = true;
				} else {
					problems.push(`${entry.path}: listed in copies.json but missing (mark it removed)`);
				}
				continue;
			}
			const original = seedBlob(file.importCommit, entry.upstream);
			if (original === null) {
				problems.push(`${entry.upstream}: not found in the import commit ${file.importCommit}`);
				continue;
			}
			const current = read(entry.path);
			const modified = current !== original;
			const expected = modified ? "modified" : "verbatim";
			if (entry.status !== expected) {
				if (fix) {
					entry.status = expected;
					changed = true;
				} else {
					problems.push(`${entry.path}: status is "${entry.status}", the file is ${expected}`);
				}
			}
			if (modified && COMMENTABLE.test(entry.path) && current.includes(SEED_HEADER)) {
				if (!current.includes(NOTICE)) {
					if (fix) writeFileSync(entry.path, withNotice(current));
					else problems.push(`${entry.path}: modified seed file without the "${NOTICE}" notice`);
				}
			}
		}
	}

	for (const path of repoFiles()) {
		if (!COMMENTABLE.test(path) || listed.has(path) || !existsSync(path)) continue;
		if (read(path).split("\n", 3).join("\n").includes(SEED_HEADER)) {
			problems.push(`${path}: carries the seed's copyright header but is not in copies.json`);
		}
	}

	if (fix && changed) writeFileSync("copies.json", `${JSON.stringify(file, null, 2)}\n`);
	return problems;
}

export const check: Check = { name: "copies", run: () => checkCopies(false) };

if (import.meta.url === `file://${process.argv[1]}`) {
	const problems = checkCopies(process.argv.includes("--fix"));
	for (const p of problems) process.stderr.write(`copies: ${p}\n`);
	process.exitCode = problems.length === 0 ? 0 : 1;
}
