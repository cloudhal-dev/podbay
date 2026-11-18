// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Tier 0: once a week the checks run on main's latest commit (`.github/workflows/checks.yml`),
 * with no permission that writes, and in the concurrency group of that commit, so the weekly
 * run and the commit's push run never cancel each other.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { workflowProblems } from "../../scripts/checks/workflows.ts";

const FILE = ".github/workflows/checks.yml";
const workflow = readFileSync(new URL(`../../${FILE}`, import.meta.url), "utf8");

describe("the weekly run", () => {
	it("is a schedule of once a week, written as a quoted value", () => {
		const crons = [...workflow.matchAll(/\n {4}- cron: "([^"]+)"\n/g)].map((m) => m[1]);
		expect(crons).toEqual(["0 4 * * 1"]);
		const [minute, hour, day, month, weekday] = (crons[0] ?? "").split(" ");
		expect([minute, hour, day, month]).toEqual(["0", "4", "*", "*"]);
		expect(weekday).toMatch(/^[0-6]$/);
	});

	it("runs in the group of its commit, and only a pull request cancels", () => {
		// What GitHub reads as an expression, written here as plain text.
		const expression = (inner: string) => `$\{{ ${inner} }}`;
		expect(workflow).toContain(
			`group: checks-${expression("github.event_name == 'pull_request' && github.ref || github.sha")}`,
		);
		expect(workflow).toContain(
			`cancel-in-progress: ${expression("github.event_name == 'pull_request'")}`,
		);
	});

	it("passes the workflow lint, so it has no permission that writes", () => {
		expect(workflowProblems(FILE, workflow)).toEqual([]);
		expect(workflow).not.toMatch(/issues:\s*write/);
	});
});
