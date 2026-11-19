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

/** The note's card: where it rests on the page. */
const cardOf = (words: Locator) =>
	words.evaluate((element) => {
		const card = element.closest('[data-kumo-part="surface"]') ?? element;
		const { left, top, right, bottom } = card.getBoundingClientRect();
		return { left, top, right, bottom };
	});

/** The controls of the window's bottom row, with where each is. */
const BOTTOM_ROW = ["Send", "Send later", "Attach files", "Save draft", "Discard"];

for (const [width, viewport] of [
	["desktop", { width: 1368, height: 900 }],
	["phone", { width: 390, height: 844 }],
] as const) {
	test(`a note shown while the writing window is open is above it, can be read, and covers none of its bottom row (${width})`, async ({
		page,
		app,
	}) => {
		await app.signIn();
		await page.setViewportSize(viewport);
		await page.goto(`/mailbox/${encodeURIComponent(app.account.mailbox)}/emails/inbox`);
		if (width === "phone") await page.getByRole("button", { name: "Main menu" }).click();
		await page.getByRole("button", { name: "Compose" }).first().click();
		const compose = page.getByRole("region", { name: "Compose" });
		await compose.getByLabel("Subject").fill(`Notes: a note over the window (${width})`);
		await compose.getByRole("button", { name: "Save draft" }).click();

		const words = page.getByText("Draft saved", { exact: true });
		await expect(words).toBeVisible();
		// The window is still open where the note opens.
		await expect(compose).toBeVisible();
		// The pointer reaches the note through its container, and holds it: a note under the pointer
		// waits to go.
		await words.hover();
		// The note slides into place; once there, it is inside the page with nothing over its words.
		await expect
			.poll(() => readable(page, words), { message: "the note can be read where it rests" })
			.toEqual({ inside: true, on: ["the note", "the note", "the note"] });

		// And where it rests it lies over none of the controls of the window's bottom row.
		const covered = async () => {
			const card = await cardOf(words);
			const under: string[] = [];
			for (const name of BOTTOM_ROW) {
				const box = await compose.getByRole("button", { name, exact: true }).boundingBox();
				if (!box) throw new Error(`${name} is not on the page`);
				const apart =
					box.x >= card.right ||
					box.x + box.width <= card.left ||
					box.y >= card.bottom ||
					box.y + box.height <= card.top;
				if (!apart) under.push(name);
			}
			return under;
		};
		await expect.poll(covered, { message: "the controls under the note" }).toEqual([]);

		// The note can still be pressed: its close button takes it away.
		// (The window's own buttons are "Save and close" and others; only the note's is "Close".)
		await page.getByRole("button", { name: "Close", exact: true }).click();
		await expect(words).toHaveCount(0);
		await compose.getByRole("button", { name: "Discard" }).click();
	});
}
