// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Tier 6: writing a message as a mail client lets a person write one. Files travel with it and
 * are held to what a message can carry, an address is completed from mail already exchanged,
 * and an answer is written under the conversation it answers.
 */
import type { Page } from "@playwright/test";
import { expect, mime, SENT_WITHIN, test } from "./fixtures.ts";

const row = (page: Page, subject: string) =>
	page.getByRole("button", { name: new RegExp(subject) });

test.beforeEach(async ({ page, app }) => {
	await app.signIn();
	await page.setViewportSize({ width: 1280, height: 800 });
});

test("a file taken away while it travels stays away, though the draft is closed and opened again first", async ({
	page,
	app,
}) => {
	// The bytes of the second file are held on their way until the draft has been opened again.
	let release = () => {};
	const held = new Promise<void>((resolve) => {
		release = resolve;
	});
	let puts = 0;
	await page.route(/\/drafts\/[^/]+\/attachments\/[^/]+$/, async (route) => {
		if (route.request().method() !== "PUT") return route.fallback();
		puts += 1;
		if (puts === 2) await held;
		// An upload stopped by the page is no longer there to go on.
		await route.continue().catch(() => {});
	});

	await page.goto(`/mailbox/${encodeURIComponent(app.account.mailbox)}/emails/inbox`);
	await page.getByRole("button", { name: "Compose" }).click();
	const compose = page.getByRole("region", { name: "Compose" });
	await compose.getByLabel("To", { exact: true }).fill("someone@elsewhere.test");
	await compose.getByLabel("Subject").fill("Behaviour: a file taken away on its way");
	await compose.getByLabel("Files to attach").setInputFiles([
		{ name: "report.txt", mimeType: "text/plain", buffer: Buffer.from("the report") },
		{ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("some notes") },
	]);
	const attached = compose.getByRole("list", { name: "Attached files" });
	await expect(attached.getByRole("listitem").filter({ hasText: "report.txt" })).toContainText(
		"10 B",
	);
	// notes.txt is still on its way when it is taken away, and the window is closed at once. Its
	// upload stops, and what was declared leaves the draft by a removal answered here.
	const removedOut = page.waitForResponse(
		(response) =>
			response.request().method() === "DELETE" && /\/attachments\/[^/]+$/.test(response.url()),
	);
	await compose.getByRole("button", { name: "Remove notes.txt" }).click();
	await expect(attached.getByRole("listitem")).toHaveCount(1);
	await compose.getByRole("button", { name: "Save and close" }).click();
	await expect(compose).toHaveCount(0);

	// The draft is opened again before the held bytes arrive; then they arrive.
	const drafts = page
		.getByRole("navigation", { name: "Folders" })
		.getByRole("link", { name: /Drafts/ });
	await drafts.click();
	await row(page, "Behaviour: a file taken away on its way").click();
	await page.getByRole("button", { name: "Edit", exact: true }).first().click();
	await expect(attached.getByRole("listitem")).toHaveCount(1);
	release();
	expect((await removedOut).ok(), "the file left the draft").toBe(true);

	// What arrived was removed from the draft: opened once more, it holds the one file.
	await compose.getByRole("button", { name: "Save and close" }).click();
	await expect(compose).toHaveCount(0);
	await page.reload();
	await page.getByRole("button", { name: "Edit", exact: true }).first().click();
	await expect(attached.getByRole("listitem")).toHaveCount(1);
	await expect(attached).toContainText("report.txt");
	await compose.getByRole("button", { name: "Save and close" }).click();
});

/** A gate a route waits at until the test opens it. */
function gate() {
	let open = () => {};
	const opened = new Promise<void>((resolve) => {
		open = resolve;
	});
	return { open, opened };
}

/** Opens the window with a recipient, a subject, some words and two files, both stored. */
async function withTwoFiles(page: Page, subject: string) {
	await page.getByRole("button", { name: "Compose" }).click();
	const compose = page.getByRole("region", { name: "Compose" });
	await compose.getByLabel("To", { exact: true }).fill("someone@elsewhere.test");
	await compose.getByLabel("Subject").fill(subject);
	await compose.locator(".ProseMirror").click();
	await page.keyboard.type("Two files, then one.");
	await compose.getByLabel("Files to attach").setInputFiles([
		{ name: "report.txt", mimeType: "text/plain", buffer: Buffer.from("the report") },
		{ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("some notes") },
	]);
	const attached = compose.getByRole("list", { name: "Attached files" });
	await expect(attached.getByRole("listitem").filter({ hasText: "report.txt" })).toContainText(
		"10 B",
	);
	return { compose, attached };
}

const ATTACHMENT = /\/drafts\/[^/]+\/attachments\/[^/]+$/;
const SENDS = (request: { method(): string; url(): string }) =>
	request.method() === "POST" && /\/api\/v1\/mailboxes\/[^/]+\/emails$/.test(request.url());

test("a message waits for a file taken away to leave its draft, and goes without it", async ({
	page,
	app,
}) => {
	// notes.txt is stored, then taken away; its removal is held on its way, so the message is
	// ready before the file has left the draft. (A file whose bytes never arrived is not part of a
	// message: the Worker reads only stored files.)
	const removal = gate();
	await page.route(ATTACHMENT, async (route) => {
		if (route.request().method() !== "DELETE") return route.fallback();
		await removal.opened;
		await route.continue();
	});
	await page.goto(`/mailbox/${encodeURIComponent(app.account.mailbox)}/emails/inbox`);
	const subject = `Behaviour: sent without the file taken away ${Date.now()}`;
	const { compose, attached } = await withTwoFiles(page, subject);
	await expect(attached.getByRole("listitem").filter({ hasText: "notes.txt" })).toContainText(
		"10 B",
	);
	await compose.getByRole("button", { name: "Remove notes.txt" }).click();
	// Send later, so nothing leaves: the message waits in Scheduled, where it can be read.
	await compose.getByRole("button", { name: "Send later" }).click();
	await page.getByRole("menuitem", { name: /Tomorrow morning/ }).click();
	await page.waitForTimeout(500);
	removal.open();
	await expect(page.getByText(/^Send scheduled for /)).toBeVisible();

	await page
		.getByRole("navigation", { name: "Folders" })
		.getByRole("link", { name: /Scheduled/ })
		.click();
	await page.getByRole("button", { name: new RegExp(subject) }).click();
	await expect(page.getByText("report.txt")).toBeVisible();
	await expect(page.getByText("notes.txt")).toHaveCount(0);
});

test("two presses of Send while it waits send the message once", async ({ page, app }) => {
	const held = gate();
	await page.route(ATTACHMENT, async (route) => {
		if (route.request().method() !== "DELETE") return route.fallback();
		await held.opened;
		await route.continue();
	});
	let sends = 0;
	page.on("request", (request) => {
		if (SENDS(request)) sends += 1;
	});
	await page.goto(`/mailbox/${encodeURIComponent(app.account.mailbox)}/emails/inbox`);
	const { compose, attached } = await withTwoFiles(
		page,
		`Behaviour: one press counts ${Date.now()}`,
	);
	await expect(attached.getByRole("listitem").filter({ hasText: "notes.txt" })).toContainText(
		"10 B",
	);
	await compose.getByRole("button", { name: "Remove notes.txt" }).click();
	await compose.getByRole("button", { name: "Send", exact: true }).click();
	// Send waits for the removal and says it is sending. A second press meanwhile, by the keys
	// that send, must not send the message again.
	await expect(compose.getByRole("button", { name: "Sending" })).toBeDisabled();
	await page.keyboard.press("ControlOrMeta+Enter");
	await page.waitForTimeout(500);
	expect(sends, "nothing is sent while the file is leaving").toBe(0);
	held.open();
	await expect(compose).toHaveCount(0, SENT_WITHIN);
	await page.waitForTimeout(500);
	expect(sends, "one request to send").toBe(1);
});

test("a failed upload of a message left behind does not keep the next message from going", async ({
	page,
	app,
}) => {
	// report.txt's bytes are held, then refused; notes.txt is taken away before its turn.
	const bytes = gate();
	await page.route(ATTACHMENT, async (route) => {
		if (route.request().method() !== "PUT") return route.fallback();
		await bytes.opened;
		await route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
	});
	await page.goto(`/mailbox/${encodeURIComponent(app.account.mailbox)}/emails/inbox`);
	await page.getByRole("button", { name: "Compose" }).first().click();
	let compose = page.getByRole("region", { name: "Compose" });
	await compose.getByLabel("To", { exact: true }).fill("someone@elsewhere.test");
	await compose.getByLabel("Subject").fill(`Behaviour: left behind ${Date.now()}`);
	await compose.getByLabel("Files to attach").setInputFiles([
		{ name: "report.txt", mimeType: "text/plain", buffer: Buffer.from("the report") },
		{ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("some notes") },
	]);
	await compose.getByRole("button", { name: "Remove notes.txt" }).click();
	// Another message begins, and only then does the first upload fail.
	await compose.getByRole("button", { name: "Save and close" }).click();
	await expect(compose).toHaveCount(0);
	await page.getByRole("button", { name: "Compose" }).first().click();
	compose = page.getByRole("region", { name: "Compose" });
	bytes.open();
	await page.waitForTimeout(500);

	// The next message goes, and is not held by the removal of the one before.
	await compose.getByLabel("To", { exact: true }).fill("someone@elsewhere.test");
	await compose.getByLabel("Subject").fill(`Behaviour: the next message ${Date.now()}`);
	await compose.locator(".ProseMirror").click();
	await page.keyboard.type("This one goes.");
	await compose.getByRole("button", { name: "Send", exact: true }).click();
	await expect(compose).toHaveCount(0, SENT_WITHIN);
});

test("a file that could not be taken out stops the message, comes back, and says why", async ({
	page,
	app,
}) => {
	// The removal is answered by an error, after Send was pressed.
	const held = gate();
	await page.route(ATTACHMENT, async (route) => {
		if (route.request().method() !== "DELETE") return route.fallback();
		await held.opened;
		await route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
	});
	let sends = 0;
	page.on("request", (request) => {
		if (SENDS(request)) sends += 1;
	});
	await page.goto(`/mailbox/${encodeURIComponent(app.account.mailbox)}/emails/inbox`);
	const { compose, attached } = await withTwoFiles(
		page,
		`Behaviour: a removal that fails ${Date.now()}`,
	);
	await expect(attached.getByRole("listitem").filter({ hasText: "notes.txt" })).toContainText(
		"10 B",
	);
	await compose.getByRole("button", { name: "Remove notes.txt" }).click();
	await compose.getByRole("button", { name: "Send", exact: true }).click();
	held.open();
	await expect(
		compose.getByText(/notes\.txt could not be taken out of the message/).first(),
	).toBeVisible();
	await expect(attached.getByRole("listitem").filter({ hasText: "notes.txt" })).toHaveCount(1);
	await expect(compose).toBeVisible();
	expect(sends, "nothing was sent").toBe(0);
});

test("files are attached to a message, kept by its draft, held to what a message can carry, and sent with it", async ({
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
	// The file is stored once its size stands where the progress stood.
	await expect(attached.getByRole("listitem")).toContainText("10 B");

	// The draft keeps the file: the window is closed, and the draft opened again has it.
	await compose.getByRole("button", { name: "Save and close" }).click();
	await expect(compose).toHaveCount(0);
	await page
		.getByRole("navigation", { name: "Folders" })
		.getByRole("link", { name: /Drafts/ })
		.click();
	await row(page, "Behaviour: with a file").click();
	await page.getByRole("button", { name: "Edit", exact: true }).first().click();
	await expect(attached.getByRole("listitem")).toHaveCount(1);
	await expect(attached).toContainText("report.txt");

	await compose.getByRole("button", { name: "Send", exact: true }).click();
	await expect(page.getByText("Message sent")).toBeVisible(SENT_WITHIN);
	await expect(compose).toHaveCount(0);

	await page
		.getByRole("navigation", { name: "Folders" })
		.getByRole("link", { name: /Sent/ })
		.click();
	await row(page, "Behaviour: with a file").click();
	await expect(page.getByText("report.txt")).toBeVisible();
	await expect(page.getByText("notes.txt")).toHaveCount(0);
	// The draft became the sent message: nothing of it is left in Drafts.
	await page
		.getByRole("navigation", { name: "Folders" })
		.getByRole("link", { name: /Drafts/ })
		.click();
	await expect(row(page, "Behaviour: with a file")).toHaveCount(0);
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

test("a forward carries the files of the message, and what can do harm only when the person says so", async ({
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
				{ filename: "macro.docm", type: "application/octet-stream", content: "PK not a document" },
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
	const left = compose.getByRole("list", { name: "Files that were not carried over" });
	await expect(left.getByRole("listitem")).toHaveCount(2);
	await expect(left).toContainText("setup.exe was not carried over: it can do harm when opened.");

	// One of them is added after all, once the person was told what it is and agreed.
	await left
		.getByRole("listitem")
		.filter({ hasText: "macro.docm" })
		.getByRole("button", { name: "Add it anyway" })
		.click();
	const dialog = page.getByRole("alertdialog", { name: "Forward this file?" });
	await expect(dialog).toContainText("macro.docm");
	await dialog.getByRole("button", { name: "Add it anyway" }).click();
	await expect(attached.getByRole("listitem")).toHaveCount(2);
	await expect(left.getByRole("listitem")).toHaveCount(1);

	await compose.getByRole("combobox", { name: "To" }).fill("someone@elsewhere.test");
	await compose.getByRole("button", { name: "Send", exact: true }).click();
	await expect(page.getByText("Message sent")).toBeVisible(SENT_WITHIN);

	await page.getByRole("button", { name: "Back to list" }).click();
	await page
		.getByRole("navigation", { name: "Folders" })
		.getByRole("link", { name: /Sent/ })
		.click();
	await row(page, "Fwd: Behaviour: forward my files").click();
	await expect(page.getByText("notes.txt")).toBeVisible();
	await expect(page.getByText("macro.docm")).toBeVisible();
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
	await expect(page.getByText("Message sent")).toBeVisible(SENT_WITHIN);
	await page.getByRole("button", { name: "Refresh" }).click();
	await expect(row(page, "Behaviour: saved by itself")).toHaveCount(0);

	// So does discarding, also when a save was still on its way. (An empty Drafts offers to
	// write as well; the rail's button comes first.)
	await page.getByRole("button", { name: "Compose" }).first().click();
	await compose.getByLabel("Subject").fill("Behaviour: thrown away");
	await expect(compose.getByText("Saved", { exact: true })).toBeVisible();
	await compose.getByLabel("Subject").fill("Behaviour: thrown away, changed");
	await compose.getByRole("button", { name: "Discard" }).click();
	await page.waitForTimeout(3500);
	await page.getByRole("button", { name: "Refresh" }).click();
	await expect(row(page, "Behaviour: thrown away")).toHaveCount(0);
});

test("the formatting bar sizes, colours, aligns and indents, in plain markup, and takes it off again", async ({
	page,
	app,
}) => {
	await page.goto(`/mailbox/${encodeURIComponent(app.account.mailbox)}/emails/inbox`);
	await page.getByRole("button", { name: "Compose" }).click();
	const compose = page.getByRole("region", { name: "Compose" });
	const bar = compose.getByRole("toolbar", { name: "Formatting" });
	const text = compose.locator(".ProseMirror");
	const choose = async (tool: string, choice: string) => {
		await bar.getByRole("button", { name: tool, exact: true }).click();
		await page.getByRole("menuitem", { name: choice, exact: true }).click();
		// The cursor goes back into the text, so writing goes on where it was.
		await expect(text).toBeFocused();
	};
	const press = async (tool: string) => {
		await bar.getByRole("button", { name: tool, exact: true }).click();
		await expect(text).toBeFocused();
	};
	await text.click();
	await page.keyboard.type("Styled words");
	await page.keyboard.press("ControlOrMeta+a");

	// A choice from a menu acts on what was selected, and the window stays open.
	await choose("Size", "Large");
	await choose("Text colour", "Red");
	await choose("Highlight", "Yellow");
	await choose("Align", "Align centre");
	const words = text.getByText("Styled words");
	await expect(words).toHaveCSS("font-size", "18px");
	await expect(words).toHaveCSS("color", "rgb(198, 40, 40)");
	await expect(text.locator("p").first()).toHaveCSS("text-align", "center");
	// What goes out is literal: a size in pixels and colours as numbers, nothing of the app's theme.
	const markup = await text.innerHTML();
	expect(markup).toContain("font-size: 18px");
	expect(markup).toMatch(/color: (#c62828|rgb\(198, 40, 40\))/);
	expect(markup).toMatch(/background-color: (#fff59d|rgb\(255, 245, 157\))/);
	expect(markup).not.toContain("var(--");
	await expect(compose).toBeVisible();

	await page.keyboard.press("ControlOrMeta+a");
	await press("Remove formatting");
	await expect(text.locator("[style]")).toHaveCount(0);
	await expect(text.locator("mark")).toHaveCount(0);
	await expect(text).toContainText("Styled words");

	// A list is indented a level and brought back.
	await page.keyboard.press("End");
	await page.keyboard.press("Enter");
	await press("Bullet list");
	await page.keyboard.type("one");
	await page.keyboard.press("Enter");
	await page.keyboard.type("two");
	await expect(bar.getByRole("button", { name: "Indent more" })).toBeEnabled();
	await press("Indent more");
	await expect(text.locator("ul ul")).toHaveCount(1);
	await press("Indent less");
	await expect(text.locator("ul ul")).toHaveCount(0);

	await expect(page.getByText("Message sent")).toHaveCount(0);
	expect(app.watch.dialogs).toEqual([]);
	expect(app.watch.errors).toEqual([]);
	await compose.getByRole("button", { name: "Discard" }).click();
});
