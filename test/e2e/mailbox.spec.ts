// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Tier 6: how a mailbox behaves as a mail client. One list, one conversation at a time, a
 * compose window that floats, a toolbar for what is selected, and the keyboard for all of it.
 * These are the behaviours a person coming from a first-class web mail client expects.
 */
import type { Page } from "@playwright/test";
import { expect, mime, test } from "./fixtures.ts";

const row = (page: Page, subject: string) =>
	page.getByRole("button", { name: new RegExp(subject) });
const select = (page: Page, subject: string) =>
	page.getByLabel(new RegExp(`Select the conversation "${subject}`));

test.beforeEach(async ({ page, app }) => {
	await app.signIn();
	await page.setViewportSize({ width: 1280, height: 800 });
});

test("a conversation opens in place of the list, and Back returns to the list", async ({
	page,
	app,
}) => {
	await app.deliver(
		mime({ subject: "Behaviour: open and back", to: app.account.mailbox, html: "<p>Body one</p>" }),
	);
	await page.goto(`/mailbox/${encodeURIComponent(app.account.mailbox)}/emails/inbox`);
	await expect(page.getByRole("heading", { name: "Inbox" })).toBeAttached();

	await row(page, "Behaviour: open and back").click();
	await expect(page.locator('iframe[title="Email content"]')).toBeVisible();
	// The list is gone, and the conversation has an address of its own.
	await expect(select(page, "Behaviour: open and back")).toHaveCount(0);
	expect(new URL(page.url()).searchParams.get("open")).toBeTruthy();

	await page.goBack();
	await expect(row(page, "Behaviour: open and back")).toBeVisible();
	expect(new URL(page.url()).searchParams.get("open")).toBeNull();

	// Reloading an open conversation shows the conversation again.
	await row(page, "Behaviour: open and back").click();
	await expect(page.locator('iframe[title="Email content"]')).toBeVisible();
	await page.reload();
	await expect(page.locator('iframe[title="Email content"]')).toBeVisible();
	await page.getByRole("button", { name: "Back to list" }).click();
	await expect(row(page, "Behaviour: open and back")).toBeVisible();
});

test("the toolbar acts on what is selected; Delete means Trash, and only Trash deletes for good", async ({
	page,
	app,
}) => {
	for (const name of ["archive me", "trash me", "keep me"]) {
		await app.deliver(mime({ subject: `Behaviour: ${name}`, to: app.account.mailbox, text: name }));
	}
	const inbox = `/mailbox/${encodeURIComponent(app.account.mailbox)}/emails/inbox`;
	await page.goto(inbox);

	await select(page, "Behaviour: archive me").check();
	await expect(page.getByText("1 selected")).toBeVisible();
	await page.getByRole("button", { name: "Archive" }).first().click();
	await expect(row(page, "Behaviour: archive me")).toHaveCount(0);

	await select(page, "Behaviour: trash me").check();
	await page.getByRole("button", { name: "Delete", exact: true }).first().click();
	await expect(row(page, "Behaviour: trash me")).toHaveCount(0);
	await expect(row(page, "Behaviour: keep me")).toBeVisible();

	await page.getByRole("link", { name: /Archive/ }).click();
	await expect(row(page, "Behaviour: archive me")).toBeVisible();

	// In Trash the message is still there; deleting it for good asks first.
	await page.getByRole("link", { name: /Trash/ }).click();
	await expect(row(page, "Behaviour: trash me")).toBeVisible();
	await select(page, "Behaviour: trash me").check();
	// The fixture refuses every dialog and writes it down.
	await page.getByRole("button", { name: "Delete forever" }).first().click();
	await expect(row(page, "Behaviour: trash me")).toBeVisible();
	expect(app.watch.dialogs.at(-1)).toContain("forever");
});

test("the keyboard drives the list, the conversation and the compose window", async ({
	page,
	app,
}) => {
	for (const name of ["first", "second"]) {
		await app.deliver(
			mime({ subject: `Behaviour: keys ${name}`, to: app.account.mailbox, text: name }),
		);
	}
	await page.goto(`/mailbox/${encodeURIComponent(app.account.mailbox)}/emails/inbox`);
	await expect(row(page, "Behaviour: keys second")).toBeVisible();

	// Newest is on top: the cursor starts there, `j` moves down, `o` opens, `u` goes back.
	await page.keyboard.press("j");
	await page.keyboard.press("k");
	await page.keyboard.press("o");
	await expect(page.locator('iframe[title="Email content"]')).toBeVisible();
	await page.keyboard.press("u");
	await expect(row(page, "Behaviour: keys second")).toBeVisible();

	// `x` selects the line the cursor is on, `s` stars it.
	await page.keyboard.press("x");
	await expect(page.getByText("1 selected")).toBeVisible();
	await page.keyboard.press("x");
	await page.keyboard.press("s");
	await expect(page.getByRole("button", { name: "Unstar" }).first()).toBeVisible();

	// `/` goes to the search box, where keys are text and not shortcuts.
	await page.keyboard.press("/");
	await expect(page.getByRole("searchbox", { name: "Search emails" })).toBeFocused();
	await page.keyboard.type("c");
	await expect(page.getByRole("region", { name: "Compose" })).toHaveCount(0);
	await page.keyboard.press("Escape");
	await page.getByRole("searchbox", { name: "Search emails" }).blur();

	// `g` then `s` goes to Starred, which lists what was starred.
	await page.keyboard.press("g");
	await page.keyboard.press("s");
	await expect(page.getByRole("heading", { name: "Starred" })).toBeAttached();
	await expect(row(page, "Behaviour: keys second")).toBeVisible();

	await page.keyboard.press("?");
	await expect(page.getByRole("dialog").getByText("Keyboard shortcuts")).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("the compose window floats over the mail, minimises, and keeps what was written", async ({
	page,
	app,
}) => {
	await app.deliver(
		mime({
			subject: "Behaviour: read while writing",
			to: app.account.mailbox,
			html: "<p>Read me</p>",
		}),
	);
	await page.goto(`/mailbox/${encodeURIComponent(app.account.mailbox)}/emails/inbox`);
	await row(page, "Behaviour: read while writing").click();
	await expect(page.locator('iframe[title="Email content"]')).toBeVisible();

	// Writing does not close what is being read.
	await page.keyboard.press("c");
	const compose = page.getByRole("region", { name: "Compose" });
	await expect(compose).toBeVisible();
	await expect(page.locator('iframe[title="Email content"]')).toBeVisible();

	await compose.getByLabel("Subject").fill("A subject that must survive");
	await page.getByRole("button", { name: "Minimise the compose window" }).click();
	await expect(compose.getByLabel("Subject")).toBeHidden();
	await page.getByRole("button", { name: "Restore the compose window" }).click();
	await expect(compose.getByLabel("Subject")).toHaveValue("A subject that must survive");

	await compose.getByRole("button", { name: "Discard" }).click();
	await expect(compose).toHaveCount(0);
	await expect(page.locator('iframe[title="Email content"]')).toBeVisible();
});

test("the rail collapses to icons and stays that way", async ({ page, app }) => {
	await page.goto(`/mailbox/${encodeURIComponent(app.account.mailbox)}/emails/inbox`);
	const rail = page.getByRole("navigation", { name: "Folders" });
	await expect(rail.getByText("Inbox")).toBeVisible();

	await page.getByRole("button", { name: "Main menu" }).click();
	await expect(rail.getByText("Inbox")).toBeHidden();
	// The folders are still links with names.
	await expect(rail.getByRole("link", { name: "Inbox" })).toBeVisible();
	await expect(page.getByRole("button", { name: "Compose" })).toBeVisible();

	await page.reload();
	await expect(rail.getByRole("link", { name: "Inbox" })).toBeVisible();
	await expect(rail.getByText("Inbox")).toBeHidden();
	await page.getByRole("button", { name: "Main menu" }).click();
	await expect(rail.getByText("Inbox")).toBeVisible();
});
