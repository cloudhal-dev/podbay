// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Tier 6: a settings form never writes what it loaded over what the person typed (#124). The
 * stored values are asked for when the form opens and again after a save; whenever they arrive,
 * what the person typed stays. These tests hold the answer back until the person has typed.
 */
import type { Page, Route } from "@playwright/test";
import { expect, makeMailbox, test } from "./fixtures.ts";

const MAILBOX = "forms@example.com";
const box = encodeURIComponent(MAILBOX);
const settings = (tab: string) => `/mailbox/${box}/settings?tab=${tab}`;

test.beforeEach(async ({ page, app }) => {
	await page.setViewportSize({ width: 1280, height: 800 });
	await app.signIn();
	await makeMailbox(page, MAILBOX, "Forms");
});

/** Holds the GETs of one address from the given one on (counted from 1), until let go. */
async function holdReads(page: Page, path: RegExp, from: number) {
	let release = () => {};
	const held = new Promise<void>((resolve) => {
		release = resolve;
	});
	let reads = 0;
	await page.route(path, async (route: Route) => {
		if (route.request().method() !== "GET") return route.fallback();
		reads += 1;
		if (reads >= from) await held;
		await route.continue().catch(() => {});
	});
	return { release, reads: () => reads };
}

test("the automatic reply cannot be typed into before its stored values arrive", async ({
	page,
}) => {
	const reads = await holdReads(page, /\/api\/v1\/mailboxes\/[^/]+\/auto-reply$/, 1);
	await page.goto(settings("auto-reply"));
	await expect.poll(() => reads.reads()).toBeGreaterThan(0);
	// While the stored reply is on its way, nothing can be typed that it would then replace.
	const on = page.getByRole("checkbox", { name: "Answer mail that arrives" });
	await expect(on).toBeDisabled();
	await expect(page.getByRole("textbox", { name: "Message" })).toBeDisabled();
	reads.release();
	await expect(on).toBeEnabled();
});

test("a name typed while it is being saved is not written over when the mailbox is read again", async ({
	page,
}) => {
	await page.goto(settings("mailbox"));
	const name = page.getByRole("textbox", { name: "Name", exact: true });
	await expect(name).toBeEnabled();
	// The save is over when the mailbox has been read again; that read is held until more has
	// been typed.
	const reads = await holdReads(page, /\/api\/v1\/mailboxes\/forms(%40|@)example\.com$/, 1);
	const saved = `Forms ${Date.now()}`;
	await name.fill(saved);
	await name.press("Enter");
	await expect.poll(() => reads.reads()).toBeGreaterThan(0);
	await name.fill(`${saved}, typed since`);
	reads.release();
	await expect(page.getByText("Name saved")).toBeVisible();
	await expect(name).toHaveValue(`${saved}, typed since`);
});
