// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Tier 6: attachments in a real browser (rule S5). A file is always a download and never a
 * page; one that can do harm is handed over only after the reader has read why and asked.
 */
import { readFileSync } from "node:fs";
import { expect, mime, test } from "./fixtures.ts";

const SUBJECT = "Attachments: four files";
const HOSTILE_PAGE =
	'<script>parent.postMessage({pwned:true},"*");document.title="pwned"</script><h1>Sign in</h1>';

test.beforeAll(async () => {
	// Delivered once for the tests below; `app` is per test, so this goes straight to the server.
	const account = JSON.parse(
		readFileSync(new URL("../../.e2e/account.json", import.meta.url), "utf8"),
	) as { mailbox: string };
	const raw = mime({
		subject: SUBJECT,
		to: account.mailbox,
		html: "<p>Four files attached.</p>",
		parts: [
			{ filename: "notes.txt", type: "text/plain", content: "some notes" },
			{ filename: "setup.exe", type: "application/octet-stream", content: "MZ not a real program" },
			{ filename: "page.html", type: "text/html", content: HOSTILE_PAGE },
			{ filename: "invoice.pdf", type: "text/html", content: HOSTILE_PAGE },
		],
	});
	const res = await fetch(
		`http://localhost:4174/cdn-cgi/local/email?from=ada@sender.test&to=${encodeURIComponent(account.mailbox)}`,
		{ method: "POST", body: raw },
	);
	expect(res.status).toBe(200);
});

test("a plain file downloads from its link", async ({ page, app }) => {
	await app.signIn();
	await app.openMessage(SUBJECT);
	const started = page.waitForEvent("download");
	await page.getByRole("link", { name: /notes\.txt/ }).click();
	const download = await started;
	expect(download.suggestedFilename()).toBe("notes.txt");
	expect(readFileSync(await download.path(), "utf8")).toBe("some notes");
});

test("a file that can do harm is marked, explained, and downloaded only when asked for", async ({
	page,
	app,
}) => {
	await app.signIn();
	await app.openMessage(SUBJECT);

	// Three of the four are marked: the program, the page, and the page that calls itself a PDF.
	for (const name of ["setup.exe", "page.html", "invoice.pdf"]) {
		await expect(
			page.getByRole("button", { name: new RegExp(name.replace(".", "\\.")) }),
		).toBeVisible();
	}

	await page.getByRole("button", { name: /setup\.exe/ }).click();
	const dialog = page.getByRole("alertdialog");
	await expect(dialog.getByText("This file can do harm")).toBeVisible();
	await expect(dialog.getByText("This is a program.")).toBeVisible();

	// Reading the warning downloads nothing; neither does closing it.
	let downloads = 0;
	page.on("download", () => {
		downloads += 1;
	});
	await dialog.getByRole("button", { name: "Cancel" }).click();
	await expect(dialog).toBeHidden();
	await page.waitForTimeout(500);
	expect(downloads).toBe(0);

	await page.getByRole("button", { name: /setup\.exe/ }).click();
	const started = page.waitForEvent("download");
	await page.getByRole("alertdialog").getByRole("button", { name: "Download anyway" }).click();
	const download = await started;
	expect(download.suggestedFilename()).toBe("setup.exe");
	expect(readFileSync(await download.path(), "utf8")).toBe("MZ not a real program");
	await expect(page.getByRole("alertdialog")).toBeHidden();
});

test("an attachment never opens as a page, whatever it contains and however it is asked for", async ({
	page,
	app,
}) => {
	await app.signIn();
	const mailbox = encodeURIComponent(app.account.mailbox);
	const list = (await (
		await page.request.get(`/api/v1/mailboxes/${mailbox}/emails?folder=inbox`)
	).json()) as {
		emails: { id: string; subject: string }[];
	};
	const emailId = list.emails.find((e) => e.subject === SUBJECT)?.id ?? "";
	const email = (await (
		await page.request.get(`/api/v1/mailboxes/${mailbox}/emails/${emailId}`)
	).json()) as {
		attachments: { id: string; filename: string }[];
	};
	const url = (name: string) =>
		`/api/v1/mailboxes/${mailbox}/emails/${emailId}/attachments/${email.attachments.find((a) => a.filename === name)?.id}`;

	// Typed into the address bar, a risky attachment is a refusal in JSON, not the file.
	for (const name of ["page.html", "invoice.pdf", "setup.exe"]) {
		const response = await page.goto(url(name));
		expect(response?.status(), name).toBe(409);
		expect(response?.headers()["content-type"], name).toContain("application/json");
		expect(await page.title(), name).not.toBe("pwned");
		expect(await page.locator("h1").count(), name).toBe(0);
	}

	// A plain one typed into the address bar is a download: the tab shows nothing of it.
	const started = page.waitForEvent("download");
	await page.goto(url("notes.txt")).catch(() => undefined);
	expect((await started).suggestedFilename()).toBe("notes.txt");

	// And when a risky one is handed over, it is bytes: the same file, with a type no browser runs.
	const handed = await page.request.post(`${url("page.html")}/download`, {
		headers: { origin: "http://localhost:4174" },
		data: { acknowledged: true },
	});
	expect(handed.status()).toBe(200);
	expect(handed.headers()["content-type"]).toBe("application/octet-stream");
	expect(handed.headers()["content-disposition"]).toMatch(/^attachment;/);
	expect(handed.headers()["content-security-policy"]).toContain("sandbox");
	expect(await handed.text()).toBe(HOSTILE_PAGE);

	expect((await app.seen()).messages).toEqual([]);
	expect(await app.contacted()).toEqual([]);
});
