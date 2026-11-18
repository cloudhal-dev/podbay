// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Tier 6: a mailbox has rules for its incoming mail (ADR-0008), as a person meets them.
 *
 * - a filter is made in the settings, files mail that arrives from then on, and is deleted;
 * - "Block the sender" on a message sends that sender's next mail to Spam, and unblocking in
 *   the settings ends it;
 * - "Filter messages like this" opens a new filter that starts with the sender;
 * - the automatic reply is turned on in the settings, answers a person once in the mailbox's
 *   own name, and stops when it is turned off.
 *
 * The tests have a mailbox of their own: a blocked sender or an automatic reply in the mailbox
 * the other tests share would change what they see.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { BASE, expect, test } from "./fixtures.ts";

const MAILBOX = "rules@example.com";
const box = encodeURIComponent(MAILBOX);
const api = (path: string) => `/api/v1/mailboxes/${box}${path}`;
const place = (name: string) => `/mailbox/${box}/emails/${name}`;
const settings = (tab: string) => `/mailbox/${box}/settings?tab=${tab}`;
const row = (page: Page, subject: string) =>
	page.getByRole("button", { name: new RegExp(subject) });

let sequence = 0;
/** A word no other test uses, so that a filter of this test matches this test's mail only. */
const unique = (word: string) => `${word}${Date.now().toString(36)}${++sequence}`;

/** Delivers a message to the mailbox of these tests. `envelope` is who a reply would go to. */
async function arrives(message: { from: string; subject: string; envelope?: string }) {
	const raw = [
		`From: ${message.from}`,
		`To: ${MAILBOX}`,
		`Subject: ${message.subject}`,
		`Message-ID: <${unique("rules")}@sender.test>`,
		"MIME-Version: 1.0",
		"Content-Type: text/plain; charset=utf-8",
		"",
		"Words of a message that arrived.",
		"",
	].join("\r\n");
	const envelope = encodeURIComponent(message.envelope ?? "ada@sender.test");
	const res = await fetch(`${BASE}/cdn-cgi/local/email?from=${envelope}&to=${box}`, {
		method: "POST",
		body: raw,
	});
	expect(res.status, "delivering a message").toBe(200);
}

interface Listed {
	id: string;
	subject: string;
	recipient: string;
}
/** The messages of a place, as the API shows them to the signed-in person. */
async function listed(page: Page, folder: string): Promise<Listed[]> {
	const res = await page.request.get(api(`/emails?folder=${folder}`));
	return ((await res.json()) as { emails: Listed[] }).emails;
}
const subjects = async (page: Page, folder: string) =>
	(await listed(page, folder)).map((email) => email.subject);

test.beforeAll(async () => {
	const session = fileURLToPath(new URL("../../.e2e/session.json", import.meta.url));
	const { cookie } = JSON.parse(readFileSync(session, "utf8")) as { cookie: string };
	const made = await fetch(`${BASE}/api/v1/mailboxes`, {
		method: "POST",
		headers: { cookie, origin: BASE, "content-type": "application/json" },
		body: JSON.stringify({ email: MAILBOX, name: "Rules" }),
	});
	expect([201, 409], "making the mailbox of these tests").toContain(made.status);
});

test.beforeEach(async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 800 });
});

test.afterEach(async ({ page }) => {
	// What a test made is taken back, so the next starts with a mailbox without rules.
	const held = (await (await page.request.get(api("/rules"))).json()) as {
		rules?: unknown[];
		blocked?: { sender: string }[];
	};
	if ((held.rules ?? []).length > 0) {
		await page.request.put(api("/rules"), { data: { rules: [] }, headers: { origin: BASE } });
	}
	for (const one of held.blocked ?? []) {
		await page.request.delete(api("/blocked-senders"), {
			data: { sender: one.sender },
			headers: { origin: BASE },
		});
	}
});

test("a filter made in the settings files mail that arrives from then on, and is deleted there", async ({
	page,
	app,
}) => {
	await app.signIn();
	const word = unique("invoice");
	await arrives({ from: "Ada <ada@sender.test>", subject: `${word} before the filter` });

	await page.goto(settings("filters"));
	await expect(page.getByText("This mailbox has no filters yet.")).toBeVisible();
	await page.getByRole("button", { name: "New filter" }).click();
	const dialog = page.getByRole("dialog", { name: "New filter" });
	// A filter needs something to look for and something to do before it can be made.
	await expect(dialog.getByRole("button", { name: "Create filter" })).toBeDisabled();
	await dialog.getByLabel("The subject contains").fill(word.toUpperCase());
	await expect(dialog.getByText("Say at least one thing the filter does.")).toBeVisible();
	await dialog.getByLabel("Where it goes").selectOption({ label: "Skip the Inbox" });
	await dialog.getByLabel("Star it").check();
	await dialog.getByRole("button", { name: "Create filter" }).click();
	await expect(dialog).toBeHidden();

	// The filter is listed in words, with what it looks for and what it does.
	await expect(page.getByText(`The subject contains ${word.toUpperCase()}`)).toBeVisible();
	await expect(page.getByText("Skip the Inbox")).toBeVisible();
	await expect(page.getByText("Star it")).toBeVisible();

	// Mail that arrives now is filed; what was here before the filter stays where it was.
	await arrives({ from: "Ada <ada@sender.test>", subject: `${word} after the filter` });
	await expect.poll(() => subjects(page, "archive")).toContain(`${word} after the filter`);
	expect(await subjects(page, "inbox")).toContain(`${word} before the filter`);
	expect(await subjects(page, "inbox")).not.toContain(`${word} after the filter`);
	await page.goto(place("archive"));
	await expect(row(page, `${word} after the filter`)).toBeVisible();

	// Deleting it asks first, and deletes no mail.
	await page.goto(settings("filters"));
	await page.getByRole("button", { name: "Delete", exact: true }).click();
	const asking = page.getByRole("alertdialog", { name: "Delete this filter?" });
	await asking.getByRole("button", { name: "Delete filter" }).click();
	await expect(page.getByText("This mailbox has no filters yet.")).toBeVisible();
	await arrives({ from: "Ada <ada@sender.test>", subject: `${word} once it is gone` });
	await expect.poll(() => subjects(page, "inbox")).toContain(`${word} once it is gone`);
	expect(await subjects(page, "archive")).toContain(`${word} after the filter`);

	expect(await app.contacted(), "hosts the browser tried to reach").toEqual([]);
});

test("blocking the sender of a message sends their next mail to Spam, and unblocking ends it", async ({
	page,
	app,
}) => {
	await app.signIn();
	const word = unique("offer");
	const mallory = `mallory-${word}@blocked.test`;
	await arrives({ from: `Mallory <${mallory}>`, subject: `${word} first` });

	await page.goto(place("inbox"));
	await row(page, `${word} first`).click();
	await page.getByRole("button", { name: "More for this message" }).click();
	await page.getByRole("menuitem", { name: "Block the sender", exact: true }).click();
	// The app asks first, in its own dialog, and says what blocking does.
	const asking = page.getByRole("alertdialog", { name: `Block ${mallory}?` });
	await expect(asking.getByText(/will go to Spam when it arrives/)).toBeVisible();
	await asking.getByRole("button", { name: "Block", exact: true }).click();
	await expect(page.getByText(`${mallory} is blocked`)).toBeVisible();

	// What is already here stays; what arrives now goes to Spam; other senders are not touched.
	await arrives({ from: `Mallory <${mallory}>`, subject: `${word} second` });
	await arrives({ from: "Ada <ada@sender.test>", subject: `${word} from someone else` });
	await expect.poll(() => subjects(page, "spam")).toContain(`${word} second`);
	await expect.poll(() => subjects(page, "inbox")).toContain(`${word} from someone else`);
	expect(await subjects(page, "inbox")).toContain(`${word} first`);
	expect(await subjects(page, "inbox")).not.toContain(`${word} second`);
	// The message's menu now offers to unblock in place of blocking.
	await page.goto(place("inbox"));
	await row(page, `${word} first`).click();
	await page.getByRole("button", { name: "More for this message" }).click();
	await expect(page.getByRole("menuitem", { name: "Unblock the sender" })).toBeVisible();
	await expect(page.getByRole("menuitem", { name: "Block the sender", exact: true })).toHaveCount(
		0,
	);
	await page.keyboard.press("Escape");

	// The settings list who is blocked, and unblocking is there.
	await page.goto(settings("filters"));
	const blocked = page.getByRole("region", { name: "Blocked senders" });
	await expect(blocked.getByText(mallory)).toBeVisible();
	await blocked.getByRole("button", { name: "Unblock" }).click();
	await expect(blocked.getByText("This mailbox blocks no sender.")).toBeVisible();
	await arrives({ from: `Mallory <${mallory}>`, subject: `${word} third` });
	await expect.poll(() => subjects(page, "inbox")).toContain(`${word} third`);

	// A whole domain is blocked from the settings, and what is not one is refused in words.
	await blocked.getByLabel("An address or a domain").fill("not an address");
	await blocked.getByRole("button", { name: "Block", exact: true }).click();
	await expect(page.getByText("Give an address, or a domain such as example.com.")).toBeVisible();
	await blocked.getByLabel("An address or a domain").fill("Blocked.test");
	await blocked.getByRole("button", { name: "Block", exact: true }).click();
	await expect(blocked.getByText("Everyone at blocked.test")).toBeVisible();
	await arrives({ from: `Someone <other-${word}@blocked.test>`, subject: `${word} fourth` });
	await expect.poll(() => subjects(page, "spam")).toContain(`${word} fourth`);

	expect(await app.contacted(), "hosts the browser tried to reach").toEqual([]);
});

test("“Filter messages like this” starts a new filter with the sender of the message", async ({
	page,
	app,
}) => {
	await app.signIn();
	const word = unique("news");
	const sender = `news-${word}@letters.test`;
	await arrives({ from: `Letters <${sender}>`, subject: `${word} issue one` });

	await page.goto(place("inbox"));
	await row(page, `${word} issue one`).click();
	await page.getByRole("button", { name: "More for this message" }).click();
	await page.getByRole("menuitem", { name: "Filter messages like this" }).click();
	const dialog = page.getByRole("dialog", { name: "New filter" });
	await expect(dialog.getByLabel("The sender", { exact: true })).toHaveValue(sender);
	await expect(dialog.getByLabel("How the sender is compared")).toHaveValue("is");
	await dialog.getByLabel("Mark as read").check();
	await dialog.getByLabel("Where it goes").selectOption({ label: "Move to Trash" });
	await dialog.getByRole("button", { name: "Create filter" }).click();
	await expect(dialog).toBeHidden();

	await arrives({ from: `Letters <${sender}>`, subject: `${word} issue two` });
	await expect.poll(() => subjects(page, "trash")).toContain(`${word} issue two`);
	// It is in the settings like any filter, said in words.
	await page.goto(settings("filters"));
	await expect(page.getByText(`The sender is ${sender}`)).toBeVisible();
	await expect(page.getByText("Move to Trash")).toBeVisible();
});

test("the automatic reply is turned on in the settings, answers a person once, and stops when it is turned off", async ({
	page,
	app,
}) => {
	// Saving it needs a person who signed in a moment ago, so this test signs in itself.
	await page.goto("/sign-in");
	await page.getByLabel("Email").fill(app.account.email);
	await page.getByLabel("Password").fill(app.account.password);
	await page.getByRole("button", { name: "Sign in" }).click();
	await expect(page.getByRole("heading", { name: "Mailboxes", exact: true })).toBeVisible();

	const subject = unique("Away");
	const asker = `asker-${subject.toLowerCase()}@sender.test`;
	await page.goto(settings("auto-reply"));
	const on = page.getByLabel("Answer mail that arrives");
	await expect(on).not.toBeChecked();
	await on.check();
	// One that is on must say something: the button waits for the message.
	await expect(page.getByRole("button", { name: "Save automatic reply" })).toBeDisabled();
	await page.getByRole("textbox", { name: "Subject" }).fill(subject);
	await page.getByRole("textbox", { name: "Message" }).fill("I am away and will answer on Monday.");
	await page.getByRole("button", { name: "Save automatic reply" }).click();
	await expect(page.getByText("The automatic reply is on")).toBeVisible();

	// Someone writes: they are answered, in the mailbox's own name, and the answer is in Sent.
	await arrives({ from: "Asker <asker@sender.test>", subject: "A question", envelope: asker });
	await expect
		.poll(async () => (await listed(page, "sent")).filter((email) => email.subject === subject))
		.toHaveLength(1);
	const [reply] = (await listed(page, "sent")).filter((email) => email.subject === subject);
	expect(reply?.recipient).toBe(asker);
	await page.goto(place("sent"));
	await row(page, subject).click();
	await expect(
		page
			.frameLocator('iframe[title="Email content"]')
			.getByText("I am away and will answer on Monday."),
	).toBeVisible();

	// They write again: one answer in seven days is all they get.
	await arrives({
		from: "Asker <asker@sender.test>",
		subject: "A second question",
		envelope: asker,
	});
	await expect.poll(() => subjects(page, "inbox")).toContain("A second question");
	await expect.poll(() => listed(page, "scheduled")).toEqual([]);
	expect((await listed(page, "sent")).filter((email) => email.subject === subject)).toHaveLength(1);

	// Turned off, it answers nobody.
	await page.goto(settings("auto-reply"));
	await expect(on).toBeChecked();
	await on.uncheck();
	await page.getByRole("button", { name: "Save automatic reply" }).click();
	await expect(page.getByText("The automatic reply is off")).toBeVisible();
	await arrives({
		from: "Another <another@sender.test>",
		subject: "A third question",
		envelope: `another-${subject.toLowerCase()}@sender.test`,
	});
	await expect.poll(() => subjects(page, "inbox")).toContain("A third question");
	await expect.poll(() => listed(page, "scheduled")).toEqual([]);
	expect((await listed(page, "sent")).filter((email) => email.subject === subject)).toHaveLength(1);

	expect(await app.contacted(), "hosts the browser tried to reach").toEqual([]);
});
