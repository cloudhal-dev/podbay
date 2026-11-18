// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Tier 6: what is remembered beyond one browser (ADR-0012). A person's choices are kept with
 * their account, so a second browser of the same person has them, except the ones that belong
 * to the device. A mailbox remembers the addresses it has written to and offers them while an
 * address is typed, whatever is on screen; mail that arrives teaches it nothing.
 */
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { expect, SENT_WITHIN, test } from "./fixtures.ts";

const CHOICES = "/api/v1/me/choices";

const choice = (page: Page, group: string, option: string) =>
	page.getByRole("radiogroup", { name: group }).getByLabel(option);
const pageSize = (page: Page) => page.getByRole("combobox", { name: "Conversations on a page" });
/** What the account keeps for the person, asked as the page asks it. */
const kept = async (page: Page) =>
	((await (await page.request.get(CHOICES)).json()) as { choices: Record<string, unknown> })
		.choices;

/** A second browser of the same person: their session, and nothing else the first one kept. */
async function secondBrowser(browser: Browser, from: BrowserContext, baseURL: string | undefined) {
	const context = await browser.newContext({
		baseURL,
		storageState: { cookies: await from.cookies(), origins: [] },
	});
	const page = await context.newPage();
	await page.setViewportSize({ width: 1280, height: 800 });
	return { context, page };
}

test.beforeEach(async ({ page, app }) => {
	await app.signIn();
	await page.setViewportSize({ width: 1280, height: 800 });
});

test("a choice made in one browser is there in a second browser of the same person, and a choice of the device is not", async ({
	page,
	context,
	browser,
	baseURL,
	app,
}) => {
	const settings = `/mailbox/${encodeURIComponent(app.account.mailbox)}/settings`;
	await page.goto(settings);
	await expect(pageSize(page)).toHaveValue("25");

	// Three choices that travel, and one that belongs to this device.
	await pageSize(page).selectOption("50");
	await choice(page, "Snippets", "Subject only").check();
	await choice(page, "Appearance", "Dark").check();
	await choice(page, "Reading pane", "Beside the list, on its right").check();
	// Each takes effect at once, here.
	await expect(page.locator("html")).toHaveAttribute("data-mode", "dark");
	await expect
		.poll(() => kept(page))
		.toEqual({
			v: 1,
			pageSize: 50,
			snippets: false,
			appearance: "dark",
		});

	// The second browser starts with nothing of its own and has them after it loads.
	const other = await secondBrowser(browser, context, baseURL);
	await other.page.goto(settings);
	await expect(pageSize(other.page)).toHaveValue("50");
	await expect(choice(other.page, "Snippets", "Subject only")).toBeChecked();
	await expect(choice(other.page, "Appearance", "Dark")).toBeChecked();
	await expect(other.page.locator("html")).toHaveAttribute("data-mode", "dark");
	// The reading pane is this device's: the second browser has its own, the default.
	await expect(choice(other.page, "Reading pane", "In place of the list")).toBeChecked();
	await expect(choice(page, "Reading pane", "Beside the list, on its right")).toBeChecked();

	// A change in the second browser reaches the first when it loads again; from then on the
	// first paint has it, before the account is asked.
	await choice(other.page, "Appearance", "Light").check();
	await pageSize(other.page).selectOption("100");
	await expect.poll(async () => (await kept(other.page)).pageSize).toBe(100);
	await page.reload();
	await expect(pageSize(page)).toHaveValue("100");
	await expect(page.locator("html")).toHaveAttribute("data-mode", "light");
	// Its own reading pane is still its own.
	await expect(choice(page, "Reading pane", "Beside the list, on its right")).toBeChecked();
	let asked = 0;
	const held: Promise<void>[] = [];
	await page.route(`**${CHOICES}`, (route) => {
		asked += 1;
		const answered = new Promise((resolve) => setTimeout(resolve, 1500)).then(() =>
			route.continue(),
		);
		held.push(answered);
		return answered;
	});
	await page.reload();
	await expect(pageSize(page)).toHaveValue("100");
	await expect(page.locator("html")).toHaveAttribute("data-mode", "light");
	await expect.poll(() => asked).toBeGreaterThan(0);
	// A request this handler still holds is let through by the browser when the handler is taken
	// away, and the handler's own answer then fails: wait for what it holds first.
	await Promise.all(held);
	await page.unroute(`**${CHOICES}`);

	// A change that cannot be sent stays in force in that browser and goes at the next contact.
	await other.page.route(`**${CHOICES}`, (route) =>
		route.request().method() === "PUT" ? route.abort() : route.continue(),
	);
	await choice(other.page, "Send and archive", "Show the button").check();
	await expect(choice(other.page, "Send and archive", "Show the button")).toBeChecked();
	await other.page.waitForTimeout(300);
	expect((await kept(page)).sendAndArchive).toBeUndefined();
	await other.page.unroute(`**${CHOICES}`);
	await other.page.reload();
	await expect(choice(other.page, "Send and archive", "Show the button")).toBeChecked();
	await expect.poll(async () => (await kept(page)).sendAndArchive).toBe(true);

	await other.context.close();
	expect(app.watch.errors).toEqual([]);
});

test("an address a message was sent to is offered when writing later, whatever is on screen, can be forgotten, and a sender never written to is not offered by the mailbox", async ({
	page,
	app,
}) => {
	const stamp = Date.now();
	const written = `nilufer-${stamp}@written.test`;
	const stranger = `stranger-${stamp}@never.test`;
	const base = `/mailbox/${encodeURIComponent(app.account.mailbox)}`;
	const known = async (typed: string) =>
		(
			(await (
				await page.request.get(
					`/api/v1/mailboxes/${encodeURIComponent(app.account.mailbox)}/known-addresses?q=${encodeURIComponent(typed)}`,
				)
			).json()) as { addresses: { address: string }[] }
		).addresses.map((one) => one.address);

	// Mail arrives from someone the mailbox never wrote to, with more addresses in its header.
	await app.deliver(
		[
			`From: A Stranger <${stranger}>`,
			`To: ${app.account.mailbox}`,
			`Cc: stranger-copied-${stamp}@never.test`,
			`Reply-To: stranger-reply-${stamp}@never.test`,
			`Subject: Remembered ${stamp}: from a stranger`,
			`Message-ID: <remembered-${stamp}@never.test>`,
			"MIME-Version: 1.0",
			"Content-Type: text/plain; charset=utf-8",
			"",
			"Hello",
			"",
		].join("\r\n"),
	);
	await page.goto(`${base}/emails/inbox`);
	await expect(
		page.getByRole("button", { name: new RegExp(`Remembered ${stamp}: from a stranger`) }),
	).toBeVisible();

	// A person writes to an address for the first time. Nothing offers it yet.
	await page.getByRole("button", { name: "Compose" }).click();
	const compose = page.getByRole("region", { name: "Compose" });
	const to = compose.getByRole("combobox", { name: "To" });
	const offered = compose.getByRole("listbox", { name: "Addresses" });
	await to.pressSequentially(`nilufer-${stamp}`);
	await expect(offered).toHaveCount(0);
	expect(await known(`nilufer-${stamp}`)).toEqual([]);
	await to.pressSequentially("@written.test");
	await compose.getByLabel("Subject").fill(`Remembered ${stamp}: the first message`);
	await compose.locator(".ProseMirror").click();
	await page.keyboard.type("Hello.");
	await compose.getByRole("button", { name: "Send", exact: true }).click();
	await expect(page.getByText("Message sent")).toBeVisible(SENT_WITHIN);

	// The mailbox remembers whom it wrote to, and not who wrote to it.
	expect(await known(`nilufer-${stamp}`)).toEqual([written]);
	for (const typed of [`stranger-${stamp}`, "never.test", `stranger-copied-${stamp}`]) {
		expect(await known(typed), typed).toEqual([]);
	}

	// Later, in a page loaded anew that shows no list with the address in it: the settings.
	await page.goto(`${base}/settings`);
	await page.reload();
	await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
	await page.getByRole("button", { name: "Compose" }).click();
	await to.pressSequentially("nilu");
	const suggestion = offered.getByRole("option", { name: written });
	await expect(suggestion).toBeVisible();
	// It is the mailbox's own: it can be forgotten from here. Enter takes it and sends nothing.
	await expect(suggestion.getByRole("button", { name: `Forget ${written}` })).toBeVisible();
	await to.press("Enter");
	await expect(compose.getByRole("button", { name: `Remove ${written}` })).toBeVisible();
	await expect(page.getByText("Message sent")).toHaveCount(0);

	// The stranger is offered by nothing here: the mailbox never wrote to them, and no list on
	// screen shows them.
	await to.pressSequentially(`stranger-${stamp}`);
	await page.waitForTimeout(500);
	await expect(offered).toHaveCount(0);
	await compose.getByRole("button", { name: "Discard" }).click();

	// A person has the mailbox forget the address from its suggestion.
	await page.getByRole("button", { name: "Compose" }).click();
	await to.pressSequentially("nilu");
	await expect(suggestion).toBeVisible();
	await suggestion.getByRole("button", { name: `Forget ${written}` }).click();
	await expect(offered).toHaveCount(0);
	await expect.poll(() => known(`nilufer-${stamp}`)).toEqual([]);
	await compose.getByRole("button", { name: "Discard" }).click();

	// Writing to it again makes it known again; an owner then has the mailbox forget them all,
	// after the app asked in its own dialog.
	await page.getByRole("button", { name: "Compose" }).click();
	await to.fill(written);
	await compose.getByLabel("Subject").fill(`Remembered ${stamp}: the second message`);
	await compose.locator(".ProseMirror").click();
	await page.keyboard.type("Hello again.");
	await compose.getByRole("button", { name: "Send", exact: true }).click();
	await expect(page.getByText("Message sent")).toBeVisible(SENT_WITHIN);
	expect(await known(`nilufer-${stamp}`)).toEqual([written]);

	await page.goto(`${base}/settings?tab=mailbox`);
	await page.getByRole("button", { name: "Forget all addresses" }).click();
	const asking = page.getByRole("alertdialog", { name: "Forget all addresses?" });
	await expect(asking).toContainText("No mail is deleted");
	await asking.getByRole("button", { name: "Cancel" }).click();
	await expect(asking).toHaveCount(0);
	expect(await known(`nilufer-${stamp}`)).toEqual([written]);
	await page.getByRole("button", { name: "Forget all addresses" }).click();
	await asking.getByRole("button", { name: "Forget all addresses" }).click();
	await expect(page.getByText("The addresses are forgotten")).toBeVisible();
	expect(await known(`nilufer-${stamp}`)).toEqual([]);
	expect(await known("written.test")).toEqual([]);

	expect(await app.contacted()).toEqual([]);
	expect(app.watch.errors).toEqual([]);
	expect(app.watch.dialogs).toEqual([]);
});
