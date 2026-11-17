// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Tier 6: a person looks after their own account (rule S10): they see where they are signed
 * in, end a browser they no longer use, and change their password, which signs every other
 * browser out and retires the old password.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

const GRACE = {
	email: "grace@example.com",
	name: "Grace",
	password: "a long passphrase for grace",
};
const NEW_PASSWORD = "another long passphrase for grace";

async function signInWithPassword(page: Page, email: string, password: string): Promise<void> {
	await page.goto("/sign-in");
	await page.getByLabel("Email").fill(email);
	await page.getByLabel("Password").fill(password);
	await page.getByRole("button", { name: "Sign in" }).click();
}

test("a person sees where they are signed in, ends another browser, and changes their password", async ({
	page,
	browser,
	app,
	baseURL,
}) => {
	test.setTimeout(120_000);

	// The owner invites the person; the link gives them an account and a first browser.
	await signInWithPassword(page, app.account.email, app.account.password);
	await expect(page.getByRole("heading", { name: "Mailboxes", exact: true })).toBeVisible();
	await page.locator("#invite-email").fill(GRACE.email);
	await page.getByRole("button", { name: "Create invitation" }).click();
	const link = (await page.locator("code", { hasText: "/accept/" }).textContent()) ?? "";

	const first = await browser.newContext({ baseURL });
	const laptop = await first.newPage();
	await laptop.goto(link);
	await laptop.getByLabel("Your name").fill(GRACE.name);
	await laptop.getByLabel("Password").fill(GRACE.password);
	await laptop.getByRole("button", { name: "Create account" }).click();
	await expect(laptop.getByText(`Signed in as ${GRACE.email}`)).toBeVisible();

	// A second browser of the same person.
	const second = await browser.newContext({ baseURL });
	const phone = await second.newPage();
	await signInWithPassword(phone, GRACE.email, GRACE.password);
	await expect(phone.getByText(`Signed in as ${GRACE.email}`)).toBeVisible();

	await test.step("the sessions are listed, this browser marked, and the other one ended", async () => {
		await laptop.goto("/account/security");
		await laptop.getByRole("button", { name: "Show my sessions" }).click();
		const sessions = laptop.getByRole("listitem").filter({ hasText: "Signed in" });
		await expect(sessions).toHaveCount(2);
		await expect(sessions.filter({ hasText: "This browser" })).toHaveCount(1);
		// What ends a session is never on the page.
		expect(await laptop.content()).not.toMatch(/token/i);

		await laptop.getByRole("button", { name: /^End the session of / }).click();
		await expect(laptop.getByText("You are signed in nowhere else.")).toBeVisible();
		await expect(sessions).toHaveCount(1);

		// The other browser is signed out. Its cookie may hold a copy of the session for up to
		// a minute; without the copy it is asked at once.
		await second.clearCookies({ name: /session_data/ });
		await phone.goto("/");
		await expect(phone.getByRole("heading", { name: "Sign in" })).toBeVisible();
	});

	await test.step("the password is changed, and only the new one signs in", async () => {
		await signInWithPassword(phone, GRACE.email, GRACE.password);
		await expect(phone.getByText(`Signed in as ${GRACE.email}`)).toBeVisible();

		// Two passwords that differ are caught before anything is sent.
		await laptop.getByLabel("Current password").fill(GRACE.password);
		await laptop.getByLabel("New password", { exact: true }).fill(NEW_PASSWORD);
		await laptop.getByLabel("The same password again").fill(`${NEW_PASSWORD}?`);
		await laptop.getByRole("button", { name: "Change password" }).click();
		await expect(laptop.getByText("The two passwords are not the same.")).toBeVisible();

		await laptop.getByLabel("The same password again").fill(NEW_PASSWORD);
		await laptop.getByRole("button", { name: "Change password" }).click();
		await expect(
			laptop.getByText("Your password is changed. Every other browser was signed out."),
		).toBeVisible();
		// The fields hold nothing afterwards.
		await expect(laptop.getByLabel("Current password")).toHaveValue("");
		await expect(laptop.getByLabel("New password", { exact: true })).toHaveValue("");

		// This browser stays in; the other one is out.
		await laptop.goto("/");
		await expect(laptop.getByText(`Signed in as ${GRACE.email}`)).toBeVisible();
		await second.clearCookies({ name: /session_data/ });
		await phone.goto("/");
		await expect(phone.getByRole("heading", { name: "Sign in" })).toBeVisible();

		// The old password is retired, the new one works.
		await signInWithPassword(phone, GRACE.email, GRACE.password);
		await expect(
			phone.getByText("That email and password do not match an account here."),
		).toBeVisible();
		await signInWithPassword(phone, GRACE.email, NEW_PASSWORD);
		await expect(phone.getByText(`Signed in as ${GRACE.email}`)).toBeVisible();
	});

	await first.close();
	await second.close();
});
