// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Tier 6: writing a message as a mail client lets a person write one. Files travel with it and
 * are held to what a message can carry, an address is completed from mail already exchanged,
 * and an answer is written under the conversation it answers.
 */
import type { Page } from "@playwright/test";
import { expect, mime, test } from "./fixtures.ts";

const row = (page: Page, subject: string) =>
	page.getByRole("button", { name: new RegExp(subject) });

test.beforeEach(async ({ page, app }) => {
	await app.signIn();
	await page.setViewportSize({ width: 1280, height: 800 });
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

test("an address is completed from the mail this mailbox has already exchanged", async ({
	page,
	app,
}) => {
	await app.deliver(
		mime({ subject: "Behaviour: known sender", to: app.account.mailbox, text: "x" }),
	);
	await page.goto(`/mailbox/${encodeURIComponent(app.account.mailbox)}/emails/inbox`);
	await expect(row(page, "Behaviour: known sender")).toBeVisible();
	await page.getByRole("button", { name: "Compose" }).click();
	const compose = page.getByRole("region", { name: "Compose" });
	const to = compose.getByRole("combobox", { name: "To" });

	await to.pressSequentially("ad");
	const offered = compose.getByRole("listbox", { name: "Addresses" });
	await expect(offered.getByRole("option", { name: "ada@sender.test" })).toBeVisible();
	// Enter takes the suggestion and does not send the message.
	await to.press("Enter");
	// The address is done: it is a chip, and the field is ready for the next one.
	await expect(to).toHaveValue("");
	await expect(compose.getByRole("button", { name: "Remove ada@sender.test" })).toBeVisible();
	await expect(offered).toHaveCount(0);
	await expect(compose).toBeVisible();
	await expect(page.getByText("Message sent")).toHaveCount(0);

	// An address already in the field is not offered again.
	await to.pressSequentially("ada");
	await expect(offered).toHaveCount(0);

	// A comma ends an address; something that is not one is marked; a chip is taken off by its
	// button or by Backspace in the empty field.
	await to.fill("");
	await to.pressSequentially("grace@navy.test,not an address,");
	await expect(compose.getByRole("button", { name: "Remove grace@navy.test" })).toBeVisible();
	await expect(compose.getByTitle("This does not look like an address")).toHaveText(
		/not an address/,
	);
	await compose.getByRole("button", { name: "Remove not an address" }).click();
	await to.press("Backspace");
	await expect(compose.getByRole("button", { name: "Remove grace@navy.test" })).toHaveCount(0);
	await expect(compose.getByRole("button", { name: "Remove ada@sender.test" })).toBeVisible();
	await compose.getByRole("button", { name: "Discard" }).click();
});

test("an answer is written under its conversation, and moves to the window without losing a word", async ({
	page,
	app,
}) => {
	await app.deliver(
		mime({ subject: "Behaviour: answer inline", to: app.account.mailbox, html: "<p>Question</p>" }),
	);
	const inbox = `/mailbox/${encodeURIComponent(app.account.mailbox)}/emails/inbox`;
	await page.goto(inbox);
	await row(page, "Behaviour: answer inline").click();
	await page.getByRole("button", { name: "Reply", exact: true }).click();

	// The answer is under the message, where the reply buttons were, and they give way to it.
	const compose = page.getByRole("region", { name: "Compose" });
	await expect(compose.getByLabel("Subject")).toHaveValue("Re: Behaviour: answer inline");
	await expect(page.getByRole("button", { name: "Reply", exact: true })).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Minimise the compose window" })).toHaveCount(0);
	const frameBox = await page.locator('iframe[title="Email content"]').boundingBox();
	const composeBox = await compose.boundingBox();
	expect(composeBox?.y ?? 0).toBeGreaterThan(frameBox?.y ?? Number.POSITIVE_INFINITY);

	await compose.locator(".ProseMirror").click();
	await page.keyboard.type("Typed under the conversation.");

	// Leaving the conversation keeps the answer: it goes on in the window.
	await page.getByRole("button", { name: "Back to list" }).click();
	await expect(row(page, "Behaviour: answer inline")).toBeVisible();
	await expect(page.getByRole("button", { name: "Minimise the compose window" })).toBeVisible();
	await expect(compose.locator(".ProseMirror")).toContainText("Typed under the conversation.");
	await expect(compose.getByLabel("Subject")).toHaveValue("Re: Behaviour: answer inline");
	await compose.getByRole("button", { name: "Discard" }).click();
	await expect(compose).toHaveCount(0);
});

test("a forward carries the files of the message, and leaves behind what can do harm", async ({
	page,
	app,
}) => {
	await app.deliver(
		mime({
			subject: "Behaviour: forward my files",
			to: app.account.mailbox,
			html: "<p>Two files.</p>",
			parts: [
				{ filename: "notes.txt", type: "text/plain", content: "some notes" },
				{ filename: "setup.exe", type: "application/octet-stream", content: "MZ not a program" },
			],
		}),
	);
	await page.goto(`/mailbox/${encodeURIComponent(app.account.mailbox)}/emails/inbox`);
	await row(page, "Behaviour: forward my files").click();
	await page.getByRole("button", { name: "Forward", exact: true }).click();
	const compose = page.getByRole("region", { name: "Compose" });

	// The plain file travels; the program is named and stays.
	const attached = compose.getByRole("list", { name: "Attached files" });
	await expect(attached.getByRole("listitem")).toHaveCount(1);
	await expect(attached).toContainText("notes.txt");
	await expect(compose.getByRole("status")).toContainText("setup.exe (can do harm when opened)");

	await compose.getByRole("combobox", { name: "To" }).fill("someone@elsewhere.test");
	await compose.getByRole("button", { name: "Send", exact: true }).click();
	await expect(page.getByText("Message sent")).toBeVisible();

	await page.getByRole("button", { name: "Back to list" }).click();
	await page
		.getByRole("navigation", { name: "Folders" })
		.getByRole("link", { name: /Sent/ })
		.click();
	await row(page, "Fwd: Behaviour: forward my files").click();
	await expect(page.getByText("notes.txt")).toBeVisible();
	await expect(page.getByText("setup.exe")).toHaveCount(0);
});

test("what is written is saved by itself, and sending or discarding leaves no draft behind", async ({
	page,
	app,
}) => {
	const base = `/mailbox/${encodeURIComponent(app.account.mailbox)}`;
	const drafts = async () => {
		await page
			.getByRole("navigation", { name: "Folders" })
			.getByRole("link", { name: /Drafts/ })
			.click();
		await expect(page.getByRole("heading", { name: "Drafts" })).toBeAttached();
	};
	await page.goto(`${base}/emails/inbox`);
	await page.getByRole("button", { name: "Compose" }).click();
	const compose = page.getByRole("region", { name: "Compose" });
	await compose.getByRole("combobox", { name: "To" }).fill("someone@elsewhere.test");
	await compose.getByLabel("Subject").fill("Behaviour: saved by itself");
	await compose.locator(".ProseMirror").click();
	await page.keyboard.type("Words that must not be lost.");

	// A moment after the last key the window says so, and the draft is in Drafts while the
	// window is still open.
	await expect(compose.getByText("Saved", { exact: true })).toBeVisible();
	await drafts();
	await expect(row(page, "Behaviour: saved by itself")).toHaveCount(1);

	// Writing on and saving again keeps one draft, not two.
	await compose.getByLabel("Subject").fill("Behaviour: saved by itself, twice");
	await expect(compose.getByText("Saved", { exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Refresh" }).click();
	await expect(row(page, "Behaviour: saved by itself")).toHaveCount(1);
	await expect(row(page, "Behaviour: saved by itself, twice")).toBeVisible();

	// Sending takes the draft away.
	await compose.getByRole("button", { name: "Send", exact: true }).click();
	await expect(page.getByText("Message sent")).toBeVisible();
	await page.getByRole("button", { name: "Refresh" }).click();
	await expect(row(page, "Behaviour: saved by itself")).toHaveCount(0);

	// So does discarding, also when a save was still on its way.
	await page.getByRole("button", { name: "Compose" }).click();
	await compose.getByLabel("Subject").fill("Behaviour: thrown away");
	await expect(compose.getByText("Saved", { exact: true })).toBeVisible();
	await compose.getByLabel("Subject").fill("Behaviour: thrown away, changed");
	await compose.getByRole("button", { name: "Discard" }).click();
	await page.waitForTimeout(3500);
	await page.getByRole("button", { name: "Refresh" }).click();
	await expect(row(page, "Behaviour: thrown away")).toHaveCount(0);
});
