// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Tier 6: how the settings stand on the screen. Every section can be reached at every width and
 * in the longest language the app has, and the section in use is in view (#118); the forms of
 * the settings use one size of control, and a form's button stands with its fields (#83).
 */
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

const settings = (page: Page, mailbox: string, tab: string) =>
	page.goto(`/mailbox/${encodeURIComponent(mailbox)}/settings?tab=${tab}`);

/** Whether the whole of `inner` is inside what `outer` shows. */
async function inside(inner: Locator, outer: Locator): Promise<boolean> {
	const [a, b] = await Promise.all([inner.boundingBox(), outer.boundingBox()]);
	if (!a || !b) return false;
	return a.x >= b.x - 0.5 && a.x + a.width <= b.x + b.width + 0.5;
}

test("every section of the settings can be reached at every width, and the one in use is in view", async ({
	page,
	app,
}) => {
	await app.signIn();
	await page.setViewportSize({ width: 1280, height: 800 });
	// Turkish: its names make the row the longest.
	await settings(page, app.account.mailbox, "general");
	await page
		.getByRole("radiogroup", { name: "Language" })
		.getByRole("radio", { name: "Türkçe", exact: true })
		.click();
	await expect(page.locator("html")).toHaveAttribute("lang", "tr");

	let scrolled = 0;
	// A phone, a tablet, and a laptop whose column is narrower than the row.
	for (const width of [390, 768, 1024]) {
		await page.setViewportSize({ width, height: 800 });
		const row = page.getByRole("navigation", { name: "Ayarlar" }).getByRole("tablist");

		// Opened on the last section, as from a link to it: that section is in view.
		await settings(page, app.account.mailbox, "account");
		const last = row.getByRole("tab", { name: "Hesap", exact: true });
		await expect(last).toHaveAttribute("aria-selected", "true");
		await expect.poll(() => inside(last, row), `${width}: the section in use`).toBe(true);
		const overflows = await row.evaluate((list) => list.scrollWidth > list.clientWidth + 1);
		if (!overflows) continue;
		scrolled += 1;
		// The row says that it goes on, on the side where it does.
		await expect(page.getByRole("button", { name: "Önceki bölümler" })).toBeVisible();

		// Opened on the first: the row says there is more, and following that reaches the last.
		await settings(page, app.account.mailbox, "general");
		await expect(row.getByRole("tab", { name: "Genel", exact: true })).toHaveAttribute(
			"aria-selected",
			"true",
		);
		const more = page.getByRole("button", { name: "Sonraki bölümler" });
		await expect(more, `${width}: the mark that the row goes on`).toBeVisible();
		// Pressed while it is shown: the row scrolls smoothly, and the mark goes once the end is in view.
		for (let press = 0; press < 10 && (await more.count()) > 0; press++) {
			await more.click();
			await page.waitForTimeout(400);
		}
		await expect.poll(() => inside(last, row), `${width}: the last section`).toBe(true);
		await last.click();
		await expect.poll(() => new URL(page.url()).searchParams.get("tab")).toBe("account");
	}
	// The widths above are chosen so that the row does not fit at some of them.
	expect(scrolled).toBeGreaterThan(0);
});

test("the settings' forms use one size of control, and a form's button stands with its fields", async ({
	page,
	app,
}) => {
	await app.signIn();
	await page.setViewportSize({ width: 1368, height: 900 });
	const main = page.getByRole("main");
	const controls: [string, (main: Locator) => Locator][] = [
		["general", (m) => m.getByRole("combobox", { name: "Conversations on a page" })],
		["signature", (m) => m.getByRole("button", { name: "Save signature" })],
		["labels", (m) => m.getByRole("button", { name: "New label" })],
		["filters", (m) => m.getByRole("button", { name: "New filter" })],
		["filters", (m) => m.getByRole("textbox", { name: "An address or a domain" })],
		["filters", (m) => m.getByRole("button", { name: "Block" })],
		["auto-reply", (m) => m.getByRole("textbox", { name: "Subject" })],
		["auto-reply", (m) => m.getByLabel("Starts")],
		["auto-reply", (m) => m.getByRole("button", { name: "Save automatic reply" })],
		["mailbox", (m) => m.getByRole("textbox", { name: "Name" })],
		["mailbox", (m) => m.getByRole("button", { name: "Save", exact: true })],
		["mailbox", (m) => m.getByRole("button", { name: "Forget all addresses" })],
	];
	const heights = new Map<string, number>();
	for (const [tab, find] of controls) {
		await settings(page, app.account.mailbox, tab);
		const control = find(main);
		await expect(control).toBeVisible();
		const box = await control.boundingBox();
		heights.set(`${tab}: ${control}`, Math.round(box?.height ?? 0));
	}
	// One height for all of them, whichever it is.
	expect(new Set(heights.values()).size, JSON.stringify(Object.fromEntries(heights))).toBe(1);

	// A button that saves one field stands right after it, not at the far side of the column.
	for (const [tab, field, button] of [
		[
			"mailbox",
			main.getByRole("textbox", { name: "Name" }),
			main.getByRole("button", { name: "Save", exact: true }),
		],
		[
			"filters",
			main.getByRole("textbox", { name: "An address or a domain" }),
			main.getByRole("button", { name: "Block" }),
		],
	] as const) {
		await settings(page, app.account.mailbox, tab);
		const [a, b] = [await field.boundingBox(), await button.boundingBox()];
		const gap = (b?.x ?? 0) - ((a?.x ?? 0) + (a?.width ?? 0));
		expect(gap, `${tab}: the gap between the field and its button`).toBeGreaterThanOrEqual(0);
		expect(gap, `${tab}: the gap between the field and its button`).toBeLessThanOrEqual(12);
	}
});
