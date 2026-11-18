// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * NOT A REAL TEST, NEVER MERGED. It fails on purpose, once, to show that a failed browser run
 * in CI uploads its traces (#74). Its pull request is a draft, closed without merging.
 */
import { expect, test } from "./fixtures.ts";

test("fails on purpose, to show the trace upload of #74", async ({ page }) => {
	await page.goto("/sign-in");
	await expect(page.getByRole("heading", { name: "This heading does not exist" })).toBeVisible({
		timeout: 2_000,
	});
});
