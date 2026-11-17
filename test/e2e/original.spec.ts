// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Tier 6: the original of a message in a real browser (ADR-0015; boundary B2).
 *
 * The original is every byte a stranger sent, at once. So:
 *
 * - a received message offers "Show original" and "Download message" in its menu, and a sent
 *   message offers neither;
 * - the original is shown as text: markup, a script, a link and an image address in it are
 *   characters, nothing runs, nothing is requested, and a character that changes the direction
 *   of text is drawn as a mark;
 * - the download is asked for in the app's own dialog, which says what the file is and names
 *   the attachments that can do harm, and it saves a `.eml` file with the exact bytes that
 *   arrived. The file is saved and never opened;
 * - a message Podbay could not read says so and offers its original.
 */
import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { AUTHENTICATION_SHOWN } from "../../shared/original.ts";
import { type App, BASE, expect, mime, test } from "./fixtures.ts";

/** A script that reports itself in every way a script could. */
const BEACON =
	'parent.postMessage({pwned:true},"*");top.postMessage({pwned:true},"*");new Image().src="https://canary.test/ran.png";fetch("https://canary.test/fetch");alert("pwned");document.title="pwned"';

const HOSTILE = "Original: markup and a script";
const WITH_FILES = "Original: with a program";
const TOO_LARGE = "Original: larger than a row";

const account = () =>
	JSON.parse(readFileSync(new URL("../../.e2e/account.json", import.meta.url), "utf8")) as {
		mailbox: string;
	};
const session = () =>
	(
		JSON.parse(readFileSync(new URL("../../.e2e/session.json", import.meta.url), "utf8")) as {
			cookie: string;
		}
	).cookie;

/** The messages of this file, as the bytes that are delivered. */
const raw: Record<string, string> = {};

async function deliver(text: string): Promise<void> {
	const res = await fetch(
		`${BASE}/cdn-cgi/local/email?from=ada@sender.test&to=${encodeURIComponent(account().mailbox)}`,
		{ method: "POST", body: text },
	);
	expect(res.status, "delivering a message").toBe(200);
}

test.beforeAll(async () => {
	const to = account().mailbox;
	raw[HOSTILE] = mime({
		subject: HOSTILE,
		to,
		// Sent as a page: everything a page could do, and a line that pretends to be another.
		html: `<p>Hello</p><script>${BEACON}</script><img src="https://tracker.canary.test/open.png"><a href="https://canary.test/click">click here</a><iframe src="https://canary.test/frame"></iframe><p>invoice‮gpj.exe</p>`,
		headers: { "X-Note": "bell\u0007 and back‮to front" },
	});
	raw[WITH_FILES] = mime({
		subject: WITH_FILES,
		to,
		text: "Two files attached.",
		parts: [
			{ filename: "notes.txt", type: "text/plain", content: "some notes" },
			{ filename: "setup.exe", type: "application/octet-stream", content: "MZ not a real program" },
		],
	});
	// A text longer than a row of the mailbox's database holds: the message is kept unread.
	raw[TOO_LARGE] = mime({
		subject: TOO_LARGE,
		to,
		text: "A long line of ordinary words, again and again.\r\n".repeat(172_000),
	});
	for (const text of Object.values(raw)) await deliver(text);
});

/** Opens the menu of the open message. */
async function messageMenu(page: Page) {
	await page.getByRole("button", { name: "More for this message" }).first().click();
}

/** Nothing a message could do happened: no script, no request, no dialog, no new window. */
async function nothingRan(app: App, page: Page) {
	expect(await app.contacted()).toEqual([]);
	expect(app.watch.dialogs).toEqual([]);
	expect(app.watch.popups).toEqual([]);
	expect(app.watch.errors).toEqual([]);
	const seen = await app.seen();
	expect(seen.messages).toEqual([]);
	expect(seen.violations).toEqual([]);
	expect(await page.title()).not.toBe("pwned");
}

test("a received message offers its original, to see and to save", async ({ page, app }) => {
	await app.signIn();
	await app.openMessage(HOSTILE);
	await messageMenu(page);
	await expect(page.getByRole("menuitem", { name: "Show original" })).toBeVisible();
	await expect(page.getByRole("menuitem", { name: "Download message" })).toBeVisible();
	// The list of header fields is what a message without an original has.
	await expect(page.getByRole("menuitem", { name: "Show headers" })).toHaveCount(0);
});

test("the original is shown as text: markup and a script are characters, and nothing runs", async ({
	page,
	app,
}) => {
	await app.signIn();
	await app.openMessage(HOSTILE);
	await messageMenu(page);
	await page.getByRole("menuitem", { name: "Show original" }).click();

	const dialog = page.getByRole("dialog");
	await expect(dialog.getByRole("heading", { name: "Original message" })).toBeVisible();
	const blocks = dialog.locator("pre");
	await expect(blocks).toHaveCount(2);
	await expect(dialog.getByText("The whole message as it arrived:")).toBeVisible();

	// The header block, then what follows it: the bytes as characters.
	await expect(blocks.nth(0)).toContainText(`Subject: ${HOSTILE}`);
	await expect(blocks.nth(0)).toContainText("From: Ada <ada@sender.test>");
	await expect(blocks.nth(1)).toContainText(`<script>${BEACON}</script>`);
	await expect(blocks.nth(1)).toContainText('<a href="https://canary.test/click">click here</a>');
	await expect(blocks.nth(1)).toContainText('<img src="https://tracker.canary.test/open.png">');

	// Text nodes and marks only: no element of the message exists in the page, and no link.
	expect(
		await dialog.locator("pre *").evaluateAll((all) => [...new Set(all.map((one) => one.tagName))]),
	).toEqual(["SPAN"]);
	await expect(dialog.locator("a, img, iframe, script, form, object, embed")).toHaveCount(0);

	// A control character and a character that turns the text round are drawn as marks, so the
	// line reads in the order of its bytes: the name ends in "gpj.exe", not in ".jpg".
	await expect(blocks.nth(0).locator("span", { hasText: "U+0007" })).toHaveCount(1);
	await expect(blocks.nth(0).locator("span", { hasText: "U+202E" })).toHaveCount(1);
	await expect(blocks.nth(1)).toContainText("invoiceU+202Egpj.exe");
	const text = (await blocks.allTextContents()).join("\n");
	const hidden = [...text].filter((character) => {
		const code = character.codePointAt(0) ?? 0;
		return (
			(code < 0x20 && code !== 0x09 && code !== 0x0a) ||
			(code >= 0x7f && code <= 0x9f) ||
			(code >= 0x202a && code <= 0x202e) ||
			(code >= 0x2066 && code <= 0x2069)
		);
	});
	expect(hidden).toEqual([]);
	expect(
		await blocks.first().evaluate((block) => {
			const style = getComputedStyle(block);
			return [style.direction, style.unicodeBidi];
		}),
	).toEqual(["ltr", "bidi-override"]);

	// Nothing is said about authentication until the live check is recorded (decision 19).
	if (!AUTHENTICATION_SHOWN) await expect(dialog.getByText(/SPF|DKIM|DMARC/)).toHaveCount(0);

	await nothingRan(app, page);
	await dialog.getByRole("button", { name: "Close" }).click();
	await expect(dialog).toBeHidden();
});

test("the download saves a .eml file with the exact bytes, after the app said what it is", async ({
	page,
	app,
}) => {
	await app.signIn();
	await app.openMessage(WITH_FILES);
	let downloads = 0;
	page.on("download", () => {
		downloads += 1;
	});

	await messageMenu(page);
	await page.getByRole("menuitem", { name: "Download message" }).click();
	const asking = page.getByRole("alertdialog");
	await expect(asking.getByRole("heading", { name: "Download this message?" })).toBeVisible();
	await expect(
		asking.getByText("Another program will open it without Podbay's protections."),
	).toBeVisible();
	// The attachment that can do harm is named; the plain one is not.
	await expect(asking.getByRole("listitem")).toHaveText(["setup.exe"]);

	// Reading the question downloads nothing; neither does saying no.
	await asking.getByRole("button", { name: "Cancel" }).click();
	await expect(asking).toBeHidden();
	await page.waitForTimeout(500);
	expect(downloads).toBe(0);

	await messageMenu(page);
	await page.getByRole("menuitem", { name: "Download message" }).click();
	const started = page.waitForEvent("download");
	await page
		.getByRole("alertdialog")
		.getByRole("button", { name: "Download", exact: true })
		.click();
	const download = await started;
	// A name Podbay made: the day, the start of the message's id, nothing of the message.
	expect(download.suggestedFilename()).toMatch(/^message-\d{8}-[0-9a-f]{8}\.eml$/);
	expect(download.suggestedFilename()).toContain(new Date().toISOString().slice(0, 4));
	// Saved, and never opened: the bytes are exactly what arrived.
	const saved = readFileSync(await download.path());
	expect(saved.equals(Buffer.from(raw[WITH_FILES] ?? "", "utf8"))).toBe(true);
	await expect(page.getByRole("alertdialog")).toBeHidden();
	expect(downloads).toBe(1);
	await nothingRan(app, page);
});

test("the original can be saved from where it is shown, script and all, and stays a file", async ({
	page,
	app,
}) => {
	await app.signIn();
	await app.openMessage(HOSTILE);
	await messageMenu(page);
	await page.getByRole("menuitem", { name: "Show original" }).click();
	await page.getByRole("dialog").getByRole("button", { name: "Download message" }).click();
	const asking = page.getByRole("alertdialog");
	await expect(asking.getByRole("heading", { name: "Download this message?" })).toBeVisible();
	// No attachment of this message can do harm, so none is named.
	await expect(asking.getByRole("listitem")).toHaveCount(0);

	const started = page.waitForEvent("download");
	await asking.getByRole("button", { name: "Download", exact: true }).click();
	const download = await started;
	expect(readFileSync(await download.path()).equals(Buffer.from(raw[HOSTILE] ?? "", "utf8"))).toBe(
		true,
	);
	// The page did not go anywhere, and the file did not open as a page.
	await expect(page).toHaveURL(/\/mailbox\//);
	await nothingRan(app, page);
});

test("the bytes are never a page: a link to them gives nothing a browser would show", async ({
	page,
	app,
}) => {
	await app.signIn();
	const mailbox = encodeURIComponent(app.account.mailbox);
	const listed = (await (
		await page.request.get(
			`/api/v1/mailboxes/${mailbox}/search?query=${encodeURIComponent(HOSTILE)}`,
		)
	).json()) as { emails: { id: string }[] };
	const id = listed.emails[0]?.id ?? "";
	expect(id).not.toBe("");

	// A link, as a message or another site could carry it, is answered with no bytes at all.
	const linked = await page.goto(`/api/v1/mailboxes/${mailbox}/emails/${id}/original/download`);
	expect(linked?.status()).toBe(404);
	expect(await page.content()).not.toContain("canary.test");
	// What shows the original is JSON under a policy that allows nothing: the markup in it is
	// text to the browser too.
	const shown = await page.goto(`/api/v1/mailboxes/${mailbox}/emails/${id}/original`);
	expect(shown?.headers()["content-type"]).toMatch(/^application\/json/);
	expect(shown?.headers()["x-content-type-options"]).toBe("nosniff");
	expect(await page.locator("script, a, img, iframe").count()).toBe(0);
	expect(await app.contacted()).toEqual([]);
	expect(app.watch.dialogs).toEqual([]);
	expect(await page.title()).not.toBe("pwned");
});

test("a message Podbay could not read says so and offers its original", async ({ page, app }) => {
	await app.signIn();
	await page.goto(`/mailbox/${encodeURIComponent(app.account.mailbox)}/emails/inbox`);
	// It has no subject and no text: only who the envelope said it was from.
	await page.getByText("(no subject)").first().click();
	const note = page.getByRole("note");
	await expect(note.getByText("Podbay could not read this message.")).toBeVisible();
	await expect(
		note.getByText("A part of it is too large for Podbay to keep as text."),
	).toBeVisible();
	await expect(page.locator('iframe[title="Email content"]')).toHaveCount(0);

	await note.getByRole("button", { name: "Show original" }).click();
	const dialog = page.getByRole("dialog");
	// Only the first 256 KB are shown, and the app says of how much.
	await expect(dialog.getByText(/^The first 256 KB of [\d.]+ MB\./)).toBeVisible();
	await expect(dialog.locator("pre").first()).toContainText(`Subject: ${TOO_LARGE}`);
	await dialog.getByRole("button", { name: "Close" }).click();

	await note.getByRole("button", { name: "Download message" }).click();
	const started = page.waitForEvent("download");
	await page
		.getByRole("alertdialog")
		.getByRole("button", { name: "Download", exact: true })
		.click();
	const saved = readFileSync(await (await started).path());
	expect(saved.equals(Buffer.from(raw[TOO_LARGE] ?? "", "utf8"))).toBe(true);
});

test("a sent message offers neither, and says what its headers are", async ({ page, app }) => {
	await app.signIn();
	const mailbox = app.account.mailbox;
	const sent = await fetch(`${BASE}/api/v1/mailboxes/${encodeURIComponent(mailbox)}/emails`, {
		method: "POST",
		headers: { "content-type": "application/json", origin: BASE, cookie: session() },
		body: JSON.stringify({
			to: "someone@elsewhere.test",
			from: mailbox,
			subject: "Original: sent from here",
			text: "No bytes come back from the sending service.",
		}),
	});
	expect(sent.status).toBe(202);

	await page.goto(`/mailbox/${encodeURIComponent(mailbox)}/emails/sent`);
	await page.getByText("Original: sent from here").first().click();
	await messageMenu(page);
	await expect(page.getByRole("menuitem", { name: "Show headers" })).toBeVisible();
	await expect(page.getByRole("menuitem", { name: "Show original" })).toHaveCount(0);
	await expect(page.getByRole("menuitem", { name: "Download message" })).toHaveCount(0);

	// "Show headers" says what it shows: what Podbay handed over, not what travelled.
	await page.getByRole("menuitem", { name: "Show headers" }).click();
	const dialog = page.getByRole("dialog");
	await expect(
		dialog.getByText("These are the fields Podbay handed to the sending service.", {
			exact: false,
		}),
	).toBeVisible();
	await expect(
		dialog.getByText("so a sent message has no original", { exact: false }),
	).toBeVisible();

	// Asked for directly, the Worker says the same.
	const id = ((await sent.json()) as { id: string }).id;
	const asked = await page.request.get(
		`/api/v1/mailboxes/${encodeURIComponent(mailbox)}/emails/${id}/original`,
	);
	expect(asked.status()).toBe(404);
	expect(((await asked.json()) as { code: string }).code).toBe("NO_ORIGINAL");
});
