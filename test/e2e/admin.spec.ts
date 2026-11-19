// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Tier 6: the administration area (#127). Whoever may manage the instance finds it from their
 * mailboxes, with a rail of its parts and the way back to mail; People lists everyone and the
 * invitations, invites a person and withdraws an invitation. A person who only has a mailbox
 * sees no way in, and the area's addresses answer as not found.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

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
	await page.getByRole("link", { name: "Administration" }).click();

	await expect(page).toHaveURL(/\/admin\/people$/);
	await expect(page.getByRole("heading", { name: "Administration", level: 1 })).toBeVisible();
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
	for (const address of ["/admin", "/admin/people"]) {
		await theirs.goto(address);
		await expect(theirs.getByText("404 -- Page Not Found"), address).toBeVisible();
		await expect(theirs.getByRole("table")).toHaveCount(0);
	}
	await context.close();
});
