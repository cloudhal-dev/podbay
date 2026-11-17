/**
 * Runs the Workers-runtime tests (tier 3) a few files at a time.
 *
 *   node scripts/test-workerd.ts             every file of both suites
 *   node scripts/test-workerd.ts labels      only files whose name contains "labels"
 *   PODBAY_WORKERD_AT_ONCE=2 node scripts/test-workerd.ts
 *
 * Each test file runs in a Workers runtime of its own, and a runtime that is given a second
 * file exits. Started all at once, twenty and more of them take more memory than a laptop
 * has to spare: on 2026-11-17 a machine with 8 GB came to a stop under it. So the files are
 * run in groups, one group after another, and the totals are added up at the end.
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";

const SUITES = ["test/workerd", "test/workerd-agent"] as const;
const AT_ONCE = Math.max(1, Number(process.env.PODBAY_WORKERD_AT_ONCE ?? 4) || 4);
const wanted = process.argv.slice(2);

/** The count before a word in vitest's summary, as in "Tests  12 passed | 1 failed (13)". */
function counted(line: string, word: string): number {
	const found = new RegExp(`(\\d+) ${word}`).exec(line);
	return found ? Number(found[1]) : 0;
}

let files = 0;
let passed = 0;
let failed = 0;
let broken = 0;

for (const suite of SUITES) {
	const all = readdirSync(suite)
		.filter((name) => name.endsWith(".test.ts"))
		.filter((name) => wanted.length === 0 || wanted.some((part) => name.includes(part)))
		.sort()
		.map((name) => `${suite}/${name}`);
	for (let from = 0; from < all.length; from += AT_ONCE) {
		const group = all.slice(from, from + AT_ONCE);
		const run = spawnSync(
			"pnpm",
			["exec", "vitest", "run", "--config", `${suite}/vitest.config.ts`, ...group],
			{
				encoding: "utf8",
				stdio: ["inherit", "pipe", "inherit"],
				maxBuffer: 256 * 1024 * 1024,
				// Without colour, so the summary can be read as plain words.
				env: { ...process.env, NO_COLOR: "1" },
			},
		);
		process.stdout.write(run.stdout ?? "");
		const tests = (run.stdout ?? "").split("\n").find((line) => /^\s*Tests\s/.test(line)) ?? "";
		files += group.length;
		passed += counted(tests, "passed");
		failed += counted(tests, "failed");
		if (run.status !== 0) broken += 1;
	}
}

process.stdout.write(
	`\nworkerd: ${files} files, ${passed} tests passed, ${failed} failed${
		broken > 0 ? `, ${broken} group${broken === 1 ? "" : "s"} did not end well` : ""
	}\n`,
);
process.exit(broken > 0 || failed > 0 || files === 0 ? 1 : 0);
