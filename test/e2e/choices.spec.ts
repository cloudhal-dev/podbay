// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Tier 6: the choices a person makes in the settings change how mail is listed, answered and
 * announced, as they do in a mail client, and the keyboard reaches what the pointer reaches.
 */
import type { Page } from "@playwright/test";
import { expect, mime, test } from "./fixtures.ts";

const row = (page: Page, subject: string) =>
	page.getByRole("button", { name: new RegExp(subject) });
const choose = (page: Page, group: string, option: string) =>
	page.getByRole("radiogroup", { name: group }).getByLabel(option).check();

test.beforeEach(async ({ page, app }) => {
	await app.signIn();
	await page.setViewportSize({ width: 1280, height: 800 });
});

test("conversations and snippets can be turned off, and the lines change at once", async ({
	page,
	app,
}) => {
	const root = `choices-${Date.now()}@sender.test`;
	for (const body of ["the first words", "the second words"]) {
		await app.deliver(
			mime({
				subject: "Re: Choices: together",
				to: app.account.mailbox,
				text: body,
				inReplyTo: root,
			}),
		);
	}
	const base = `/mailbox/${encodeURIComponent(app.account.mailbox)}`;
	await page.goto(`${base}/emails/inbox`);
	await expect(row(page, "Re: Choices: together")).toHaveCount(1);
	await expect(row(page, "Re: Choices: together")).toContainText("the second words");

	await page.goto(`${base}/settings`);
	await choose(page, "Conversation view", "Off: each message by itself");
	await choose(page, "Snippets", "Subject only");
	await page.goto(`${base}/emails/inbox`);
	await expect(row(page, "Re: Choices: together")).toHaveCount(2);
	await expect(row(page, "Re: Choices: together").first()).not.toContainText("the second words");

	// A message is then read by itself.
	await row(page, "Re: Choices: together").first().click();
	await expect(page.locator('iframe[title="Email content"]')).toHaveCount(1);
	await expect(page.getByText(/messages in this conversation/)).toHaveCount(0);
});

test("an answer is sent and its conversation archived in one press, when the person asked for the button", async ({
	page,
	app,
}) => {
	await app.deliver(
		mime({ subject: "Choices: send and file", to: app.account.mailbox, html: "<p>Question</p>" }),
	);
	const base = `/mailbox/${encodeURIComponent(app.account.mailbox)}`;
	await page.goto(`${base}/emails/inbox`);
	await row(page, "Choices: send and file").click();
	await page.getByRole("button", { name: "Reply", exact: true }).click();
	const compose = page.getByRole("region", { name: "Compose" });
	await expect(compose.getByRole("button", { name: "Send and archive" })).toHaveCount(0);
	await compose.getByRole("button", { name: "Discard" }).click();

	await page.goto(`${base}/settings`);
	await choose(page, "Send and archive", "Show the button");
	await page.goto(`${base}/emails/inbox`);
	await row(page, "Choices: send and file").click();
	await page.getByRole("button", { name: "Reply", exact: true }).click();
	await compose.locator(".ProseMirror").click();
	await page.keyboard.type("The answer.");
	await compose.getByRole("button", { name: "Send and archive" }).click();
	await expect(page.getByText("Message sent and conversation archived")).toBeVisible();
	await expect(compose).toHaveCount(0);
	await expect(row(page, "Choices: send and file")).toHaveCount(0);
	await page
		.getByRole("navigation", { name: "Folders" })
		.getByRole("link", { name: /Archive/ })
		.click();
	await expect(row(page, "Choices: send and file")).toBeVisible();
});

test("new mail is announced by the device, only when asked for and with the sender and subject alone", async ({
	page,
	app,
}) => {
	// The browser's notifications cannot be seen from here: stand in for them and write them down.
	await page.addInitScript(() => {
		const notes: [string, string][] = [];
		(window as unknown as { notes: typeof notes }).notes = notes;
		class Stand {
			static permission = "granted";
			static requestPermission = async () => "granted";
			onclick: (() => void) | null = null;
			constructor(title: string, options?: { body?: string }) {
				notes.push([title, options?.body ?? ""]);
			}
			close() {}
		}
		(window as unknown as { Notification: unknown }).Notification = Stand;
	});
	const notes = () =>
		page.evaluate(() => (window as unknown as { notes: [string, string][] }).notes);
	const base = `/mailbox/${encodeURIComponent(app.account.mailbox)}`;
	await page.goto(`${base}/settings`);
	await choose(page, "Notifications", "For new mail");
	await page.goto(`${base}/emails/inbox`);
	await expect(page.getByRole("heading", { name: "Inbox" })).toBeAttached();
	// Time for the first look at the inbox: what is already there is not announced.
	await page.waitForTimeout(1500);
	expect(await notes()).toEqual([]);

	await app.deliver(
		mime({
			subject: "Choices: announce me",
			to: app.account.mailbox,
			text: "The body stays private.",
		}),
	);
	// Refreshing the list makes the app look again, as waiting half a minute would.
	await expect
		.poll(async () => {
			await page.getByRole("button", { name: "Refresh" }).click();
			return notes();
		})
		.toEqual([["ada@sender.test", "Choices: announce me"]]);
});

test("the keyboard takes back a move, and archives a conversation on the way to the next", async ({
	page,
	app,
}) => {
	for (const name of ["older", "newer"]) {
		await app.deliver(
			mime({ subject: `Choices: keys ${name}`, to: app.account.mailbox, text: name }),
		);
	}
	await page.goto(`/mailbox/${encodeURIComponent(app.account.mailbox)}/emails/inbox`);
	await expect(row(page, "Choices: keys newer")).toBeVisible();

	// `e` archives the line the cursor is on, and `z` takes it back while the note is there.
	await page.keyboard.press("e");
	await expect(row(page, "Choices: keys newer")).toHaveCount(0);
	await page.keyboard.press("z");
	await expect(row(page, "Choices: keys newer")).toBeVisible();

	// `]` archives the open conversation and goes on to the older one.
	await row(page, "Choices: keys newer").click();
	await expect(page.locator('iframe[title="Email content"]')).toBeVisible();
	await page.keyboard.press("]");
	await expect(
		page.getByRole("heading", { level: 2 }).filter({ hasText: "Choices: keys older" }),
	).toBeVisible();
	await page.keyboard.press("u");
	await expect(row(page, "Choices: keys newer")).toHaveCount(0);
	await expect(row(page, "Choices: keys older")).toBeVisible();
});

test("mail from a list can be left the way the list says, and only when the person says so", async ({
	page,
	context,
	app,
}) => {
	await app.deliver(
		mime({
			subject: "Choices: a newsletter",
			to: app.account.mailbox,
			html: "<p>News.</p>",
			headers: {
				"List-Unsubscribe": "<mailto:leave@canary.test>, <https://canary.test/leave?u=7>",
			},
		}),
	);
	await app.deliver(mime({ subject: "Choices: a letter", to: app.account.mailbox, text: "Hello" }));
	const inbox = `/mailbox/${encodeURIComponent(app.account.mailbox)}/emails/inbox`;

	// Ordinary mail offers nothing.
	await page.goto(inbox);
	await row(page, "Choices: a letter").click();
	await expect(page.locator('iframe[title="Email content"]')).toBeVisible();
	await expect(page.getByRole("button", { name: "Unsubscribe" })).toHaveCount(0);

	// Mail from a list says where the link leads, and nothing is contacted until the person agrees.
	await page.goto(inbox);
	await row(page, "Choices: a newsletter").click();
	await page.getByRole("button", { name: "Unsubscribe" }).click();
	const asking = page.getByRole("alertdialog");
	await expect(asking).toContainText("canary.test");
	await asking.getByRole("button", { name: "Cancel" }).click();
	expect(await app.contacted()).toEqual([]);
	expect(app.watch.popups.length).toBe(0);

	await page.getByRole("button", { name: "Unsubscribe" }).click();
	const opened = context.waitForEvent("page");
	await page.getByRole("alertdialog").getByRole("button", { name: "Open the page" }).click();
	const popup = await opened;
	await popup.waitForLoadState("domcontentloaded");
	expect(popup.url()).toBe("https://canary.test/leave?u=7");
	expect(await popup.evaluate(() => window.opener === null)).toBe(true);
	await popup.close();
});

test("holding Shift selects every line between the last box used and this one", async ({
	page,
	app,
}) => {
	for (const name of ["one", "two", "three", "four"]) {
		await app.deliver(
			mime({ subject: `Choices: range ${name}`, to: app.account.mailbox, text: name }),
		);
	}
	await page.goto(`/mailbox/${encodeURIComponent(app.account.mailbox)}/emails/inbox`);
	const box = (name: string) =>
		page.getByLabel(new RegExp(`Select the conversation "Choices: range ${name}`));
	await expect(box("four")).toBeVisible();

	// Newest first: four, three, two, one.
	await box("four").click();
	await box("two").click({ modifiers: ["Shift"] });
	for (const name of ["four", "three", "two"]) await expect(box(name)).toBeChecked();
	await expect(box("one")).not.toBeChecked();
	await expect(page.getByText("3 selected")).toBeVisible();

	// The same way back: Shift on a ticked line unticks the range.
	await box("three").click({ modifiers: ["Shift"] });
	await expect(box("two")).not.toBeChecked();
	await expect(box("three")).not.toBeChecked();
	await expect(box("four")).toBeChecked();
});

test("the sender's name opens what can be done with the sender, and the settings point to the account", async ({
	page,
	app,
}) => {
	await app.deliver(
		mime({ subject: "Choices: about the sender", to: app.account.mailbox, html: "<p>Hello</p>" }),
	);
	const base = `/mailbox/${encodeURIComponent(app.account.mailbox)}`;
	await page.goto(`${base}/emails/inbox`);
	await row(page, "Choices: about the sender").click();

	// Writing to the sender starts a new message, addressed.
	const sender = page.getByRole("button", { name: "About the sender ada@sender.test" });
	await sender.click();
	await page.getByRole("menuitem", { name: "Write to this sender" }).click();
	const compose = page.getByRole("region", { name: "Compose" });
	await expect(compose.getByRole("combobox", { name: "To" })).toHaveValue("ada@sender.test");
	await compose.getByRole("button", { name: "Discard" }).click();

	// Finding their mail is a search a person could have typed.
	await sender.click();
	await page.getByRole("menuitem", { name: "Find messages from this sender" }).click();
	await expect(page).toHaveURL(/search/);
	await expect(page.getByRole("searchbox")).toHaveValue(/from:ada@sender\.test/);

	// The settings of a mailbox say where the account's own settings are.
	await page.goto(`${base}/settings?tab=account`);
	await expect(page.getByText(app.account.email)).toBeVisible();
	await page.getByRole("link", { name: "Open sign-in and security" }).click();
	await expect(page.getByRole("heading", { name: "Sign-in and security" })).toBeVisible();
	await expect(page.getByRole("heading", { name: "Where you are signed in" })).toBeVisible();
	expect(app.watch.errors).toEqual([]);
});
