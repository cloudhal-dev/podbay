/**
 * Debt that may only shrink (D1, D4, S7). `ratchets.json` records today's numbers; a check fails
 * when a number grows, and asks for the baseline to be lowered when it shrinks.
 *
 * - `lintWarnings`: Biome warnings (the seed's debt, listed per file in biome.json overrides)
 * - `consoleCalls`: `console.*` calls outside the log module, per directory
 * - `oversizedFiles`: files above MAX_LINES, with their line counts
 *
 *   node scripts/checks/ratchets.ts            check
 *   node scripts/checks/ratchets.ts --update   write the current numbers (only ever lower them)
 */
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { type Check, read, readJson, repoFiles } from "./lib.ts";

export const MAX_LINES = 800;
const SOURCE = /^(app|workers|shared|scripts|test)\/.*\.(ts|tsx)$/;
const CONSOLE = /\bconsole\.(log|info|warn|error|debug)\(/g;
const LOG_MODULE = "shared/log.ts";

interface Ratchets {
	lintWarnings: number;
	consoleCalls: number;
	oversizedFiles: Record<string, number>;
}

function lintWarnings(): number {
	let out: string;
	try {
		out = execFileSync("pnpm", ["exec", "biome", "check", ".", "--reporter=json"], {
			encoding: "utf8",
			maxBuffer: 128 * 1024 * 1024,
			stdio: ["ignore", "pipe", "ignore"],
		});
	} catch (error) {
		out = String((error as { stdout?: string }).stdout ?? "");
	}
	const start = out.indexOf("{");
	const report = JSON.parse(out.slice(start)) as { summary?: { warnings?: number } };
	if (typeof report.summary?.warnings !== "number") throw new Error("no Biome summary");
	return report.summary.warnings;
}

export function measure(): Ratchets {
	let consoleCalls = 0;
	const oversizedFiles: Record<string, number> = {};
	for (const path of repoFiles()) {
		if (!SOURCE.test(path) || !existsSync(path)) continue;
		const text = read(path);
		const lines = text.split("\n").length;
		if (lines > MAX_LINES) oversizedFiles[path] = lines;
		if (path !== LOG_MODULE && !path.startsWith("scripts/") && !path.startsWith("test/")) {
			consoleCalls += text.match(CONSOLE)?.length ?? 0;
		}
	}
	return { lintWarnings: lintWarnings(), consoleCalls, oversizedFiles };
}

export function compare(baseline: Ratchets, now: Ratchets): string[] {
	const problems: string[] = [];
	const number = (name: "lintWarnings" | "consoleCalls") => {
		if (now[name] > baseline[name]) {
			problems.push(`${name} grew from ${baseline[name]} to ${now[name]}`);
		} else if (now[name] < baseline[name]) {
			problems.push(`${name} shrank to ${now[name]}: lower the baseline (--update)`);
		}
	};
	number("lintWarnings");
	number("consoleCalls");
	for (const [path, lines] of Object.entries(now.oversizedFiles)) {
		const allowed = baseline.oversizedFiles[path];
		if (allowed === undefined) problems.push(`${path}: ${lines} lines, the limit is ${MAX_LINES}`);
		else if (lines > allowed) problems.push(`${path}: grew from ${allowed} to ${lines} lines`);
	}
	for (const path of Object.keys(baseline.oversizedFiles)) {
		if (!(path in now.oversizedFiles)) {
			problems.push(`${path}: no longer oversized, remove it from the baseline (--update)`);
		}
	}
	return problems;
}

export const check: Check = {
	name: "ratchets",
	run: () => compare(readJson<Ratchets>("ratchets.json"), measure()),
};

if (import.meta.url === `file://${process.argv[1]}`) {
	if (process.argv.includes("--update")) {
		writeFileSync("ratchets.json", `${JSON.stringify(measure(), null, "\t")}\n`);
	} else {
		const problems = await check.run();
		for (const p of problems) process.stderr.write(`ratchets: ${p}\n`);
		process.exitCode = problems.length === 0 ? 0 : 1;
	}
}
