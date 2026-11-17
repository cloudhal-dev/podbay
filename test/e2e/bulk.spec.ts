// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Tier 6: one request acts on many conversations, and a list has an order a person chooses
 * (ADR-0014). The toolbar sends one request for a ticked page; after a whole page is ticked a
 * line offers everything in the place or the search, and the app then asks with the mailbox's
 * own count; every deed can be taken back from its note; a line is a whole conversation.
 */
import type { Page } from "@playwright/test";
import { expect, mime, test } from "./fixtures.ts";

const row = (page: Page, subject: string) =>
	page.getByRole("button", { name: new RegExp(subject) });
const select = (page: Page, subject: string) =>
	page.getByLabel(new RegExp(`Select the conversation "${subject}`));
/** The note of a deed, which names what was done and carries its Undo. */
const note = (page: Page, words: string) => page.getByRole("dialog", { name: words });
/** Takes a deed back from its note; the note then leaves. */
async function undo(page: Page, words: string) {
	await note(page, words).getByRole("button", { name: "Undo" }).click();
	await expect(note(page, words)).toHaveCount(0);
}

/** The requests that change mail, as `<what> <path after the mailbox>`. */
function changes(page: Page): string[] {
	const seen: string[] = [];
	page.on("request", (request) => {
		const path = new URL(request.url()).pathname.replace(/^\/api\/v1\/mailboxes\/[^/]+/, "");
		if (request.method() === "POST" && /\/(bulk|move)\b/.test(path)) {
			seen.push(path.replace(/deed_[0-9a-f]+/, "<deed>").replace(/emails\/[^/]+/, "emails/<id>"));
		}
	});
	return seen;
}

test.beforeEach(async ({ page, app }) => {
	await app.signIn();
	await page.setViewportSize({ width: 1280, height: 800 });
});

test("a ticked page is acted on with one request, and every deed can be taken back", async ({
	page,
	app,
}) => {
	for (const name of ["one", "two", "three"]) {
		await app.deliver(mime({ subject: `Bulk: page ${name}`, to: app.account.mailbox, text: name }));
	}
	const sent = changes(page);
	await page.goto(`/mailbox/${encodeURIComponent(app.account.mailbox)}/emails/inbox`);
	const tick = async () => {
		for (const name of ["one", "two", "three"]) await select(page, `Bulk: page ${name}`).check();
		await expect(page.getByText("3 selected")).toBeVisible();
	};

	// Three lines, one request; the note offers Undo, which is one request too.
	await tick();
	await page.getByRole("button", { name: "Archive" }).first().click();
	await expect(note(page, "3 conversations archived")).toBeVisible();
	await expect(row(page, "Bulk: page")).toHaveCount(0);
	expect(sent).toEqual(["/bulk"]);
	await undo(page, "3 conversations archived");
	await expect(row(page, "Bulk: page")).toHaveCount(3);
	expect(sent).toEqual(["/bulk", "/bulk/<deed>/undo"]);

	// Read is a deed with a note and an Undo as well.
	await tick();
	await page.getByRole("button", { name: "Mark as read" }).first().click();
	await expect(note(page, "3 conversations marked as read")).toBeVisible();
	await expect(page.getByRole("button", { name: "Mark as unread" }).first()).toBeVisible();
	await undo(page, "3 conversations marked as read");
	await expect(page.getByRole("button", { name: "Mark as read" }).first()).toBeVisible();

	// And so is a star on one line.
	const line = page.locator("div.group").filter({ has: row(page, "Bulk: page two") });
	await line.getByRole("button", { name: "Star", exact: true }).click();
	await expect(note(page, "Conversation starred")).toBeVisible();
	await expect(line.getByRole("button", { name: "Unstar" })).toBeVisible();
	await undo(page, "Conversation starred");
	await expect(line.getByRole("button", { name: "Star", exact: true })).toBeVisible();

	// No line was moved by a request of its own.
	expect(sent.filter((path) => path.includes("/move"))).toEqual([]);
	expect(app.watch.dialogs).toEqual([]);
	expect(app.watch.errors).toEqual([]);
});

test("everything in a place or a search is chosen from a line, asked with its count, and taken back", async ({
	page,
	app,
}) => {
	const many = 12;
	for (let n = 0; n < many; n++) {
		await app.deliver(mime({ subject: `Bulk: many ${n}`, to: app.account.mailbox, text: "x" }));
	}
	const base = `/mailbox/${encodeURIComponent(app.account.mailbox)}`;
	await page.goto(`${base}/settings`);
	await page.getByLabel("Conversations on a page").selectOption("10");

	// Everything a search finds. A page that is only partly ticked offers nothing.
	await page.goto(`${base}/search?q=${encodeURIComponent('subject:"Bulk: many"')}`);
	await expect(row(page, "Bulk: many")).toHaveCount(10);
	await select(page, "Bulk: many 11").check();
	await expect(
		page.getByRole("button", { name: "Select everything this search finds" }),
	).toHaveCount(0);
	await page.getByLabel("Select all conversations on this page").check();
	await expect(page.getByText("Everything on this page is selected.")).toBeVisible();
	await page.getByRole("button", { name: "Select everything this search finds" }).click();
	await expect(page.getByText("Everything this search finds is selected.")).toBeVisible();
	await expect(page.getByText("Everything selected")).toBeVisible();

	// The app asks first, in its own dialog, with the count the mailbox gave.
	await page.getByRole("button", { name: "Report spam" }).first().click();
	const asking = page.getByRole("alertdialog");
	await expect(asking.getByText(`Mark ${many} conversations as spam?`)).toBeVisible();
	await expect(asking.getByText(`That is ${many} messages in all.`)).toBeVisible();
	await asking.getByRole("button", { name: "Cancel" }).click();
	await expect(row(page, "Bulk: many")).toHaveCount(10);
	await page.getByRole("button", { name: "Report spam" }).first().click();
	await asking.getByRole("button", { name: "Report spam" }).click();
	await expect(note(page, `${many} conversations marked as spam`)).toBeVisible();
	await expect(row(page, "Bulk: many")).toHaveCount(0);

	// Everything in a place: more than the page that is on screen.
	await page.goto(`${base}/emails/spam`);
	await expect(row(page, "Bulk: many")).toHaveCount(10);
	const total = Number(
		(await page.getByText(/1–10 of \d+/).textContent())?.match(/of (\d+)/)?.[1] ?? 0,
	);
	expect(total).toBeGreaterThanOrEqual(many);
	await page.getByLabel("Select all conversations on this page").check();
	await page.getByRole("button", { name: "Select everything in Spam" }).click();
	await expect(page.getByText("Everything in Spam is selected.")).toBeVisible();
	await page.getByRole("button", { name: "Not spam" }).first().click();
	await expect(asking.getByText(`Move ${total} conversations to Inbox?`)).toBeVisible();
	await asking.getByRole("button", { name: "Move to Inbox" }).click();
	await expect(note(page, `${total} conversations moved to Inbox`)).toBeVisible();
	await expect(row(page, "Bulk: many")).toHaveCount(0);

	// Undo puts all of them back, not only the page that was on screen.
	await undo(page, `${total} conversations moved to Inbox`);
	await expect(row(page, "Bulk: many")).toHaveCount(10);
	await expect(page.getByText(`1–10 of ${total}`)).toBeVisible();
	expect(app.watch.dialogs).toEqual([]);
	expect(app.watch.errors).toEqual([]);
});

test("archiving a conversation of several messages empties the inbox of it", async ({
	page,
	app,
}) => {
	const root = `bulk-${Date.now()}@sender.test`;
	for (const body of ["first", "second", "third"]) {
		await app.deliver(
			mime({
				subject: "Re: Bulk: whole line",
				to: app.account.mailbox,
				text: body,
				inReplyTo: root,
			}),
		);
	}
	const base = `/mailbox/${encodeURIComponent(app.account.mailbox)}`;
	const inPlace = async (place: string) => {
		const found = await page.request.get(
			`/api/v1/mailboxes/${encodeURIComponent(app.account.mailbox)}/search?subject=${encodeURIComponent("Bulk: whole line")}&folder=${place}`,
		);
		return ((await found.json()) as { totalCount: number }).totalCount;
	};
	await page.goto(`${base}/emails/inbox`);
	await expect(row(page, "Re: Bulk: whole line")).toHaveCount(1);
	expect(await inPlace("inbox")).toBe(3);

	await row(page, "Re: Bulk: whole line").click({ button: "right" });
	await page.getByRole("menuitem", { name: "Archive" }).click();
	await expect(note(page, "Conversation archived")).toBeVisible();
	await expect(row(page, "Re: Bulk: whole line")).toHaveCount(0);
	// Not one message of it is left in the inbox.
	expect(await inPlace("inbox")).toBe(0);
	expect(await inPlace("archive")).toBe(3);

	await undo(page, "Conversation archived");
	await expect(row(page, "Re: Bulk: whole line")).toHaveCount(1);
	expect(await inPlace("inbox")).toBe(3);
	expect(app.watch.errors).toEqual([]);
});

test("a person puts unread conversations first, and the choice stays", async ({ page, app }) => {
	for (const name of ["older", "newer"]) {
		await app.deliver(
			mime({ subject: `Bulk: order ${name}`, to: app.account.mailbox, text: name }),
		);
	}
	const base = `/mailbox/${encodeURIComponent(app.account.mailbox)}`;
	const search = `${base}/search?q=${encodeURIComponent('subject:"Bulk: order"')}`;
	const order = async () =>
		(await row(page, "Bulk: order").allTextContents()).map((text) =>
			text.includes("newer") ? "newer" : "older",
		);

	await page.goto(`${base}/emails/inbox`);
	await row(page, "Bulk: order newer").click({ button: "right" });
	await page.getByRole("menuitem", { name: "Mark as read" }).click();
	await expect(note(page, "Conversation marked as read")).toBeVisible();

	// Newest first until the person says otherwise; then the list is asked for in that order.
	await page.goto(search);
	await expect(row(page, "Bulk: order")).toHaveCount(2);
	expect(await order()).toEqual(["newer", "older"]);
	const asked = page.waitForRequest((request) => /\/search\?.*order=unread/.test(request.url()));
	await page.getByRole("button", { name: "Display" }).click();
	await page.getByRole("menuitemradio", { name: "Unread first" }).click();
	await asked;
	await page.keyboard.press("Escape");
	await expect.poll(order).toEqual(["older", "newer"]);

	// A place is asked for in the same order, and the choice is kept in this browser.
	const place = page.waitForRequest((request) => /\/emails\?.*order=unread/.test(request.url()));
	await page.goto(`${base}/emails/inbox`);
	await place;
	await page.goto(`${base}/settings`);
	const choice = page.getByRole("radiogroup", { name: "Order of a list" });
	await expect(choice.getByLabel("Unread first")).toBeChecked();
	await choice.getByLabel("Newest first").check();
	await page.goto(search);
	await expect.poll(order).toEqual(["newer", "older"]);
	expect(app.watch.errors).toEqual([]);
});
