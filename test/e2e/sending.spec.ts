// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Tier 6: outgoing mail waits before it leaves (ADR-0016), as a person meets it.
 *
 * - Send shows Undo for the window the person chose; Undo makes the message a draft again,
 *   with its files, and opens it for writing;
 * - without Undo the message is in Sent after the window, and the app says "sent" only then;
 * - "Send later" puts a message in Scheduled with its time, where it is given a new time,
 *   sent now or cancelled;
 * - a message that could not leave comes back to Drafts with the reason.
 */
import type { Page } from "@playwright/test";
import { BASE, expect, SENT_WITHIN, test } from "./fixtures.ts";

const row = (page: Page, subject: string) =>
	page.getByRole("button", { name: new RegExp(subject) });
const rail = (page: Page, place: RegExp) =>
	page.getByRole("navigation", { name: "Folders" }).getByRole("link", { name: place });

interface Shown {
	folder_id: string;
	attachments: { filename: string }[];
	submission?: { state: string; send_at: string; error: string | null };
}

/** A message of the mailbox, as the API shows it to the signed-in person. */
async function shown(page: Page, mailbox: string, subject: string): Promise<Shown | undefined> {
	const base = `/api/v1/mailboxes/${encodeURIComponent(mailbox)}`;
	for (const folder of ["scheduled", "draft", "sent"]) {
		const listed = (await (await page.request.get(`${base}/emails?folder=${folder}`)).json()) as {
			emails: { id: string; subject: string }[];
		};
		const found = listed.emails.find((email) => email.subject === subject);
		if (found)
			return (await (await page.request.get(`${base}/emails/${found.id}`)).json()) as Shown;
	}
	return undefined;
}

/** Starts a new message with a recipient, a subject and a few words. */
async function write(page: Page, subject: string) {
	await page.getByRole("button", { name: "Compose" }).first().click();
	const compose = page.getByRole("region", { name: "Compose" });
	await compose.getByRole("combobox", { name: "To" }).fill("someone@elsewhere.test");
	await compose.getByLabel("Subject").fill(subject);
	await compose.locator(".ProseMirror").click();
	await page.keyboard.type("Words a person wrote.");
	return compose;
}

test.beforeEach(async ({ page, app }) => {
	await app.signIn();
	await page.setViewportSize({ width: 1280, height: 800 });
	// The shortest window: a person's choice, made where the others are made.
	await page.goto(`/mailbox/${encodeURIComponent(app.account.mailbox)}/settings`);
	const window = page.getByRole("radiogroup", { name: "Undo send" });
	await expect(window.getByLabel("10 seconds")).toBeChecked();
	await window.getByLabel("5 seconds").check();
	await expect(window.getByLabel("5 seconds")).toBeChecked();
});

test("Send offers Undo for the window, and Undo makes the message a draft again with its files", async ({
	page,
	app,
}) => {
	const subject = `Sending ${Date.now()}: taken back`;
	await page.goto(`/mailbox/${encodeURIComponent(app.account.mailbox)}/emails/inbox`);
	const compose = await write(page, subject);
	await compose
		.getByLabel("Files to attach")
		.setInputFiles([{ name: "plan.txt", mimeType: "text/plain", buffer: Buffer.from("the plan") }]);
	const attached = compose.getByRole("list", { name: "Attached files" });
	await expect(attached.getByRole("listitem")).toContainText("8 B");

	await compose.getByRole("button", { name: "Send", exact: true }).click();
	// The app does not say "sent": the message waits, and can be taken back.
	const undo = page.getByRole("button", { name: "Undo", exact: true });
	await expect(undo).toBeVisible();
	await expect(page.getByText("Sending…")).toBeVisible();
	await expect(page.getByText("Message sent")).toHaveCount(0);
	await expect(compose).toHaveCount(0);
	expect((await shown(page, app.account.mailbox, subject))?.submission?.state).toBe("waiting");

	await undo.click();
	await expect(page.getByText("Sending undone. The message is a draft again.")).toBeVisible();
	// The compose window opens on the same message, with what was written and its file.
	await expect(compose).toBeVisible();
	await expect(compose.getByLabel("Subject")).toHaveValue(subject);
	await expect(
		compose.getByRole("button", { name: "Remove someone@elsewhere.test" }),
	).toBeVisible();
	await expect(attached.getByRole("listitem")).toHaveCount(1);
	await expect(attached).toContainText("plan.txt");

	const back = await shown(page, app.account.mailbox, subject);
	expect(back?.folder_id).toBe("draft");
	expect(back?.submission).toBeUndefined();
	expect(back?.attachments.map((file) => file.filename)).toEqual(["plan.txt"]);
	// It is in Drafts and nowhere else, and nothing says that it was sent.
	await compose.getByRole("button", { name: "Save and close" }).click();
	await rail(page, /Drafts/).click();
	await expect(row(page, subject)).toHaveCount(1);
	await rail(page, /Scheduled/).click();
	await expect(page.getByText("Nothing is waiting to be sent")).toBeVisible();
	await expect(page.getByText("Message sent")).toHaveCount(0);
	expect(app.watch.dialogs).toEqual([]);
});

test("without Undo the message is in Sent after the window, and the app says so only then", async ({
	page,
	app,
}) => {
	const subject = `Sending ${Date.now()}: let go`;
	await page.goto(`/mailbox/${encodeURIComponent(app.account.mailbox)}/emails/inbox`);
	const compose = await write(page, subject);
	await compose.getByRole("button", { name: "Send", exact: true }).click();
	const pressed = Date.now();
	await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeVisible();

	// While it waits it is in Scheduled, with its time, for everyone who reads the mailbox.
	await rail(page, /Scheduled/).click();
	await expect(row(page, subject)).toBeVisible();
	await expect(page.getByText("Message sent")).toHaveCount(0);
	await rail(page, /Sent/).click();
	await expect(page.getByRole("heading", { name: "Sent" })).toBeAttached();
	await expect(row(page, subject)).toHaveCount(0);

	// The window ends: Undo is no longer offered, and then the mailbox says the message left.
	await expect(page.getByText("Message sent", { exact: true })).toBeVisible(SENT_WITHIN);
	expect(Date.now() - pressed).toBeGreaterThanOrEqual(5_000);
	await expect(page.getByRole("button", { name: "Undo", exact: true })).toHaveCount(0);
	// The note is true: the mailbox has it as sent, in Sent.
	const sent = await shown(page, app.account.mailbox, subject);
	expect([sent?.folder_id, sent?.submission?.state]).toEqual(["sent", "sent"]);
	// The open list follows by itself.
	await expect(row(page, subject)).toBeVisible();
	await rail(page, /Scheduled/).click();
	await expect(page.getByText("Nothing is waiting to be sent")).toBeVisible();
});

test("a message sent later waits in Scheduled with its time, and is given a new time, sent now or cancelled", async ({
	page,
	app,
}) => {
	const stamp = Date.now();
	const kept = `Sending ${stamp}: later`;
	const dropped = `Sending ${stamp}: cancelled`;
	await page.goto(`/mailbox/${encodeURIComponent(app.account.mailbox)}/emails/inbox`);

	// One of the app's own times. The choice is shown with its date and time before it is made.
	let compose = await write(page, kept);
	await compose.getByRole("button", { name: "Send later" }).click();
	const tomorrow = page.getByRole("menuitem", { name: /Tomorrow morning/ });
	await expect(tomorrow).toContainText(/\d{1,2}:00/);
	await tomorrow.click();
	await expect(page.getByText(/^Send scheduled for /)).toBeVisible();
	await expect(compose).toHaveCount(0);
	const first = await shown(page, app.account.mailbox, kept);
	expect(first?.folder_id).toBe("scheduled");
	const morning = new Date(first?.submission?.send_at ?? "");
	expect([morning.getHours(), morning.getMinutes()]).toEqual([8, 0]);
	expect(morning.getTime()).toBeGreaterThan(Date.now());

	// A date and time of the person's own, shown back in a sentence before it is taken.
	compose = await write(page, dropped);
	await compose.getByRole("button", { name: "Send later" }).click();
	await page.getByRole("menuitem", { name: "Pick a date and time" }).click();
	const dialog = page.getByRole("dialog", { name: "Send later" });
	const field = dialog.getByLabel("Date and time");
	await field.fill("2020-01-01T09:00");
	await expect(dialog.getByRole("alert")).toHaveText("Choose a time that is still to come.");
	await expect(dialog.getByRole("button", { name: "Schedule send" })).toBeDisabled();
	const year = new Date().getFullYear() + 1;
	await field.fill(`${year}-03-04T09:30`);
	await expect(dialog.getByText(/^The message will be sent .*9:30/)).toBeVisible();
	await dialog.getByRole("button", { name: "Schedule send" }).click();
	await expect(dialog).toHaveCount(0);
	// The compose form was not sent by the dialog's own button: one message, with that time.
	const second = await shown(page, app.account.mailbox, dropped);
	expect(new Date(second?.submission?.send_at ?? "").getTime()).toBe(
		new Date(year, 2, 4, 9, 30).getTime(),
	);

	// Scheduled lists what waits, soonest first, each line with its time.
	await rail(page, /Scheduled/).click();
	await expect(page.getByRole("heading", { name: "Scheduled", exact: true })).toBeAttached();
	const lines = page.getByRole("list", { name: "Scheduled" }).getByRole("listitem");
	await expect(lines).toHaveCount(2);
	await expect(lines.nth(0)).toContainText(kept);
	await expect(lines.nth(0)).toContainText("8:00");
	await expect(lines.nth(1)).toContainText(dropped);
	await expect(rail(page, /Scheduled/)).toContainText("2");

	// A waiting message opens read-only, with its time and its own deeds and no others.
	await row(page, dropped).click();
	await expect(page.getByText(/^This message will be sent .*9:30/)).toBeVisible();
	for (const none of ["Archive", "Delete", "Report spam", "Reply", "Star", "Mark as unread"]) {
		await expect(page.getByRole("button", { name: none, exact: true })).toHaveCount(0);
	}
	// A new time.
	await page.getByRole("button", { name: "Change the time" }).click();
	await page.getByRole("menuitem", { name: "Pick a date and time" }).click();
	const change = page.getByRole("dialog", { name: "Change the time" });
	await change.getByLabel("Date and time").fill(`${year}-05-06T14:15`);
	await change.getByRole("button", { name: "Change the time" }).click();
	await expect(page.getByText(/^This message will be sent .*2:15/)).toBeVisible();
	expect(
		new Date(
			(await shown(page, app.account.mailbox, dropped))?.submission?.send_at ?? "",
		).getTime(),
	).toBe(new Date(year, 4, 6, 14, 15).getTime());
	// Cancelled: it is a draft again, and Scheduled no longer has it.
	await page.getByRole("button", { name: "Cancel send" }).click();
	await expect(lines).toHaveCount(1);
	expect((await shown(page, app.account.mailbox, dropped))?.folder_id).toBe("draft");

	// Sent now: it leaves at once, with no window on top, and the app says so when it has.
	await row(page, kept).click();
	await page.getByRole("button", { name: "Send now" }).click();
	await expect(page.getByText("Message sent", { exact: true })).toBeVisible(SENT_WITHIN);
	expect((await shown(page, app.account.mailbox, kept))?.folder_id).toBe("sent");
	await rail(page, /Scheduled/).click();
	await expect(page.getByText("Nothing is waiting to be sent")).toBeVisible();
	await rail(page, /Sent/).click();
	await expect(row(page, kept)).toBeVisible();
	expect(app.watch.dialogs).toEqual([]);
	expect(await app.contacted()).toEqual([]);
});

test("a message that could not leave comes back to Drafts with the reason", async ({
	page,
	app,
}) => {
	const stamp = Date.now();
	const subject = `Sending ${stamp}: refused`;
	const mailbox = `/api/v1/mailboxes/${encodeURIComponent(app.account.mailbox)}`;
	const person = { email: `sender-${stamp}@example.com`, password: `a passphrase ${stamp} long` };
	/** A request as the app's own page would make it, with a session of its own. */
	const call = async (path: string, cookie: string, body?: unknown, method = "POST") => {
		const res = await fetch(`${BASE}${path}`, {
			method,
			headers: { "content-type": "application/json", origin: BASE, cookie },
			body: body === undefined ? undefined : JSON.stringify(body),
		});
		expect(res.status, `${method} ${path}`).toBeLessThan(300);
		return res;
	};
	const signedIn = async (email: string, password: string) =>
		(await call("/api/auth/sign-in/email", "", { email, password })).headers
			.getSetCookie()
			.map((line) => line.split(";")[0])
			.join("; ");

	// Someone who may send from the mailbox: invited, then made a sender by the owner.
	const owner = await signedIn(app.account.email, app.account.password);
	const invited = (await (
		await call("/api/v1/invitations", owner, { email: person.email, role: "member" })
	).json()) as { link: string };
	const token = invited.link.split("/accept/")[1] ?? "";
	await call(`/api/invitations/${token}/accept`, "", {
		name: "Sam Sender",
		password: person.password,
	});
	const members = (await (
		await call(`${mailbox}/members`, owner, { email: person.email, role: "sender" })
	).json()) as { userId: string; email: string }[];
	const userId = members.find((member) => member.email === person.email)?.userId ?? "";
	const theirs = await signedIn(person.email, person.password);

	// The owner has the mailbox open while it happens.
	await page.goto(`/mailbox/${encodeURIComponent(app.account.mailbox)}/emails/inbox`);
	await expect(page.getByRole("heading", { name: "Inbox" })).toBeAttached();

	// They send a message, and before it has left they may no longer send from here.
	await call(`${mailbox}/emails`, theirs, {
		to: "someone@elsewhere.test",
		from: app.account.mailbox,
		subject,
		html: "<p>Written while they still could.</p>",
		undo_seconds: 5,
	});
	await call(`${mailbox}/members/${userId}`, owner, { role: "reader" }, "PUT");

	// The message does not leave. The open app says at once that a draft was not sent.
	await expect(rail(page, /Drafts/)).toContainText("1 not sent", SENT_WITHIN);
	const back = await shown(page, app.account.mailbox, subject);
	expect([back?.folder_id, back?.submission?.state, back?.submission?.error]).toEqual([
		"draft",
		"failed",
		"right",
	]);
	await rail(page, /Drafts/).click();
	await expect(row(page, subject)).toContainText("Not sent");
	// Opened, it says why in the app's own words, and offers to send again, to edit, to discard.
	await row(page, subject).click();
	const notice = page.getByRole("alert").filter({ hasText: "This message was not sent." });
	await expect(notice).toContainText("may no longer send from this mailbox");
	await expect(page.getByRole("button", { name: "Send", exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: "Delete", exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Edit", exact: true }).first().click();
	const compose = page.getByRole("region", { name: "Compose" });
	await expect(compose.getByLabel("Subject")).toHaveValue(subject);
	await expect(compose.getByText(/^This message was not sent\. /)).toBeVisible();
	await compose.getByRole("button", { name: "Save and close" }).click();

	// The mark can be dismissed: it is a plain draft again.
	await notice.getByRole("button", { name: "Dismiss" }).click();
	await expect(notice).toHaveCount(0);
	await expect(rail(page, /Drafts/)).not.toContainText("not sent");
	expect((await shown(page, app.account.mailbox, subject))?.submission).toBeUndefined();
	// Nothing was sent, and nothing says it was.
	await rail(page, /Sent/).click();
	await expect(page.getByRole("heading", { name: "Sent" })).toBeAttached();
	await expect(row(page, subject)).toHaveCount(0);
	await expect(page.getByText("Message sent")).toHaveCount(0);

	// The person and what the test made are taken away again.
	await call(`${mailbox}/members/${userId}`, owner, undefined, "DELETE");
	const id = (
		(await (await page.request.get(`${mailbox}/emails?folder=draft`)).json()) as {
			emails: { id: string; subject: string }[];
		}
	).emails.find((email) => email.subject === subject)?.id;
	await call(`${mailbox}/emails/${id}`, owner, undefined, "DELETE");
});
