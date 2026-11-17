// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Tier 6: the app's own words follow the language a person chooses (rule D8). The choice is
 * made in the settings, takes effect at once, and is kept with the person's account and in the
 * browser's copy (ADR-0012); mail is left as it was written.
 */
import type { Page } from "@playwright/test";
import { expect, mime, test } from "./fixtures.ts";

const row = (page: Page, subject: string) =>
	page.getByRole("button", { name: new RegExp(subject) });

test.beforeEach(async ({ page, app }) => {
	await app.signIn();
	await page.setViewportSize({ width: 1280, height: 800 });
});

test("a person chooses Turkish, and the screens, the notes and the dates follow", async ({
	page,
	app,
}) => {
	const subject = `Language ${Date.now()}: a plain message`;
	await app.deliver(mime({ subject, to: app.account.mailbox, text: "Hello there" }));
	const base = `/mailbox/${encodeURIComponent(app.account.mailbox)}`;
	await page.goto(`${base}/settings`);
	await expect(page.locator("html")).toHaveAttribute("lang", "en");

	// A click, not a check: the whole app is drawn again in the new language, so the button
	// that was pressed is not there to be looked at afterwards.
	await page.getByRole("radiogroup", { name: "Language" }).getByLabel("Türkçe").click();
	// At once, without a reload: the settings themselves and the frame around them.
	await expect(page.locator("html")).toHaveAttribute("lang", "tr");
	await expect(page.getByRole("radiogroup", { name: "Dil" })).toBeVisible();
	// The keyboard stays on the choice that was made, though everything was drawn again.
	await expect(page.getByRole("radiogroup", { name: "Dil" }).getByLabel("Türkçe")).toBeFocused();
	await expect(page.getByRole("link", { name: "Genel", exact: true })).toBeVisible();
	await expect(page.getByRole("radiogroup", { name: "Language" })).toHaveCount(0);

	// The list: places, the compose button, the search box. The message keeps its own words.
	await page.goto(`${base}/emails/inbox`);
	await expect(page.getByRole("link", { name: /Gelen Kutusu/ })).toBeVisible();
	await expect(page.getByRole("link", { name: "Gönderilenler" })).toBeVisible();
	await expect(page.getByRole("button", { name: "Oluştur", exact: true })).toBeVisible();
	await expect(page.getByPlaceholder("Postalarda ara")).toBeVisible();
	await expect(row(page, subject)).toBeVisible();

	// What was done is said in Turkish, and can be taken back.
	await row(page, subject).hover();
	await page.getByRole("button", { name: "Arşivle" }).first().click();
	await expect(page.getByText("Yazışma arşivlendi")).toBeVisible();
	await page.getByRole("button", { name: "Geri al" }).click();
	await expect(row(page, subject)).toBeVisible();

	// The open conversation, and writing an answer.
	await row(page, subject).click();
	await expect(page.getByRole("button", { name: "Yanıtla", exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Yanıtla", exact: true }).click();
	await expect(page.getByRole("button", { name: "Gönder", exact: true })).toBeVisible();

	// The choice holds from the first paint of a page loaded again.
	await page.reload();
	await expect(page.locator("html")).toHaveAttribute("lang", "tr");
	await expect(page.getByRole("link", { name: /Gelen Kutusu/ })).toBeVisible();

	// And English comes back the same way.
	await page.goto(`${base}/settings`);
	await page.getByRole("radiogroup", { name: "Dil" }).getByLabel("English").click();
	await expect(page.locator("html")).toHaveAttribute("lang", "en");
	await expect(page.getByRole("radiogroup", { name: "Language" })).toBeVisible();
	expect(app.watch.errors).toEqual([]);
});

test("a browser set to Turkish opens in Turkish without being asked", async ({
	browser,
	page,
	app,
	baseURL,
}) => {
	const context = await browser.newContext({
		baseURL,
		locale: "tr-TR",
		storageState: await page.context().storageState(),
	});
	const turkish = await context.newPage();
	await turkish.goto(`/mailbox/${encodeURIComponent(app.account.mailbox)}/emails/inbox`);
	await expect(turkish.locator("html")).toHaveAttribute("lang", "tr");
	await expect(turkish.getByRole("link", { name: /Gelen Kutusu/ })).toBeVisible();
	await context.close();
});
