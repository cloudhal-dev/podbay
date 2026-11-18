// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Tier 0: the workflow lint (`pnpm static workflows`, S16). A workflow that runs a pull
 * request's work with the repository's token, writes, uses an unpinned action or a secret,
 * names a self-hosted runner, writes an expression into a command or keeps the checkout's
 * credentials is refused; the workflows of this repository pass.
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { workflowProblems } from "../../scripts/checks/workflows.ts";

const FILE = ".github/workflows/x.yml";
const PIN = "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1";

/** A workflow that passes, with one job whose steps are `steps`. */
const workflow = (steps: string, head = "permissions:\n  contents: read\n", job = "") =>
	`name: X\non:\n  pull_request:\n${head}jobs:\n  one:\n    runs-on: ubuntu-latest\n${job}    steps:\n${steps}`;
const checkout = `      - uses: ${PIN}\n        with:\n          persist-credentials: false\n`;
const problems = (text: string) => workflowProblems(FILE, text);

describe("the workflow lint", () => {
	it("passes a workflow that keeps every rule", () => {
		expect(
			problems(
				workflow(
					`${checkout}      - run: node scripts/commits.ts "$BASE"\n        env:\n          BASE: \${{ github.event.pull_request.base.sha }}\n      - run: |\n          pnpm install\n          pnpm check\n`,
				),
			),
		).toEqual([]);
	});

	it.each([
		[
			"pull_request_target",
			workflow(checkout).replace("  pull_request:\n", "  pull_request_target:\n"),
		],
		["workflow_run", workflow(checkout).replace("  pull_request:\n", "  workflow_run:\n")],
		["no permissions block", workflow(checkout, "")],
		["a permission that writes", workflow(checkout, "permissions:\n  contents: write\n")],
		["write-all", workflow(checkout, "permissions: write-all\n")],
		[
			"a job that writes",
			workflow(checkout, undefined, "    permissions:\n      pull-requests: write\n"),
		],
		["an action by tag", workflow("      - uses: actions/checkout@v7\n")],
		["an action by branch", workflow("      - uses: someone/action@main\n")],
		[
			"a commit id without its tag",
			workflow("      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1\n"),
		],
		["a short commit id", workflow("      - uses: actions/setup-node@949feb2 # v7.1.0\n")],
		["a Docker image", workflow("      - uses: docker://alpine:3\n")],
		["a self-hosted runner", workflow(checkout).replace("ubuntu-latest", "self-hosted")],
		["a list of labels", workflow(checkout).replace("ubuntu-latest", "[self-hosted, linux]")],
		[
			"a runner from an expression",
			workflow(checkout).replace("ubuntu-latest", `\${{ matrix.os }}`),
		],
		[
			"a secret",
			workflow(
				`${checkout}      - run: echo "$T"\n        env:\n          T: \${{ secrets.TOKEN }}\n`,
			),
		],
		[
			"an expression in a command",
			workflow(`${checkout}      - run: echo \${{ github.event.pull_request.title }}\n`),
		],
		[
			"an expression in a script",
			workflow(
				`${checkout}      - run: |\n          echo start\n          echo \${{ github.head_ref }}\n`,
			),
		],
		[
			"a checkout that keeps its credentials",
			workflow(`      - uses: ${PIN}\n        with:\n          fetch-depth: 0\n`),
		],
		["a checkout with no settings", workflow(`      - uses: ${PIN}\n`)],
		["a flow mapping", workflow(checkout, "permissions: { contents: read }\n")],
	])("refuses %s", (_what, text) => {
		expect(problems(text).length, text).toBeGreaterThan(0);
	});

	it("reads a comment as a comment, and a path of the repository as reviewed with it", () => {
		expect(
			problems(
				workflow(
					`      # Never pull_request_target, never a secret, never write.\n      - uses: ./.github/actions/local\n`,
				),
			),
		).toEqual([]);
	});

	it("passes every workflow of this repository", () => {
		const dir = new URL("../../.github/workflows/", import.meta.url);
		const files = readdirSync(dir).filter((name) => /\.ya?ml$/.test(name));
		expect(files.length).toBeGreaterThan(0);
		for (const name of files) {
			const text = readFileSync(new URL(name, dir), "utf8");
			expect(workflowProblems(`.github/workflows/${name}`, text), name).toEqual([]);
		}
	});

	it("reads only workflow files", () => {
		expect(workflowProblems(".github/dependabot.yml", "on: pull_request_target\n")).toEqual([]);
	});
});
