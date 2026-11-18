// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Tier 0: the dependency review of a pull request (`.github/workflows/checks.yml`, job
 * `dependency review`) allows the licences `pnpm static licences` allows, and no other; it
 * exempts the same LGPL packages of the local toolchain, every one of them in the lockfile; it
 * fails on a known vulnerability of any severity in every scope; and it needs no write access.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ALLOWED, LGPL_TOOLING } from "../../scripts/checks/licences.ts";

const workflow = readFileSync(
	new URL("../../.github/workflows/checks.yml", import.meta.url),
	"utf8",
);
const lockfile = readFileSync(new URL("../../pnpm-lock.yaml", import.meta.url), "utf8");

/** The job's text: from its key to the next job's. */
const job = (() => {
	const start = workflow.indexOf("\n  dependencies:\n");
	expect(start, "the dependency review job").toBeGreaterThan(0);
	const next = workflow.slice(start + 1).search(/\n {2}[a-z-]+:\n/);
	return workflow.slice(start, next === -1 ? undefined : start + 1 + next);
})();

/** The comma-separated list of one input of the action. */
const input = (name: string): string[] => {
	const line = job.match(new RegExp(`\\n {10}${name}: (.+)\\n`))?.[1];
	expect(line, name).toBeDefined();
	return (line ?? "").split(",").map((one) => one.trim());
};

describe("the dependency review of a pull request", () => {
	it("allows the licences the static check allows, and no other", () => {
		expect([...input("allow-licenses")].sort()).toEqual([...ALLOWED].sort());
	});

	it("exempts exactly the LGPL packages of the toolchain that the lockfile holds", () => {
		const exempt = input("allow-dependencies-licenses").map((purl) => {
			expect(purl).toMatch(/^pkg:npm\//);
			return purl.slice("pkg:npm/".length);
		});
		for (const name of exempt) expect(LGPL_TOOLING.test(name), name).toBe(true);
		const inLockfile = [
			...new Set([...lockfile.matchAll(/'?(@img\/sharp-libvips-[a-z0-9-]+)@\d/g)].map((m) => m[1])),
		];
		expect(inLockfile.length).toBeGreaterThan(0);
		expect([...exempt].sort()).toEqual(inLockfile.sort());
	});

	it("fails on a known vulnerability of any severity, in every scope", () => {
		expect(input("fail-on-severity")).toEqual(["low"]);
		expect([...input("fail-on-scopes")].sort()).toEqual(["development", "runtime", "unknown"]);
		expect(job).not.toMatch(
			/warn-only|allow-ghsas|vulnerability-check: false|license-check: false/,
		);
	});

	it("is GitHub's own action pinned by commit, on pull requests, with no write access", () => {
		expect(job).toMatch(/uses: actions\/dependency-review-action@[0-9a-f]{40} # v\d+\.\d+\.\d+\n/);
		expect(job).toContain("if: github.event_name == 'pull_request'");
		expect(input("comment-summary-in-pr")).toEqual(["never"]);
		expect(job).not.toMatch(/permissions:|write/);
		expect(workflow).not.toContain("pull_request_target");
	});
});
