// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Tier 6: a person's way in, end to end in a real browser (rule S10): invited by the owner,
 * an authenticator app, a passkey, and being asked again before a sensitive change.
 *
 * The authenticator app is computed here from the secret the page shows. The passkey is
 * Chrome's own virtual authenticator, so the browser's real WebAuthn code runs on both sides.
 */
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

const ADA = { email: "ada@example.com", name: "Ada", password: "a long passphrase for ada" };
const root = fileURLToPath(new URL("../..", import.meta.url));

/** The code an authenticator app shows for this secret at a time, now by default (RFC 6238). */
function totp(secret: string, at = Date.now()): string {
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
	let bits = "";
	for (const char of secret) bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
	const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => Number.parseInt(b, 2)));
	const counter = Buffer.alloc(8);
	counter.writeUInt32BE(Math.floor(at / 30_000), 4);
	const mac = createHmac("sha1", key).update(counter).digest();
	const offset = (mac[19] ?? 0) & 0x0f;
	return ((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0");
}

async function signInWithPassword(page: Page, email: string, password: string): Promise<void> {
	await page.goto("/sign-in");
	await page.getByLabel("Email").fill(email);
	await page.getByLabel("Password").fill(password);
	await page.getByRole("button", { name: "Sign in" }).click();
}

async function signOut(page: Page): Promise<void> {
	await page.goto("/");
	await page.getByRole("button", { name: "Sign out" }).click();
	await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
}

test("a person is invited, adds an authenticator app and a passkey, and is asked again before a sensitive change", async ({
	page,
	browser,
	app,
}) => {
	test.setTimeout(180_000);
	let secret = "";
	let turnedOnWith = "";

	const invitation =
		await test.step("the owner invites a person and gets a link to pass on", async () => {
			await signInWithPassword(page, app.account.email, app.account.password);
			await expect(page.getByRole("heading", { name: "Mailboxes", exact: true })).toBeVisible();
			await page.locator("#invite-email").fill(ADA.email);
			await page.getByRole("button", { name: "Create invitation" }).click();
			const link = (await page.locator("code", { hasText: "/accept/" }).textContent()) ?? "";
			expect(link).toMatch(/^http:\/\/localhost:4174\/accept\/[\w-]{40,}$/);
			return link;
		});

	// The invited person has a browser of their own.
	const context = await browser.newContext();
	const ada = await context.newPage();

	await test.step("the link gives them an account and signs them in", async () => {
		await ada.goto(invitation);
		await expect(ada.getByText(ADA.email)).toBeVisible();
		await ada.getByLabel("Your name").fill(ADA.name);
		await ada.getByLabel("Password").fill(ADA.password);
		await ada.getByRole("button", { name: "Create account" }).click();
		await expect(ada.getByText(`Signed in as ${ADA.email}`)).toBeVisible();
		// The link worked once.
		const again = await context.newPage();
		await again.goto(invitation);
		await expect(again.getByText("This link is not valid any more")).toBeVisible();
		await again.close();
	});

	await test.step("they turn on an authenticator app and keep the recovery codes", async () => {
		await ada.getByRole("link", { name: "Sign-in and security" }).click();
		await ada.getByLabel("Your password").fill(ADA.password);
		await ada.getByRole("button", { name: "Set up an authenticator app" }).click();
		await expect(
			ada.getByRole("img", { name: "QR code for your authenticator app" }),
		).toBeVisible();
		secret =
			(await ada
				.locator("code")
				.filter({ hasText: /^[A-Z2-7]{16,}$/ })
				.textContent()) ?? "";
		turnedOnWith = totp(secret);
		await ada.getByLabel("Code from the app").fill(turnedOnWith);
		await ada.getByRole("button", { name: "Turn on" }).click();
		await expect(ada.getByText("Save these recovery codes")).toBeVisible();
		expect(await ada.locator("code span").count()).toBeGreaterThanOrEqual(8);
		await ada.getByRole("button", { name: "I have saved them" }).click();
		await expect(ada.getByText("On", { exact: true })).toBeVisible();
	});

	await test.step("from then on the password alone does not sign them in", async () => {
		await signOut(ada);
		await signInWithPassword(ada, ADA.email, ADA.password);
		const code = ada.getByLabel("Code from your authenticator app");
		await expect(code).toBeVisible();
		await expect(code).toBeFocused();
		expect((await ada.request.get("/api/v1/me")).status()).toBe(401);

		// A code is used once: the one that turned the app on a moment ago signs nobody in, and is
		// told as any wrong code is. One wrong try only: the sign-in library limits the requests to
		// the second step in ten seconds, turning the app on counts, and a fifth is refused (429).
		await code.fill(turnedOnWith);
		const answered = ada.waitForResponse((res) => res.url().endsWith("/two-factor/verify-totp"));
		await ada.getByRole("button", { name: "Continue" }).click();
		expect((await answered).status()).toBe(401);
		await expect(ada.getByRole("alert")).toBeVisible();
		expect((await ada.request.get("/api/v1/me")).status()).toBe(401);

		// The app's next code is accepted, and is never the one already used.
		await code.fill(totp(secret, Date.now() + 30_000));
		await ada.getByRole("button", { name: "Continue" }).click();
		await expect(ada.getByText(`Signed in as ${ADA.email}`)).toBeVisible();
	});

	await test.step("they add a passkey, which then signs them in by itself", async () => {
		const cdp = await context.newCDPSession(ada);
		await cdp.send("WebAuthn.enable");
		await cdp.send("WebAuthn.addVirtualAuthenticator", {
			options: {
				protocol: "ctap2",
				transport: "internal",
				hasResidentKey: true,
				hasUserVerification: true,
				isUserVerified: true,
				automaticPresenceSimulation: true,
			},
		});
		await ada.goto("/account/security");
		await ada.getByLabel("Name for a new passkey").fill("Laptop");
		await ada.getByRole("button", { name: "Add a passkey" }).click();
		await expect(ada.getByRole("listitem").filter({ hasText: "Laptop" })).toBeVisible();

		await signOut(ada);
		await ada.getByRole("button", { name: "Use a passkey" }).click();
		// No code is asked: the passkey is the whole sign-in.
		await expect(ada.getByText(`Signed in as ${ADA.email}`)).toBeVisible();
	});

	await test.step("an older session is asked to confirm before a sensitive change", async () => {
		// Ten minutes pass: every session in the instance is made to look eleven minutes old.
		const old = new Date(Date.now() - 11 * 60_000).toISOString();
		execFileSync(
			"pnpm",
			[
				"exec",
				"wrangler",
				"d1",
				"execute",
				"DB",
				"--local",
				"--persist-to",
				".e2e/state",
				"--command",
				`update "session" set "createdAt" = '${old}'`,
			],
			{
				cwd: root,
				stdio: "ignore",
				env: { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" },
			},
		);
		// The copy of the session cached in the cookie runs out within a minute; here, at once.
		const cached = (await context.cookies()).filter((c) => c.name.includes("session_data"));
		await context.clearCookies({ name: cached[0]?.name ?? "none" });

		await ada.goto("/account/security");
		await ada.getByRole("button", { name: "Turn off" }).click();
		await ada.getByLabel("Your password").fill(ADA.password);
		await ada.getByRole("button", { name: "Turn off the second step" }).click();

		const dialog = ada.getByRole("dialog");
		await expect(dialog.getByText("Confirm it is you")).toBeVisible();
		await expect(dialog.getByText(ADA.email)).toBeVisible();
		// Nothing changed yet.
		expect(
			(
				(await (await ada.request.get("/api/v1/me")).json()) as {
					security: { authenticatorApp: boolean };
				}
			).security.authenticatorApp,
		).toBe(true);

		await dialog.getByRole("button", { name: "Use a passkey" }).click();
		await expect(dialog).toBeHidden();
		// The change that was refused went through after the confirmation, without being asked twice.
		await expect(ada.getByRole("button", { name: "Set up an authenticator app" })).toBeVisible();
	});

	await context.close();
});
