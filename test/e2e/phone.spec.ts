// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Tier 6: the writing window as a phone shows it (#52). Its actions hold in any language: the
 * longest words the app has must not push one of them off the screen, where nothing reaches it.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

const WIDTH = 375;

async function chooseLanguage(page: Page, base: string, group: string, name: string) {
	await page.goto(`${base}/settings`);
	await page
		.getByRole("radiogroup", { name: group })
		.getByRole("radio", { name, exact: true })
		.click();
}

test("on a phone in Turkish every action under the text is in reach, and Delete keeps its place when a draft is saved", async ({
	page,
	app,
}) => {
	await page.setViewportSize({ width: WIDTH, height: 812 });
	await app.signIn();
	const base = `/mailbox/${encodeURIComponent(app.account.mailbox)}`;
	await chooseLanguage(page, base, "Language", "Türkçe");
	await expect(page.locator("html")).toHaveAttribute("lang", "tr");
	try {
		await page.goto(`${base}/emails/inbox`);
		await expect(page.getByPlaceholder("Postalarda ara")).toBeVisible();
		// On a phone the rail with its button is closed; the key opens the writing window.
		await page.keyboard.press("c");
		const compose = page.getByRole("region", { name: "Oluştur" });
		await expect(compose).toBeVisible();
		const del = compose.getByRole("button", { name: "Sil", exact: true });
		// Where Delete is, how tall the bar is, and which action ends the row.
		const place = () =>
			del.evaluate((button) => {
				const bar = button.closest(".border-t") as HTMLElement;
				const actions = [...bar.querySelectorAll("button")].map((one) =>
					one.getBoundingClientRect(),
				);
				const own = button.getBoundingClientRect();
				return {
					x: own.x,
					y: own.y,
					right: own.right,
					barHeight: bar.getBoundingClientRect().height,
					rightmost: Math.max(...actions.map((one) => one.right)),
				};
			});
		const before = await place();

		// A saved draft adds its note to the row, the longest the row gets.
		await compose.getByRole("textbox", { name: "Konu" }).fill("Telefon");
		await compose.getByRole("button", { name: "Taslağı kaydet", exact: true }).click();
		await expect(compose.getByText("Kaydedildi", { exact: true })).toBeVisible();
		const after = await place();

		expect(after, "Delete keeps its place and the bar its height when the note comes").toEqual(
			before,
		);
		expect(after.right, "Delete ends the row").toBe(after.rightmost);
		const send = await compose.getByRole("button", { name: "Gönder", exact: true }).boundingBox();
		expect(
			after.x - ((send?.x ?? 0) + (send?.width ?? 0)),
			"Delete stands well away from Send",
		).toBeGreaterThanOrEqual(100);
		for (const name of ["Gönder", "Daha sonra gönder", "Dosya ekle", "Taslağı kaydet", "Sil"]) {
			const action = compose.getByRole("button", { name, exact: true });
			await expect(action, name).toBeVisible();
			const box = await action.boundingBox();
			expect(box?.x ?? -1, `${name} begins inside the screen`).toBeGreaterThanOrEqual(0);
			expect(
				(box?.x ?? 0) + (box?.width ?? 0),
				`${name} ends inside the screen`,
			).toBeLessThanOrEqual(WIDTH);
		}
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			WIDTH,
		);
	} finally {
		await chooseLanguage(page, base, "Dil", "English");
		await expect(page.locator("html")).toHaveAttribute("lang", "en");
	}
});
