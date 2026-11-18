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

	it("reads a comment as a comment", () => {
		expect(
			problems(
				workflow(`      # Never pull_request_target, never a secret, never write.\n${checkout}`),
			),
		).toEqual([]);
	});

	// The second audit (#76): each of these is valid YAML that GitHub runs.
	it.each([
		["A: a quoted key", workflow(checkout, undefined, '    "runs-on": self-hosted\n')],
		[
			"A: a quoted key in a list item",
			workflow(`${checkout}      - 'uses': someone/action@main\n`),
		],
		[
			"A: a space before the colon",
			workflow(`${checkout}      - run : echo \${{ github.event.pull_request.title }}\n`),
		],
		[
			"B: a permission that writes, with a comment",
			workflow(checkout, "permissions:\n  contents: write # for the release\n"),
		],
		[
			"B: a permission that writes, quoted",
			workflow(checkout, 'permissions:\n  id-token: "write"\n'),
		],
		[
			"C: a secret by its name in brackets",
			workflow(
				`${checkout}      - run: echo "$T"\n        env:\n          T: \${{ secrets['NAME'] }}\n`,
			),
		],
		[
			"C: every secret at once",
			workflow(
				`${checkout}      - run: echo "$T"\n        env:\n          T: \${{ toJSON(secrets) }}\n`,
			),
		],
		[
			"C: a secret inside a script",
			workflow(`${checkout}      - run: |\n          echo \${{ secrets.TOKEN }}\n`),
		],
		[
			"D: a command that goes on to the next line",
			workflow(
				`${checkout}      - run: echo building\n          \${{ github.event.pull_request.title }}\n`,
			),
		],
		[
			"D: a quoted value that goes on",
			workflow(`${checkout}      - run: "echo building\n          more"\n`),
		],
		[
			"E: an action of a path of the repository",
			workflow(`${checkout}      - uses: ./.github/actions/x\n`),
		],
		[
			"E: a container",
			workflow(checkout, undefined, "    runs-on: ubuntu-latest\n    container: node:24\n"),
		],
		[
			"E: services",
			workflow(
				checkout,
				undefined,
				"    runs-on: ubuntu-latest\n    services:\n      db:\n        image: postgres\n",
			),
		],
		[
			"a runner GitHub hosts but this repository does not use",
			workflow(checkout).replace("ubuntu-latest", "ubuntu-anything"),
		],
		["an anchor", workflow(checkout, "permissions: &read\n  contents: read\n")],
		["an alias", workflow(`${checkout}      - with: *defaults\n`)],
		["a tab", workflow(checkout).replace("    runs-on", "\truns-on")],
	])("refuses %s", (_what, text) => {
		expect(problems(text).length, text).toBeGreaterThan(0);
	});

	it.each([
		["F: && in a command", workflow(`${checkout}      - run: pnpm build && pnpm test\n`)],
		[
			"F: * in a quoted cron",
			workflow(checkout).replace(
				"  pull_request:\n",
				'  pull_request:\n  schedule:\n    - cron: "0 3 * * 1"\n',
			),
		],
		[
			"F: & and * in a script",
			workflow(`${checkout}      - run: |\n          ls *.ts && echo done\n`),
		],
		[
			"G: a checkout whose step starts with its name",
			workflow(
				`      - name: Check out\n        uses: ${PIN}\n        with:\n          persist-credentials: false\n`,
			),
		],
		[
			"G: a comment after false",
			workflow(
				`      - uses: ${PIN}\n        with:\n          persist-credentials: false # never kept\n`,
			),
		],
		[
			"G: a comment after the runner",
			workflow(checkout, undefined, "    runs-on: ubuntu-latest # GitHub's\n"),
		],
		["a block of no permissions", workflow(checkout, "permissions: {}\n")],
	])("passes %s", (_what, text) => {
		expect(problems(text), text).toEqual([]);
	});

	it("finds a checkout's settings in its own step and not in the next one", () => {
		const text = workflow(
			`      - name: Check out\n        uses: ${PIN}\n      - name: Other\n        uses: ${PIN.replace("checkout", "setup-node")}\n        with:\n          persist-credentials: false\n`,
		);
		expect(problems(text)).toEqual([`${FILE}:10: a checkout without persist-credentials: false`]);
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
