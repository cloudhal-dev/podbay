// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Tier 6: a note the app shows can be read whatever else is open (#122). The writing window sits
 * at the bottom right of a wide screen, where the notes open: a note shown while it is open must
 * be above it, inside the visible page, with nothing over its words.
 */
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

/** Whether the middle of each line of the note's words is the note itself, not something over it. */
async function readable(page: Page, words: Locator): Promise<{ inside: boolean; on: string[] }> {
	const box = await words.boundingBox();
	const viewport = page.viewportSize();
	const inside =
		box !== null &&
		viewport !== null &&
		box.x >= 0 &&
		box.y >= 0 &&
		box.x + box.width <= viewport.width &&
		box.y + box.height <= viewport.height;
	const on = await words.evaluate((element) => {
		const rect = element.getBoundingClientRect();
		const points = [
			[rect.left + 2, rect.top + rect.height / 2],
			[rect.left + rect.width / 2, rect.top + rect.height / 2],
			[rect.right - 2, rect.top + rect.height / 2],
		];
		return points.map(([x, y]) => {
			const top = document.elementFromPoint(x ?? 0, y ?? 0);
			return top !== null && (element.contains(top) || top.contains(element))
				? "the note"
				: (top?.closest("section[aria-label]")?.getAttribute("aria-label") ??
						top?.tagName ??
						"nothing");
		});
	});
	return { inside, on };
}

test("a note shown while the writing window is open is above it, and its words can be read", async ({
	page,
	app,
}) => {
	await app.signIn();
	await page.setViewportSize({ width: 1368, height: 900 });
	await page.goto(`/mailbox/${encodeURIComponent(app.account.mailbox)}/emails/inbox`);
	await page.getByRole("button", { name: "Compose" }).first().click();
	const compose = page.getByRole("region", { name: "Compose" });
	await compose.getByLabel("Subject").fill("Notes: a note over the window");
	await compose.getByRole("button", { name: "Save draft" }).click();

	const words = page.getByText("Draft saved", { exact: true });
	await expect(words).toBeVisible();
	// The window is still open where the note opens.
	await expect(compose).toBeVisible();
	// The note slides into place; once there, it is inside the page with nothing over its words.
	await expect
		.poll(() => readable(page, words), { message: "the note can be read where it rests" })
		.toEqual({ inside: true, on: ["the note", "the note", "the note"] });
	await compose.getByRole("button", { name: "Discard" }).click();
});
