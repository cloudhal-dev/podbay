// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Tier 6: the administration area (#127). Whoever may manage the instance finds it from their
 * mailboxes, with a rail of its parts and the way back to mail; People lists everyone and the
 * invitations, invites a person and withdraws an invitation; Mailboxes lists every mailbox, makes
 * one, and has a page for each with its members, the record of their changes and deleting it. A
 * person who only has a mailbox sees no way in, and the area's addresses answer as not found;
 * the old members address keeps working for a mailbox's own owner.
 */
import type { Page } from "@playwright/test";
import { BASE, expect, makeMailbox, test } from "./fixtures.ts";

/** The path of the page now, decoded, to compare as text. */
const pathNow = (page: Page) => decodeURIComponent(new URL(page.url()).pathname);

/** Invites a person from People and returns the link shown once. */
async function invite(page: Page, email: string): Promise<string> {
	await page.locator("#invite-email").fill(email);
	await page.getByRole("button", { name: "Create invitation" }).click();
	return (await page.locator("code", { hasText: "/accept/" }).textContent()) ?? "";
}

test("an owner opens the administration area from their mailboxes, and People lists, invites and withdraws", async ({
	page,
	app,
}) => {
	// The run's one session, kept fresh enough for inviting (session.ts); signing in through the
	// page is for tests about signing in, and is limited per address.
	await app.signIn();
	await page.goto("/");
	await expect(page.getByRole("heading", { name: "Mailboxes", exact: true })).toBeVisible();
	// What moved is no longer on the page of a person's mailboxes.
	await expect(page.getByRole("heading", { name: "People", exact: true })).toHaveCount(0);
	await expect(page.getByRole("heading", { name: "All mailboxes" })).toHaveCount(0);
	await expect(page.getByRole("button", { name: "New Mailbox" })).toHaveCount(0);
	await page.getByRole("link", { name: "Administration" }).click();

	await expect(page).toHaveURL(/\/admin\/people$/);
	await expect(page.getByRole("heading", { name: "Administration", level: 1 })).toBeVisible();
	await expect(page).toHaveTitle("People - Administration - Podbay");
	// The person's own account is in the area's bar, as it is in the mail screens'.
	await expect(page.getByRole("button", { name: "Sign-in and security" })).toBeVisible();
	const rail = page.getByRole("navigation", { name: "Administration" });
	await expect(rail.getByRole("link", { name: "People" })).toHaveAttribute("aria-current", "page");

	const people = page.getByRole("table", { name: "People" });
	await expect(people.getByRole("row").filter({ hasText: app.account.email })).toContainText(
		"Owner",
	);

	const invited = `invited-${Date.now()}@example.com`;
	expect(await invite(page, invited)).toContain("/accept/");
	const invitations = page.getByRole("table", { name: "Invitations" });
	const line = invitations.getByRole("row").filter({ hasText: invited });
	await expect(line).toContainText("Waiting");

	await line.getByRole("button", { name: `Withdraw the invitation of ${invited}` }).click();
	const asking = page.getByRole("alertdialog", { name: "Withdraw the invitation?" });
	await asking.getByRole("button", { name: "Withdraw" }).click();
	await expect(line).toContainText("Withdrawn");
	await expect(line.getByRole("button")).toHaveCount(0);

	// The way back to mail is always there.
	await page.getByRole("link", { name: "Back to mail" }).click();
	await expect(page.getByRole("heading", { name: "Mailboxes", exact: true })).toBeVisible();
	// The area opens on People, and its addresses can be linked to.
	await page.goto("/admin");
	await expect(page).toHaveURL(/\/admin\/people$/);
});

test("a person who only has a mailbox sees no way into the area, and its addresses answer as not found", async ({
	page,
	browser,
	app,
	baseURL,
}) => {
	await app.signIn();
	await page.goto("/admin/people");
	const person = { email: `member-${Date.now()}@example.com`, password: "a long passphrase here" };
	const link = await invite(page, person.email);

	const context = await browser.newContext({ baseURL });
	const theirs = await context.newPage();
	await theirs.goto(link);
	await theirs.getByLabel("Your name").fill("A member");
	await theirs.getByLabel("Password").fill(person.password);
	await theirs.getByRole("button", { name: "Create account" }).click();
	await expect(theirs.getByText(`Signed in as ${person.email}`)).toBeVisible();

	await expect(theirs.getByRole("link", { name: "Administration" })).toHaveCount(0);
	for (const address of ["/admin", "/admin/people", "/admin/mailboxes"]) {
		await theirs.goto(address);
		await expect(theirs.getByText("404 -- Page Not Found"), address).toBeVisible();
		await expect(theirs.getByRole("table")).toHaveCount(0);
	}

	// An owner of a mailbox who does not manage the instance keeps its members at the old address.
	const theirMailbox = await makeMailbox(page, `owned-${Date.now()}@example.com`, "Owned");
	const added = await page.request.post(
		`${BASE}/api/v1/mailboxes/${encodeURIComponent(theirMailbox)}/members`,
		{ data: { email: person.email, role: "owner" }, headers: { origin: BASE } },
	);
	expect(added.ok(), "the member is made an owner of the mailbox").toBe(true);
	await theirs.goto(`/members/${encodeURIComponent(theirMailbox)}`);
	await expect(theirs.getByRole("heading", { name: "Members", level: 1 })).toBeVisible();
	await expect(theirs.getByRole("heading", { name: "Who has access" })).toBeVisible();
	await expect(theirs).toHaveURL(/\/members\//);
	await context.close();
});

test("Mailboxes lists every mailbox, makes one, and has a page for each with its members and deleting it", async ({
	page,
	app,
}) => {
	await app.signIn();
	await page.goto("/admin");
	await page
		.getByRole("navigation", { name: "Administration" })
		.getByRole("link", { name: "Mailboxes" })
		.click();
	await expect(page).toHaveURL(/\/admin\/mailboxes$/);
	await expect(page).toHaveTitle("Mailboxes - Administration - Podbay");
	const list = page.getByRole("table", { name: "Mailboxes" });
	await expect(list.getByRole("row").filter({ hasText: app.account.mailbox })).toContainText(
		"You are a member",
	);

	// Making one.
	const prefix = `made-${Date.now()}`;
	const made = `${prefix}@example.com`;
	await page.getByRole("button", { name: "New Mailbox" }).click();
	const dialog = page.getByRole("dialog", { name: "Create a mailbox" });
	await dialog.getByRole("textbox", { name: "Address prefix" }).fill(prefix);
	await dialog.getByRole("textbox", { name: "Display Name (optional)" }).fill("Made here");
	await dialog.getByRole("button", { name: "Create" }).click();
	await expect(dialog).toBeHidden();
	await list.getByRole("link", { name: made }).click();

	// Its page: what it is, who its members are, the record, deleting it.
	await expect.poll(() => pathNow(page)).toBe(`/admin/mailboxes/${made}`);
	await expect(page).toHaveTitle(`${made} - Mailboxes - Administration - Podbay`);
	await expect(page.getByRole("heading", { name: made })).toBeVisible();
	await expect(page.getByText("Made here")).toBeVisible();
	await expect(page.getByRole("heading", { name: "Who has access" })).toBeVisible();
	await expect(page.getByRole("heading", { name: "Record of changes" })).toBeVisible();
	await page.getByRole("button", { name: "Delete mailbox" }).click();
	const asking = page.getByRole("alertdialog", { name: "Delete this mailbox?" });
	await asking.getByRole("button", { name: "Delete" }).click();
	await expect(page).toHaveURL(/\/admin\/mailboxes$/);
	await expect(list.getByRole("link", { name: made })).toHaveCount(0);

	// The old members address takes a manager to the mailbox's page.
	await page.goto(`/members/${encodeURIComponent(app.account.mailbox)}`);
	await expect.poll(() => pathNow(page)).toBe(`/admin/mailboxes/${app.account.mailbox}`);
	await expect(page.getByRole("heading", { name: "Who has access" })).toBeVisible();
});
