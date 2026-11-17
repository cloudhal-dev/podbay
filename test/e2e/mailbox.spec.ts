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

test("a conversation carries labels: made in the rail, given, listed, moved to, and deleted without losing mail", async ({
	page,
	app,
}) => {
	for (const name of ["label me", "file me"]) {
		await app.deliver(mime({ subject: `Behaviour: ${name}`, to: app.account.mailbox, text: name }));
	}
	const inbox = `/mailbox/${encodeURIComponent(app.account.mailbox)}/emails/inbox`;
	await page.goto(inbox);
	const rail = page.getByRole("navigation", { name: "Folders" });
	const label = rail.getByRole("link", { name: "Projects" });

	// A label is made in the rail. A second one of the same name, whatever its case, is refused.
	await page.getByRole("button", { name: "Create a label" }).click();
	const dialog = page.getByRole("dialog", { name: "New label" });
	await dialog.getByLabel("Name").fill("Projects");
	await dialog.getByRole("radio", { name: "Blue" }).check({ force: true });
	await dialog.getByRole("button", { name: "Create" }).click();
	await expect(label).toBeVisible();
	await page.getByRole("button", { name: "Create a label" }).click();
	await dialog.getByLabel("Name").fill("PROJECTS");
	await dialog.getByRole("button", { name: "Create" }).click();
	await expect(dialog.getByRole("alert")).toContainText("already exists");
	await dialog.getByRole("button", { name: "Cancel" }).click();

	// "Label as" gives the label and leaves the conversation where it is.
	await select(page, "Behaviour: label me").check();
	await page.getByRole("button", { name: "Label as" }).click();
	await page.getByRole("menuitemcheckbox", { name: "Projects" }).click();
	await page.keyboard.press("Escape");
	await expect(row(page, "Behaviour: label me").getByText("Projects")).toBeVisible();
	await expect(row(page, "Behaviour: file me").getByText("Projects")).toHaveCount(0);

	// A label's list is a search for it.
	await label.click();
	await expect(page.getByRole("heading", { name: "Label Projects" })).toBeAttached();
	await expect(page.getByRole("searchbox", { name: "Search emails" })).toHaveValue(
		"label:Projects",
	);
	await expect(row(page, "Behaviour: label me")).toBeVisible();
	await expect(row(page, "Behaviour: file me")).toHaveCount(0);

	// "Move to" a label gives it and takes the conversation out of the inbox, with one Undo.
	await page.goto(inbox);
	await select(page, "Behaviour: file me").check();
	await page.getByRole("button", { name: "Move to" }).click();
	await page.getByRole("menuitem", { name: "Projects" }).click();
	await expect(row(page, "Behaviour: file me")).toHaveCount(0);
	await expect(page.getByText("Conversation moved to Projects")).toBeVisible();
	await page.getByRole("button", { name: "Undo" }).click();
	await expect(row(page, "Behaviour: file me")).toBeVisible();
	await expect(row(page, "Behaviour: file me").getByText("Projects")).toHaveCount(0);

	await select(page, "Behaviour: file me").check();
	await page.getByRole("button", { name: "Move to" }).click();
	await page.getByRole("menuitem", { name: "Projects" }).click();
	await expect(row(page, "Behaviour: file me")).toHaveCount(0);
	await rail.getByRole("link", { name: /Archive/ }).click();
	await expect(row(page, "Behaviour: file me").getByText("Projects")).toBeVisible();

	// Deleting a label asks, and deletes no mail.
	await label.hover();
	await page.getByRole("button", { name: "Options for the label Projects" }).click();
	await page.getByRole("menuitem", { name: "Delete" }).click();
	const asking = page.getByRole("alertdialog");
	await expect(asking.getByText("No message is deleted or moved.")).toBeVisible();
	await asking.getByRole("button", { name: "Delete label" }).click();
	await expect(label).toHaveCount(0);
	await expect(row(page, "Behaviour: file me")).toBeVisible();
	await expect(row(page, "Behaviour: file me").getByText("Projects")).toHaveCount(0);
	await page.goto(inbox);
	await expect(row(page, "Behaviour: label me")).toBeVisible();
	expect(app.watch.dialogs).toEqual([]);
});

test("each message has its own menu, and a conversation is read oldest first and can be printed", async ({
	page,
	app,
}) => {
	// The browser's print dialog cannot be driven: count the calls and say it closed.
	await page.addInitScript(() => {
		const state = window as unknown as { printed: number };
		state.printed = 0;
		window.print = () => {
			state.printed += 1;
			window.dispatchEvent(new Event("afterprint"));
		};
	});
	const root = `behaviour-menu-${Date.now()}@sender.test`;
	for (const body of ["first reply", "second reply"]) {
		await app.deliver(
			mime({
				subject: "Re: Behaviour: menu",
				to: app.account.mailbox,
				html: `<p>${body}</p>`,
				inReplyTo: root,
			}),
		);
	}
	await page.goto(`/mailbox/${encodeURIComponent(app.account.mailbox)}/emails/inbox`);
	await row(page, "Re: Behaviour: menu").first().click();

	// The conversation is read oldest first and its newest message is open. Its menu folds and
	// opens all of it.
	const frames = page.locator('iframe[title="Email content"]');
	await expect(frames.last().contentFrame().getByText("second reply")).toBeVisible();
	const more = page.getByRole("button", { name: "More", exact: true });
	// Whether the older message opened by itself depends on whether it was still unread.
	const expandAll = async () => {
		await more.click();
		await expect(page.getByRole("menuitem", { name: "Print all" })).toBeVisible();
		const expand = page.getByRole("menuitem", { name: "Expand all" });
		if (await expand.isVisible()) await expand.click();
		else await page.keyboard.press("Escape");
	};
	await expandAll();
	await expect(frames).toHaveCount(2);
	await more.click();
	await page.getByRole("menuitem", { name: "Collapse all" }).click();
	await expect(frames).toHaveCount(0);
	await more.click();
	await page.getByRole("menuitem", { name: "Expand all" }).click();
	await expect(frames).toHaveCount(2);
	await expect(frames.first().contentFrame().getByText("first reply")).toBeVisible();

	// Who a message went to is one click away.
	await page.getByRole("button", { name: "Show details" }).first().click();
	await expect(page.locator("dl").first()).toContainText("Subject");
	await expect(page.locator("dl").first()).toContainText("ada@sender.test");

	// A message is answered from its own menu.
	const menus = page.getByRole("button", { name: "More for this message" });
	await menus.first().click();
	await page.getByRole("menuitem", { name: "Forward" }).click();
	const compose = page.getByRole("region", { name: "Compose" });
	await expect(compose.getByLabel("Subject")).toHaveValue("Fwd: Re: Behaviour: menu");
	await compose.getByRole("button", { name: "Discard" }).click();

	// Printing one message prints once, and on paper there is the mail and none of the app.
	await menus.first().click();
	await page.getByRole("menuitem", { name: "Print", exact: true }).click();
	await expect
		.poll(() => page.evaluate(() => (window as unknown as { printed: number }).printed))
		.toBe(1);
	await page.emulateMedia({ media: "print" });
	await expect(page.getByRole("searchbox", { name: "Search emails" })).toBeHidden();
	await expect(page.getByRole("button", { name: "Back to list" })).toBeHidden();
	await expect(page.getByRole("navigation", { name: "Folders" })).toBeHidden();
	await expect(frames.first()).toBeVisible();
	await page.emulateMedia({ media: "screen" });

	// Its sender's other mail is a search.
	await menus.first().click();
	await page.getByRole("menuitem", { name: "Find messages from this sender" }).click();
	await expect(page.getByRole("searchbox", { name: "Search emails" })).toHaveValue(
		"from:ada@sender.test",
	);
	await page.goBack();
	await expect(frames.first()).toBeVisible();

	// Deleting one message leaves the conversation open with the other.
	await expandAll();
	await expect(frames).toHaveCount(2);
	await menus.first().click();
	await page.getByRole("menuitem", { name: "Delete this message" }).click();
	await expect(page.getByText("Message moved to Trash")).toBeVisible();
	await expect(frames).toHaveCount(1);
	await expect(frames.first().contentFrame().getByText("second reply")).toBeVisible();
	await expect(page.getByRole("button", { name: "Back to list" })).toBeVisible();
});

test("settings are in tabs; a person's choices take effect at once and stay, a mailbox's are saved", async ({
	page,
	app,
}) => {
	for (let n = 0; n < 11; n++) {
		await app.deliver(
			mime({ subject: `Behaviour: page ${n}`, to: app.account.mailbox, text: "x" }),
		);
	}
	const base = `/mailbox/${encodeURIComponent(app.account.mailbox)}`;
	await page.goto(`${base}/settings`);
	const tabs = page.getByRole("navigation", { name: "Settings" });
	await expect(tabs.getByRole("link", { name: "General" })).toHaveAttribute("aria-current", "page");

	// A page of ten.
	await page.getByLabel("Conversations on a page").selectOption("10");
	await page.goto(`${base}/emails/inbox`);
	await expect(page.getByText(/^1–10 of \d+$/)).toBeVisible();

	// Shortcuts off: a key is only a key. On again: `c` writes.
	await page.goto(`${base}/settings`);
	await page.getByRole("radiogroup", { name: "Keyboard shortcuts" }).getByLabel("Off").check();
	await page.keyboard.press("c");
	await expect(page.getByRole("region", { name: "Compose" })).toHaveCount(0);
	await page.getByRole("radiogroup", { name: "Keyboard shortcuts" }).getByLabel("On").check();

	// The Reply button of a message can mean reply to all.
	await page.getByRole("radiogroup", { name: "Reply button" }).getByLabel("Reply to all").check();
	// Dark, at once and after a reload.
	await page.getByRole("radiogroup", { name: "Appearance" }).getByLabel("Dark").check();
	await expect(page.locator("html")).toHaveAttribute("data-mode", "dark");
	await page.reload();
	await expect(page.locator("html")).toHaveAttribute("data-mode", "dark");
	await expect(
		page.getByRole("radiogroup", { name: "Appearance" }).getByLabel("Dark"),
	).toBeChecked();
	await page.getByRole("radiogroup", { name: "Appearance" }).getByLabel("Light").check();
	await expect(page.locator("html")).toHaveAttribute("data-mode", "light");

	await page.goto(`${base}/emails/inbox`);
	await row(page, "Behaviour: page 10").click();
	await expect(page.getByRole("button", { name: "Reply to all of this message" })).toBeVisible();

	// The signature belongs to the mailbox: saved there, and under the next new message.
	await page.goto(`${base}/settings?tab=signature`);
	await page.getByLabel("Add a signature to new messages").check();
	await page.locator(".ProseMirror").click();
	await page.keyboard.type("Kind regards from the pod bay");
	await page.getByRole("button", { name: "Save signature" }).click();
	await expect(page.getByText("Signature saved")).toBeVisible();
	await page.getByRole("button", { name: "Compose" }).click();
	const compose = page.getByRole("region", { name: "Compose" });
	await expect(compose.locator(".ProseMirror")).toContainText("Kind regards from the pod bay");
	await compose.getByRole("button", { name: "Discard" }).click();
	await page.getByLabel("Add a signature to new messages").uncheck();
	await page.getByRole("button", { name: "Save signature" }).click();

	// Labels are managed here as well as in the rail.
	await tabs.getByRole("link", { name: "Labels" }).click();
	await page.getByRole("button", { name: "New label" }).click();
	const dialog = page.getByRole("dialog", { name: "New label" });
	await dialog.getByLabel("Name").fill("From settings");
	await dialog.getByRole("button", { name: "Create" }).click();
	await expect(page.getByRole("table").getByRole("link", { name: "From settings" })).toBeVisible();
	await expect(
		page.getByRole("navigation", { name: "Folders" }).getByRole("link", { name: "From settings" }),
	).toBeVisible();
});

test("a line has a menu on a right click, and a long conversation keeps its middle folded", async ({
	page,
	app,
}) => {
	const root = `behaviour-long-${Date.now()}@sender.test`;
	for (let n = 1; n <= 6; n++) {
		await app.deliver(
			mime({
				subject: "Re: Behaviour: long",
				to: app.account.mailbox,
				html: `<p>part ${n}</p>`,
				inReplyTo: root,
			}),
		);
	}
	await app.deliver(
		mime({ subject: "Behaviour: right click", to: app.account.mailbox, text: "x" }),
	);
	const inbox = `/mailbox/${encodeURIComponent(app.account.mailbox)}/emails/inbox`;
	await page.goto(inbox);

	// The menu of a line does what the toolbar does, without selecting or opening anything.
	await row(page, "Behaviour: right click").click({ button: "right" });
	const menu = page.getByRole("menu");
	await expect(menu.getByRole("menuitem", { name: "Open", exact: true })).toBeVisible();
	await menu.getByRole("menuitem", { name: "Mark as read" }).click();
	await row(page, "Behaviour: right click").click({ button: "right" });
	await expect(menu.getByRole("menuitem", { name: "Mark as unread" })).toBeVisible();
	await menu.getByRole("menuitem", { name: "Forward" }).click();
	const compose = page.getByRole("region", { name: "Compose" });
	await expect(compose.getByLabel("Subject")).toHaveValue("Fwd: Behaviour: right click");
	await compose.getByRole("button", { name: "Discard" }).click();
	await row(page, "Behaviour: right click").click({ button: "right" });
	await menu.getByRole("menuitem", { name: "Archive" }).click();
	await expect(row(page, "Behaviour: right click")).toHaveCount(0);
	await expect(page.getByText("Conversation archived")).toBeVisible();

	// Six messages: the first, one line for the middle, and the last two.
	await row(page, "Re: Behaviour: long").first().click();
	const frames = page.locator('iframe[title="Email content"]');
	await expect(frames.last().contentFrame().getByText("part 6")).toBeVisible();
	// Everything is read by now; a reload shows the conversation as it opens from then on.
	await page.reload();
	await expect(frames.last().contentFrame().getByText("part 6")).toBeVisible();
	const fold = page.getByRole("button", { name: /Show \d older messages/ });
	await expect(fold).toHaveText(/Show 3 older messages/);
	await fold.click();
	await expect(fold).toHaveCount(0);
	await expect(page.getByRole("button", { name: /part 3/ })).toBeVisible();
});

test("files are attached to a message, held to what a message can carry, and sent with it", async ({
	page,
	app,
}) => {
	await page.goto(`/mailbox/${encodeURIComponent(app.account.mailbox)}/emails/inbox`);
	await page.getByRole("button", { name: "Compose" }).click();
	const compose = page.getByRole("region", { name: "Compose" });
	await compose.getByLabel("To", { exact: true }).fill("someone@elsewhere.test");
	await compose.getByLabel("Subject").fill("Behaviour: with a file");
	await compose.locator(".ProseMirror").click();
	await page.keyboard.type("The report is attached.");

	const picker = compose.getByLabel("Files to attach");
	await picker.setInputFiles([
		{ name: "report.txt", mimeType: "text/plain", buffer: Buffer.from("the report") },
		{ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("some notes") },
	]);
	const attached = compose.getByRole("list", { name: "Attached files" });
	await expect(attached.getByRole("listitem")).toHaveCount(2);
	await compose.getByRole("button", { name: "Remove notes.txt" }).click();
	await expect(attached.getByRole("listitem")).toHaveCount(1);

	// More than a message can carry is refused while writing, and nothing is added.
	await picker.setInputFiles([
		{
			name: "huge.bin",
			mimeType: "application/octet-stream",
			buffer: Buffer.alloc(19 * 1024 * 1024),
		},
	]);
	await expect(compose.getByText(/Attached files can be 18 MB together/)).toBeVisible();
	await expect(attached.getByRole("listitem")).toHaveCount(1);

	await compose.getByRole("button", { name: "Send", exact: true }).click();
	await expect(page.getByText("Message sent")).toBeVisible();
	await expect(compose).toHaveCount(0);

	await page
		.getByRole("navigation", { name: "Folders" })
		.getByRole("link", { name: /Sent/ })
		.click();
	await row(page, "Behaviour: with a file").click();
	await expect(page.getByText("report.txt")).toBeVisible();
	await expect(page.getByText("notes.txt")).toHaveCount(0);
});
