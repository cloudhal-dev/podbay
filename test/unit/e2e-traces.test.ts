// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Tier 0: when the browser run fails in CI, the traces of the failed tests are kept for a short
 * time and hold nothing but the throwaway instance's own data (issue #47). The repository is
 * public, so anyone may download them:
 *
 * - the upload runs only when the run failed, with GitHub's own action pinned by commit, for at
 *   most seven days, and only `test-results/`, where Playwright writes its traces;
 * - the run's secrets (`.e2e/`) are outside that directory, and only the global setup, which runs
 *   in Node and not in a traced page, reads them.
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { E2E_DIR, E2E_SECRETS } from "../../scripts/e2e-server.ts";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const workflow = read(".github/workflows/checks.yml");

/** The steps of the browser job: from its key to the end of the file or the next job. */
const e2eJob = (() => {
	const start = workflow.indexOf("\n  e2e:\n");
	expect(start, "the browser job").toBeGreaterThan(0);
	const next = workflow.slice(start + 1).search(/\n {2}[a-z-]+:\n/);
	return workflow.slice(start, next === -1 ? undefined : start + 1 + next);
})();

describe("the traces of a failed browser run", () => {
	it("are uploaded only when the run failed, by GitHub's own action pinned by commit", () => {
		const step = e2eJob.slice(e2eJob.indexOf("- if: failure()"));
		expect(e2eJob.indexOf("- if: failure()"), "an upload step").toBeGreaterThan(
			e2eJob.indexOf("- run: pnpm e2e"),
		);
		expect(step).toMatch(/\n {8}uses: actions\/upload-artifact@[0-9a-f]{40} # v\d+\.\d+\.\d+\n/);
		expect(e2eJob.match(/upload-artifact/g)).toHaveLength(1);
	});

	it("are only test-results/, kept for at most seven days", () => {
		const step = e2eJob.slice(e2eJob.indexOf("- if: failure()"));
		expect(step).toMatch(/\n {10}path: test-results\/\n/);
		const days = Number(step.match(/\n {10}retention-days: (\d+)\n/)?.[1]);
		expect(days).toBeGreaterThan(0);
		expect(days).toBeLessThanOrEqual(7);
	});

	it("are where Playwright writes them, and the run's secrets are not", () => {
		expect(read("test/e2e/playwright.config.ts")).toContain('outputDir: "../../test-results"');
		expect(read("test/e2e/playwright.config.ts")).toContain('trace: "retain-on-failure"');
		expect(E2E_DIR).toBe(".e2e");
		expect(E2E_SECRETS.startsWith(`${E2E_DIR}/`)).toBe(true);
		expect(E2E_DIR.startsWith("test-results")).toBe(false);
	});

	it("never hold the run's secrets: only the global setup, in Node, reads them", () => {
		const readers = readdirSync(new URL("../e2e/", import.meta.url)).filter((name) =>
			/secrets\.json|E2E_SECRETS|setupToken/.test(read(`test/e2e/${name}`)),
		);
		expect(readers).toEqual(["global-setup.ts"]);
	});
});
