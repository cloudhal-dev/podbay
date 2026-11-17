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
