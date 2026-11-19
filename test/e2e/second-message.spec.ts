// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Tier 6: starting a second message loses nothing of the first (#113). One message is written at
 * a time; the one being written when another starts is saved in Drafts first, with every word,
 * however the second one starts. The second starts at once, long before the first would have
 * saved itself (2.5 s after the last key).
 */
import type { Page } from "@playwright/test";
import { expect, makeMailbox, mime, test } from "./fixtures.ts";

// Names are matched as text they contain, never as a pattern made from them.
const row = (page: Page, subject: string) => page.getByRole("button", { name: subject });

/** The path of the page now, to compare with a mailbox's own. */
const pathNow = (page: Page) => new URL(page.url()).pathname;

const compose = (page: Page) => page.getByRole("region", { name: "Compose" });

const goToDrafts = async (page: Page) => {
	await page
		.getByRole("navigation", { name: "Folders" })
		.getByRole("link", { name: /Drafts/ })
		.click();
	await expect(page.getByRole("heading", { name: "Drafts", exact: true })).toBeAttached();
};

/** Writes a first message in the window that is open, and does not wait for it to save itself. */
async function writeFirst(page: Page, subject: string, words: string): Promise<void> {
	const window = compose(page);
	await window.getByLabel("Subject").fill(subject);
	await window.locator(".ProseMirror").click();
	await page.keyboard.type(words);
}

/** The first message is in Drafts with its subject and its words. */
async function expectKept(
	page: Page,
	subject: string,
	words: string,
	file?: string,
): Promise<void> {
	// A second message open stays as it is: nothing in it was written, so leaving it keeps nothing.
	if ((await compose(page).count()) > 0)
		await compose(page).getByRole("button", { name: "Discard" }).click();
	await expect(compose(page)).toHaveCount(0);
	await goToDrafts(page);
	await expect(row(page, subject)).toHaveCount(1);
	await row(page, subject).click();
	await page.getByRole("button", { name: "Edit", exact: true }).first().click();
	await expect(compose(page).getByLabel("Subject")).toHaveValue(subject);
	await expect(compose(page).locator(".ProseMirror")).toContainText(words);
	if (file)
		await expect(compose(page).getByRole("list", { name: "Attached files" })).toContainText(file);
	await compose(page).getByRole("button", { name: "Discard" }).click();
}

test.beforeEach(async ({ page, app }) => {
	await app.signIn();
	await page.setViewportSize({ width: 1280, height: 800 });
});

/** Each way a second message starts, from a page where a conversation is open. */
const SECOND: { way: string; start: (page: Page) => Promise<void> }[] = [
	{
		way: "the Compose button",
		start: (page) => page.getByRole("button", { name: "Compose" }).first().click(),
	},
	{
		way: "its key",
		async start(page) {
			// Out of the text first, as a person does by clicking elsewhere, then the key.
			await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
			await page.keyboard.press("c");
		},
	},
	{
		way: "an answer to the open conversation",
		start: (page) => page.getByRole("button", { name: "Reply", exact: true }).click(),
	},
	{
		way: "a forward of the open conversation",
		start: (page) => page.getByRole("button", { name: "Forward", exact: true }).click(),
	},
	{
		way: "Write to this sender",
		async start(page) {
			await page.getByRole("button", { name: /^About the sender/ }).click();
			await page.getByRole("menuitem", { name: "Write to this sender" }).click();
		},
	},
];

for (const [index, second] of SECOND.entries()) {
	test(`a message being written is kept in Drafts with every word when a second starts by ${second.way}`, async ({
		page,
		app,
	}) => {
		// Subjects carry a number and not the way: a line named "Compose" would answer to the
		// button's name in other tests that share this mailbox.
		const conversation = `Second: a conversation, number ${index + 1}`;
		await app.deliver(
			mime({ subject: conversation, to: app.account.mailbox, html: "<p>A question.</p>" }),
		);
		await page.goto(`/mailbox/${encodeURIComponent(app.account.mailbox)}/emails/inbox`);
		await row(page, conversation).click();
		await page.getByRole("button", { name: "Compose" }).first().click();

		const subject = `Second: the first message, number ${index + 1}`;
		const words = `Words written before the second, number ${index + 1}.`;
		await writeFirst(page, subject, words);
		await second.start(page);

		// The window holds the second message now.
		await expect(compose(page).getByLabel("Subject")).not.toHaveValue(subject);
		await expect(compose(page).locator(".ProseMirror")).not.toContainText(words);
		await expectKept(page, subject, words);
	});
}

test("a message being written is kept in Drafts with every word when a draft is opened from Drafts", async ({
	page,
	app,
}) => {
	const base = `/mailbox/${encodeURIComponent(app.account.mailbox)}/emails`;
	// A draft to open: written, and closed, which saves it.
	await page.goto(`${base}/inbox`);
	await page.getByRole("button", { name: "Compose" }).first().click();
	await compose(page).getByLabel("Subject").fill("Second: a draft waiting in Drafts");
	await compose(page).getByRole("button", { name: "Save and close" }).click();
	await expect(compose(page)).toHaveCount(0);

	await goToDrafts(page);
	await page.getByRole("button", { name: "Compose" }).first().click();
	await writeFirst(page, "Second: the first message, before a draft", "Words before a draft.");
	await row(page, "Second: a draft waiting in Drafts").click();
	await page.getByRole("button", { name: "Edit", exact: true }).first().click();
	await expect(compose(page).getByLabel("Subject")).toHaveValue(
		"Second: a draft waiting in Drafts",
	);
	await expectKept(page, "Second: the first message, before a draft", "Words before a draft.");
});

test("opening from Drafts the draft that is being written keeps the words written since it was saved", async ({
	page,
	app,
}) => {
	await page.goto(`/mailbox/${encodeURIComponent(app.account.mailbox)}/emails/inbox`);
	await goToDrafts(page);
	await page.getByRole("button", { name: "Compose" }).first().click();
	await writeFirst(page, "Second: the draft being written", "Saved words.");
	await expect(compose(page).getByText("Saved", { exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Refresh" }).click();
	// From here every save of the draft is held on its way, so the words written next are on the
	// screen only, as they are for the 2.5 s before the window saves by itself.
	let release = () => {};
	const held = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route(/\/api\/v1\/mailboxes\/[^/]+\/drafts\/[^/]+$/, async (route) => {
		if (route.request().method() !== "PUT") return route.fallback();
		await held;
		await route.continue().catch(() => {});
	});
	// More words, not saved; then the same draft is opened from the list.
	await compose(page).locator(".ProseMirror").click();
	await page.keyboard.press("End");
	await page.keyboard.type(" Words written since.");
	await row(page, "Second: the draft being written").click();
	await page.getByRole("button", { name: "Edit", exact: true }).first().click();
	await expect(compose(page).locator(".ProseMirror")).toContainText(
		"Saved words. Words written since.",
	);
	await expect(compose(page)).toHaveCount(1);
	// What the screen shows is not the proof: what is saved is. Saved, closed and opened again,
	// the draft holds every word.
	release();
	await compose(page).getByRole("button", { name: "Save and close" }).click();
	await expect(compose(page)).toHaveCount(0);
	// The draft is open for reading; a reload asks the mailbox for it again.
	await page.reload();
	await page.getByRole("button", { name: "Edit", exact: true }).first().click();
	await expect(compose(page).locator(".ProseMirror")).toContainText(
		"Saved words. Words written since.",
	);
	await compose(page).getByRole("button", { name: "Discard" }).click();
});

test("when the message being written cannot be saved, it stays open and the second does not begin", async ({
	page,
	app,
}) => {
	// Every save of a draft fails, as with a lost connection.
	await page.route(/\/api\/v1\/mailboxes\/[^/]+\/drafts(?:\/[^/]+)?$/, (route) =>
		["POST", "PUT"].includes(route.request().method())
			? route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"down"}' })
			: route.fallback(),
	);
	await page.goto(`/mailbox/${encodeURIComponent(app.account.mailbox)}/emails/inbox`);
	await page.getByRole("button", { name: "Compose" }).first().click();
	await writeFirst(page, "Second: a message that cannot be saved", "Words kept on the screen.");
	await page.getByRole("button", { name: "Compose" }).first().click();

	// The window still holds the first message, with every word, and says why.
	await expect(compose(page).getByText("down", { exact: true })).toBeVisible();
	await expect(compose(page).getByLabel("Subject")).toHaveValue(
		"Second: a message that cannot be saved",
	);
	await expect(compose(page).locator(".ProseMirror")).toContainText("Words kept on the screen.");
	await expect(compose(page)).toHaveCount(1);
	// The failed saves are logged (a 503, and the app's own note of a failed change); nothing else.
	expect(app.watch.errors.filter((one) => !/503|"event":"ui\.mutation_failed"/.test(one))).toEqual(
		[],
	);
});

/** Another mailbox of the instance, of this run alone. */
const anotherMailbox = (page: Page, name: string) =>
	makeMailbox(page, `${name}-${Date.now()}@example.com`, name);

/** Leaves for the list of mailboxes, as the rail does, and opens one of them. */
async function openMailbox(page: Page, email: string): Promise<void> {
	await page.getByRole("link", { name: "All mailboxes" }).click();
	await page.getByRole("link", { name: email }).click();
	await expect.poll(() => pathNow(page)).toContain(`/mailbox/${encodeURIComponent(email)}`);
}

test("a message being written is saved in its own mailbox when another opens, and nothing of it reaches the other", async ({
	page,
	app,
}) => {
	await page.goto(`/mailbox/${encodeURIComponent(app.account.mailbox)}/emails/inbox`);
	const other = await anotherMailbox(page, "second");
	await page.getByRole("button", { name: "Compose" }).first().click();
	await writeFirst(page, "Second: written in the first mailbox", "Words for the first mailbox.");
	// Watched from inside the page, every change of its document: is the message ever drawn while
	// the other mailbox's page is shown, if only for a frame? This holds the outcome, not the
	// check that draws a message only in its own mailbox (`belongsHere`): with that check taken
	// out the window is not drawn there either, because the message is closed before the other
	// mailbox's page draws. The check is a second hold, and no test shows it is the one.
	await page.evaluate(
		(path) => {
			const seen = { drawn: false };
			(window as unknown as { __elsewhere: typeof seen }).__elsewhere = seen;
			// What each change added, not the document as it stands when the observer runs: a window
			// drawn and taken away in one task is gone by then.
			const look = (changes: MutationRecord[]) => {
				if (!location.pathname.startsWith(path)) return;
				for (const change of changes)
					for (const node of change.addedNodes)
						if (
							node instanceof Element &&
							(node.matches('section[aria-label="Compose"]') ||
								node.querySelector('section[aria-label="Compose"]'))
						)
							seen.drawn = true;
			};
			new MutationObserver(look).observe(document.body, { childList: true, subtree: true });
		},
		`/mailbox/${encodeURIComponent(other)}`,
	);
	await openMailbox(page, other);

	// In the other mailbox the window is closed, was never drawn, and its Drafts holds nothing.
	await expect(compose(page)).toHaveCount(0);
	expect(
		await page.evaluate(
			() => (window as unknown as { __elsewhere: { drawn: boolean } }).__elsewhere.drawn,
		),
		"the message was drawn on the other mailbox's page",
	).toBe(false);
	await goToDrafts(page);
	await expect(page.getByRole("heading", { name: "No drafts" })).toBeVisible();
	await expect(row(page, "Second: written in the first mailbox")).toHaveCount(0);

	// The first mailbox's Drafts holds the message, with every word.
	await openMailbox(page, app.account.mailbox);
	await expectKept(page, "Second: written in the first mailbox", "Words for the first mailbox.");

	// And the other mailbox's Drafts still holds nothing of it.
	await openMailbox(page, other);
	await goToDrafts(page);
	await expect(page.getByRole("heading", { name: "No drafts" })).toBeVisible();
	await expect(compose(page)).toHaveCount(0);
});

test("a message being written is still open, with every word, after the list of mailboxes and back", async ({
	page,
	app,
}) => {
	await page.goto(`/mailbox/${encodeURIComponent(app.account.mailbox)}/emails/inbox`);
	await page.getByRole("button", { name: "Compose" }).first().click();
	await writeFirst(page, "Second: there and back", "Words that go nowhere.");
	await openMailbox(page, app.account.mailbox);
	await expect(compose(page).getByLabel("Subject")).toHaveValue("Second: there and back");
	await expect(compose(page).locator(".ProseMirror")).toContainText("Words that go nowhere.");
	await compose(page).getByRole("button", { name: "Discard" }).click();
});

test("when the message cannot be saved as another mailbox opens, the person is taken back to it, open", async ({
	page,
	app,
}) => {
	await page.goto(`/mailbox/${encodeURIComponent(app.account.mailbox)}/emails/inbox`);
	const other = await anotherMailbox(page, "third");
	await page.route(/\/api\/v1\/mailboxes\/[^/]+\/drafts(?:\/[^/]+)?$/, (route) =>
		["POST", "PUT"].includes(route.request().method())
			? route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"down"}' })
			: route.fallback(),
	);
	await page.getByRole("button", { name: "Compose" }).first().click();
	await writeFirst(
		page,
		"Second: a message that cannot move",
		"Words that stay with their mailbox.",
	);
	await page.getByRole("link", { name: "All mailboxes" }).click();
	await page.getByRole("link", { name: other }).click();

	// Back in the message's own mailbox, with the message open, every word, and why.
	await expect
		.poll(() => pathNow(page))
		.toBe(`/mailbox/${encodeURIComponent(app.account.mailbox)}/emails/inbox`);
	await expect(compose(page).getByText("down", { exact: true })).toBeVisible();
	await expect(compose(page).getByLabel("Subject")).toHaveValue(
		"Second: a message that cannot move",
	);
	await expect(compose(page).locator(".ProseMirror")).toContainText(
		"Words that stay with their mailbox.",
	);
	expect(app.watch.errors.filter((one) => !/503|"event":"ui\.mutation_failed"/.test(one))).toEqual(
		[],
	);
});

test("a file still on its way keeps the message open until it has arrived, and the draft then has it", async ({
	page,
	app,
}) => {
	let release = () => {};
	const held = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route(/\/drafts\/[^/]+\/attachments\/[^/]+$/, async (route) => {
		if (route.request().method() !== "PUT") return route.fallback();
		await held;
		await route.continue().catch(() => {});
	});
	await page.goto(`/mailbox/${encodeURIComponent(app.account.mailbox)}/emails/inbox`);
	await page.getByRole("button", { name: "Compose" }).first().click();
	await writeFirst(page, "Second: a message with a file on its way", "Words and a file.");
	await compose(page)
		.getByLabel("Files to attach")
		.setInputFiles([{ name: "plan.txt", mimeType: "text/plain", buffer: Buffer.from("the plan") }]);
	const attached = compose(page).getByRole("list", { name: "Attached files" });
	await expect(attached.getByRole("listitem")).toHaveCount(1);

	// While the file travels, the next message does not begin, and the window says why.
	await page.getByRole("button", { name: "Compose" }).first().click();
	await expect(compose(page).getByText("Wait until the files are attached.")).toBeVisible();
	await expect(compose(page).getByLabel("Subject")).toHaveValue(
		"Second: a message with a file on its way",
	);

	// Once it has arrived, the next message begins and the first draft holds the file.
	release();
	await expect(attached.getByRole("listitem").filter({ hasText: "plan.txt" })).toContainText("8 B");
	await page.getByRole("button", { name: "Compose" }).first().click();
	await expect(compose(page).getByLabel("Subject")).toHaveValue("");
	await expectKept(
		page,
		"Second: a message with a file on its way",
		"Words and a file.",
		"plan.txt",
	);
});
