// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { MAIL_FRAME_SCRIPT } from "../../shared/mail-frame.ts";
/**
 * Tier 6: the response headers and the content policies, in a real browser (rules S4, S11).
 */
import { API_HEADERS, PAGE_HEADERS } from "../../shared/security-headers.ts";
import { expect, test } from "./fixtures.ts";

test("pages and assets carry the page's headers, API answers the API's", async ({ page }) => {
	const document = await page.goto("/sign-in");
	for (const [name, value] of Object.entries(PAGE_HEADERS)) {
		expect(document?.headers()[name.toLowerCase()], name).toBe(value);
	}
	const script = await page.locator('script[type="module"]').first().getAttribute("src");
	const asset = await page.request.get(script ?? "");
	expect(asset.status()).toBe(200);
	expect(asset.headers()["content-security-policy"]).toBe(PAGE_HEADERS["Content-Security-Policy"]);

	const api = await page.request.get("/api/setup/status");
	for (const [name, value] of Object.entries(API_HEADERS)) {
		expect(api.headers()[name.toLowerCase()], name).toBe(value);
	}
});

test("no page of the app breaks its own content policy", async ({ page, app }) => {
	await page.goto("/sign-in");
	await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
	expect((await app.seen()).violations, "the sign-in page").toEqual([]);

	await app.signIn();
	const mailbox = encodeURIComponent(app.account.mailbox);
	const pages: [string, string][] = [
		["/", "Mailboxes"],
		[`/mailbox/${mailbox}/emails/inbox`, "Inbox"],
		[`/mailbox/${mailbox}/settings`, "Settings"],
		[`/members/${mailbox}`, "Members"],
		["/account/security", "Sign-in and security"],
	];
	for (const [path, heading] of pages) {
		await page.goto(path);
		await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible();
		expect((await app.seen()).violations, path).toEqual([]);
	}
	// Writing a message opens the rich text editor, the part of the app closest to raw markup.
	await page.goto(`/mailbox/${mailbox}/emails/inbox`);
	await page.getByRole("button", { name: "Compose" }).first().click();
	await page.locator('[contenteditable="true"]').first().click();
	await page.keyboard.type("Typed under the content policy");
	expect((await app.seen()).violations, "the editor").toEqual([]);

	expect(await app.contacted(), "hosts the browser tried to reach").toEqual([]);
	expect(app.watch.errors.filter((e) => /Content Security Policy|Refused to/i.test(e))).toEqual([]);
});

/**
 * The page's policy is the last line for the mail frame: a `srcdoc` frame inherits it. Here the
 * sanitiser is left out on purpose. A frame is built by hand, with a policy of its own that
 * would let a script with the right nonce run, and the page's policy must still stop every
 * script but the one whose hash it names.
 */
test("the page's policy runs one inline script in a frame and no other", async ({ page, app }) => {
	await app.signIn();
	await page.goto("/");
	const tryScript = (script: string) =>
		page.evaluate(async (source) => {
			const received: unknown[] = [];
			const frame = document.createElement("iframe");
			frame.setAttribute("sandbox", "allow-scripts");
			const listen = (event: MessageEvent) => {
				if (event.source === frame.contentWindow) received.push(event.data);
			};
			window.addEventListener("message", listen);
			frame.srcdoc = `<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-bm9uY2Utbm9uY2Utbm9uY2U='"></head><body><p style="height:240px">x</p><script nonce="bm9uY2Utbm9uY2Utbm9uY2U=">${source}</scr${""}ipt></body></html>`;
			document.body.appendChild(frame);
			await new Promise((resolve) => setTimeout(resolve, 900));
			window.removeEventListener("message", listen);
			frame.remove();
			return received;
		}, script);

	const sizing = await tryScript(MAIL_FRAME_SCRIPT);
	expect(sizing.length).toBeGreaterThan(0);
	expect(sizing[0]).toEqual({ __emailIframeHeight: true, height: 240 });

	expect(await tryScript('parent.postMessage({ hostile: true }, "*");')).toEqual([]);
	expect(
		await tryScript(`${MAIL_FRAME_SCRIPT}parent.postMessage({ hostile: true }, "*");`),
	).toEqual([]);
});
