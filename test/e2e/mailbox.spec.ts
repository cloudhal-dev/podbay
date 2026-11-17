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

	// In Trash the message is still there; deleting it for good asks first, in the app's own
	// dialog and never in the browser's.
	await page.getByRole("link", { name: /Trash/ }).click();
	await expect(row(page, "Behaviour: trash me")).toBeVisible();
	await select(page, "Behaviour: trash me").check();
	await page.getByRole("button", { name: "Delete forever" }).first().click();
	const asking = page.getByRole("alertdialog");
	await expect(asking.getByText("Delete this conversation forever?")).toBeVisible();
	await asking.getByRole("button", { name: "Cancel" }).click();
	await expect(asking).toHaveCount(0);
	await expect(row(page, "Behaviour: trash me")).toBeVisible();

	await page.getByRole("button", { name: "Delete forever" }).first().click();
	await page.getByRole("alertdialog").getByRole("button", { name: "Delete forever" }).click();
	await expect(row(page, "Behaviour: trash me")).toHaveCount(0);
	expect(app.watch.dialogs).toEqual([]);
});

test("a move says what happened and can be taken back", async ({ page, app }) => {
	await app.deliver(mime({ subject: "Behaviour: undo me", to: app.account.mailbox, text: "undo" }));
	await page.goto(`/mailbox/${encodeURIComponent(app.account.mailbox)}/emails/inbox`);

	await select(page, "Behaviour: undo me").check();
	await page.getByRole("button", { name: "Archive" }).first().click();
	await expect(row(page, "Behaviour: undo me")).toHaveCount(0);
	await expect(page.getByText("Conversation archived")).toBeVisible();
	await page.getByRole("button", { name: "Undo" }).click();
	await expect(row(page, "Behaviour: undo me")).toBeVisible();

	// "Move to" files it in a folder; mail cannot be moved into Sent or Drafts.
	await select(page, "Behaviour: undo me").check();
	await page.getByRole("button", { name: "Move to" }).click();
	const menu = page.getByRole("menu");
	await expect(menu.getByRole("menuitem", { name: "Sent" })).toHaveCount(0);
	await expect(menu.getByRole("menuitem", { name: "Drafts" })).toHaveCount(0);
	await menu.getByRole("menuitem", { name: "Spam" }).click();
	await expect(row(page, "Behaviour: undo me")).toHaveCount(0);
	await page.getByRole("link", { name: /Spam/ }).click();
	await expect(row(page, "Behaviour: undo me")).toBeVisible();
});

test("the box above the list selects the page, and its menu selects by kind", async ({
	page,
	app,
}) => {
	for (const name of ["one", "two"]) {
		await app.deliver(
			mime({ subject: `Behaviour: pick ${name}`, to: app.account.mailbox, text: name }),
		);
	}
	await page.goto(`/mailbox/${encodeURIComponent(app.account.mailbox)}/emails/inbox`);
	await expect(row(page, "Behaviour: pick two")).toBeVisible();

	await page.getByRole("button", { name: "Select by kind" }).click();
	await page.getByRole("menuitem", { name: "Unread", exact: true }).click();
	await expect(select(page, "Behaviour: pick one")).toBeChecked();
	await expect(select(page, "Behaviour: pick two")).toBeChecked();

	// With unread mail selected the toolbar offers to mark it read, and then the opposite.
	await page.getByRole("button", { name: "Mark as read" }).first().click();
	await expect(page.getByRole("button", { name: "Mark as unread" }).first()).toBeVisible();
	await page.getByRole("button", { name: "Select by kind" }).click();
	await page.getByRole("menuitem", { name: "Unread", exact: true }).click();
	await expect(select(page, "Behaviour: pick one")).not.toBeChecked();
	await page.getByRole("button", { name: "Select by kind" }).click();
	await page.getByRole("menuitem", { name: "None" }).click();
	await expect(page.getByText(/selected$/)).toHaveCount(0);
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

	// Closing keeps what was written as a draft; Discard throws it away.
	await page.getByRole("button", { name: "Save and close" }).click();
	await expect(compose).toHaveCount(0);
	await expect(page.getByText("Draft saved")).toBeVisible();
	await expect(page.locator('iframe[title="Email content"]')).toBeVisible();

	await page.keyboard.press("c");
	await expect(compose.getByLabel("To", { exact: true })).toBeFocused();
	await compose.getByRole("button", { name: "Discard" }).click();
	await expect(compose).toHaveCount(0);

	await page.getByRole("button", { name: "Back to list" }).click();
	await page.getByRole("link", { name: /Drafts/ }).click();
	await expect(row(page, "A subject that must survive")).toBeVisible();
});

test("an open conversation is answered and filed from the keyboard and its own buttons", async ({
	page,
	app,
}) => {
	await app.deliver(
		mime({ subject: "Behaviour: answer me", to: app.account.mailbox, html: "<p>Question</p>" }),
	);
	await page.goto(`/mailbox/${encodeURIComponent(app.account.mailbox)}/emails/inbox`);
	await row(page, "Behaviour: answer me").click();
	await expect(page.locator('iframe[title="Email content"]')).toBeVisible();

	// Reply is a button under the message, and `r` on the keyboard.
	await expect(page.getByRole("button", { name: "Reply", exact: true })).toBeVisible();
	await page.keyboard.press("r");
	const compose = page.getByRole("region", { name: "Compose" });
	await expect(compose.getByLabel("Subject")).toHaveValue("Re: Behaviour: answer me");
	await compose.getByRole("button", { name: "Discard" }).click();

	// Archive files the conversation and returns to the list.
	await page.getByRole("button", { name: "Archive" }).click();
	await expect(page.getByText("Conversation archived")).toBeVisible();
	await expect(row(page, "Behaviour: answer me")).toHaveCount(0);
	expect(new URL(page.url()).searchParams.get("open")).toBeNull();

	// The note that says so does not silence the keyboard while it is on screen.
	await page.keyboard.press("c");
	await expect(compose).toBeVisible();
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

test("an open conversation steps to the newer and the older one", async ({ page, app }) => {
	for (const name of ["older", "newer"]) {
		await app.deliver(
			mime({ subject: `Behaviour: step ${name}`, to: app.account.mailbox, text: name }),
		);
	}
	await page.goto(`/mailbox/${encodeURIComponent(app.account.mailbox)}/emails/inbox`);
	await row(page, "Behaviour: step newer").click();
	const subject = page.getByRole("heading", { level: 2 });
	await expect(subject.filter({ hasText: "Behaviour: step newer" })).toBeVisible();

	await page.getByRole("button", { name: "Older", exact: true }).click();
	await expect(subject.filter({ hasText: "Behaviour: step older" })).toBeVisible();
	await page.keyboard.press("k");
	await expect(subject.filter({ hasText: "Behaviour: step newer" })).toBeVisible();

	// Stepping reads: both are read when the list comes back.
	await page.keyboard.press("u");
	await select(page, "Behaviour: step older").check();
	await expect(page.getByRole("button", { name: "Mark as unread" }).first()).toBeVisible();
});

test("the reader chooses the height of a line and a reading pane, and the choice stays", async ({
	page,
	app,
}) => {
	for (const name of ["below", "above"]) {
		await app.deliver(
			mime({ subject: `Behaviour: pane ${name}`, to: app.account.mailbox, html: `<p>${name}</p>` }),
		);
	}
	await page.goto(`/mailbox/${encodeURIComponent(app.account.mailbox)}/emails/inbox`);
	const line = row(page, "Behaviour: pane above");
	await expect(line).toBeVisible();
	const height = async () => (await line.locator("..").boundingBox())?.height ?? 0;
	expect(await height()).toBe(40);

	await page.getByRole("button", { name: "Display" }).click();
	await page.getByRole("menuitemradio", { name: "Compact" }).click();
	await page.keyboard.press("Escape");
	expect(await height()).toBe(32);

	// With the reading pane a conversation opens beside the list, and the list stays.
	await page.getByRole("button", { name: "Display" }).click();
	await page.getByRole("menuitemradio", { name: "Right of the list" }).click();
	await page.keyboard.press("Escape");
	await expect(page.getByText("No conversation is open.")).toBeVisible();
	await line.click();
	await expect(page.locator('iframe[title="Email content"]')).toBeVisible();
	await expect(line).toBeVisible();

	// Moving through the list reads it, and filing the open conversation closes the pane.
	await page.keyboard.press("j");
	await expect(
		page.getByRole("heading", { level: 2 }).filter({ hasText: "Behaviour: pane below" }),
	).toBeVisible();
	await page.keyboard.press("e");
	await expect(row(page, "Behaviour: pane below")).toHaveCount(0);
	await expect(page.getByText("No conversation is open.")).toBeVisible();

	// Both choices are still there after a reload. Beside a pane the list is narrow, and a line
	// is two rows of text whatever the density.
	await page.reload();
	await expect(page.getByText("No conversation is open.")).toBeVisible();
	await expect(line).toBeVisible();
	expect(await height()).toBeGreaterThan(32);

	// On a narrow screen there is no room for a pane: the conversation replaces the list.
	await page.setViewportSize({ width: 800, height: 800 });
	await expect(page.getByText("No conversation is open.")).toHaveCount(0);
	await page.setViewportSize({ width: 1280, height: 800 });
	await page.getByRole("button", { name: "Display" }).click();
	await page.getByRole("menuitemradio", { name: "No split" }).click();
	await page.keyboard.press("Escape");
	await expect(page.getByText("No conversation is open.")).toHaveCount(0);
	expect(await height()).toBe(32);
});

test("search options write the query a person could type", async ({ page, app }) => {
	await app.deliver(
		mime({ subject: "Behaviour: find me by parts", to: app.account.mailbox, text: "needle" }),
	);
	await page.goto(`/mailbox/${encodeURIComponent(app.account.mailbox)}/emails/inbox`);
	await page.getByRole("button", { name: "Search options" }).click();
	const options = page.getByRole("dialog", { name: "Search options" });
	await options.getByLabel("Subject").fill("find me by parts");
	await options.getByLabel("Has the words").fill("needle");
	await options.getByLabel("Search in").selectOption({ label: "Inbox" });
	await options.getByRole("button", { name: "Search", exact: true }).click();

	await expect(options).toHaveCount(0);
	const box = page.getByRole("searchbox", { name: "Search emails" });
	await expect(box).toHaveValue('subject:"find me by parts" in:inbox needle');
	await expect(row(page, "Behaviour: find me by parts")).toBeVisible();

	// The dialog opens with what the box says.
	await page.getByRole("button", { name: "Search options" }).click();
	await expect(options.getByLabel("Subject")).toHaveValue("find me by parts");
	await expect(options.getByLabel("Has the words")).toHaveValue("needle");
});

test("a link is added in the app's own dialog, and adding it does not send the message", async ({
	page,
	app,
}) => {
	await page.goto(`/mailbox/${encodeURIComponent(app.account.mailbox)}/emails/inbox`);
	await page.getByRole("button", { name: "Compose" }).click();
	const compose = page.getByRole("region", { name: "Compose" });
	await compose.getByLabel("To", { exact: true }).fill("someone@example.com");
	await compose.getByLabel("Subject").fill("A link");
	const text = compose.locator(".ProseMirror");
	await text.click();
	await page.keyboard.type("our page");
	await page.keyboard.press("ControlOrMeta+a");

	await compose.getByRole("button", { name: "Link", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Link" });
	await dialog.getByLabel("Address").fill("https://example.com/page");
	await dialog.getByLabel("Address").press("Enter");
	await expect(dialog).toHaveCount(0);

	await expect(text.locator('a[href="https://example.com/page"]')).toHaveText("our page");
	await expect(compose).toBeVisible();
	await expect(page.getByText("Message sent")).toHaveCount(0);
	expect(app.watch.dialogs).toEqual([]);
	await compose.getByRole("button", { name: "Discard" }).click();
});
