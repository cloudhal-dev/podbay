// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Tier 6: the mailbox tells the open app that something changed (ADR-0013), in a real browser
 * and under the app's real response headers.
 *
 * - the connection opens to the app's own origin under `connect-src 'self'`, with no report of
 *   the content policy, and what comes over it is four counters and no mail;
 * - a second tab sees a move made in the first without a reload;
 * - new mail appears without waiting half a minute, and is announced by the device from that
 *   signal and from nothing else;
 * - with the connection blocked the app still shows new mail, by its slower looking.
 */
import type { Page, WebSocket } from "@playwright/test";
import { BASE, expect, mime, test } from "./fixtures.ts";

const row = (page: Page, subject: string) =>
	page.getByRole("button", { name: new RegExp(subject) });
const select = (page: Page, subject: string) =>
	page.getByRole("checkbox", { name: new RegExp(`Select the conversation "${subject}`) });

const SHAPE =
	/^\{"v":1,"type":"state","state":\{"delivery":"\d+","mail":"\d+","labels":"\d+","settings":"\d+"\}\}$/;

/** Every connection a page opens, with what was said on it in each direction. */
function listen(page: Page) {
	const heard = {
		sockets: [] as WebSocket[],
		received: [] as string[],
		sent: [] as string[],
	};
	page.on("websocket", (socket) => {
		heard.sockets.push(socket);
		socket.on("framereceived", (frame) => heard.received.push(String(frame.payload)));
		socket.on("framesent", (frame) => heard.sent.push(String(frame.payload)));
	});
	return heard;
}

/** The requests a page makes for a list of mail, by their query. */
function lists(page: Page) {
	const asked: string[] = [];
	page.on("request", (request) => {
		const url = new URL(request.url());
		if (request.method() === "GET" && url.pathname.endsWith("/emails")) asked.push(url.search);
	});
	return asked;
}

test.beforeEach(async ({ page, app }) => {
	await app.signIn();
	await page.setViewportSize({ width: 1280, height: 800 });
});

test("the connection opens to the app's own origin under the real headers, and carries only counters", async ({
	page,
	app,
}) => {
	const heard = listen(page);
	const inbox = `/mailbox/${encodeURIComponent(app.account.mailbox)}/emails/inbox`;
	const response = await page.goto(inbox);
	// The page is served with the policy as it is: its own origin, no host, no scheme added.
	const policy = response?.headers()["content-security-policy"] ?? "";
	expect(policy).toContain("connect-src 'self';");
	expect(policy).not.toMatch(/\bwss?:/);

	await expect.poll(() => heard.received.length, "the first message").toBeGreaterThan(0);
	expect(heard.sockets).toHaveLength(1);
	// One address: the app's own host, the mailbox, and nothing that is a proof of anything.
	const url = new URL(heard.sockets[0]?.url() ?? "");
	expect(`${url.protocol}//${url.host}`).toBe(BASE.replace("http", "ws"));
	expect(url.pathname).toBe(`/api/v1/mailboxes/${encodeURIComponent(app.account.mailbox)}/live`);
	expect(url.search).toBe("");

	// Something happens: mail that is full of words arrives, and is moved.
	await app.deliver(
		mime({
			subject: "Live: words that are mail",
			to: app.account.mailbox,
			html: "<p>A body that must not travel</p>",
		}),
	);
	await expect(row(page, "Live: words that are mail")).toBeVisible();
	await select(page, "Live: words that are mail").check();
	await page.getByRole("button", { name: "Archive" }).first().click();
	await expect(row(page, "Live: words that are mail")).toHaveCount(0);
	await expect.poll(() => heard.received.length).toBeGreaterThanOrEqual(3);

	// Every message is the one shape. No word of the mail, no address, no id.
	for (const text of heard.received) {
		expect(text).toMatch(SHAPE);
		expect(text).not.toContain("Live");
		expect(text).not.toContain("@");
	}
	expect(new Set(heard.received).size).toBe(heard.received.length);
	// The app said nothing on it, and the browser reported nothing about the policy.
	expect(heard.sent).toEqual([]);
	expect((await app.seen()).violations).toEqual([]);
	expect(app.watch.errors).toEqual([]);
	expect(await app.contacted()).toEqual([]);
});

test("a second tab sees a move made in the first without a reload", async ({
	page,
	context,
	app,
}) => {
	await app.deliver(
		mime({ subject: "Live: moved elsewhere", to: app.account.mailbox, text: "one" }),
	);
	await app.deliver(mime({ subject: "Live: stays here", to: app.account.mailbox, text: "two" }));
	const inbox = `/mailbox/${encodeURIComponent(app.account.mailbox)}/emails/inbox`;
	const second = await context.newPage();
	await second.setViewportSize({ width: 1280, height: 800 });
	const heard = listen(second);
	await page.goto(inbox);
	await second.goto(inbox);
	await expect(row(second, "Live: moved elsewhere")).toBeVisible();
	await expect.poll(() => heard.received.length, "the second tab's connection").toBeGreaterThan(0);
	// A mark in the second tab's own memory: a reload would lose it.
	await second.evaluate(() => {
		(window as unknown as { __kept: string }).__kept = "not reloaded";
	});

	await select(page, "Live: moved elsewhere").check();
	await page.getByRole("button", { name: "Archive" }).first().click();
	await expect(page.getByText("Conversation archived")).toBeVisible();

	// Nobody touched the second tab. Its own looking is five minutes away; it was told.
	await expect(row(second, "Live: moved elsewhere")).toHaveCount(0, { timeout: 10_000 });
	await expect(row(second, "Live: stays here")).toBeVisible();
	expect(await second.evaluate(() => (window as unknown as { __kept?: string }).__kept)).toBe(
		"not reloaded",
	);
	// And back: undone in the first, it returns in the second.
	await page.getByRole("button", { name: "Undo" }).click();
	await expect(row(second, "Live: moved elsewhere")).toBeVisible({ timeout: 10_000 });
	await second.close();
});

test("new mail appears without waiting, and the device announces it from that signal alone", async ({
	page,
	app,
}) => {
	// The browser's notifications cannot be seen from here: stand in for them and write them down.
	await page.addInitScript(() => {
		const notes: [string, string][] = [];
		(window as unknown as { notes: typeof notes }).notes = notes;
		class Stand {
			static permission = "granted";
			static requestPermission = async () => "granted";
			onclick: (() => void) | null = null;
			constructor(title: string, options?: { body?: string }) {
				notes.push([title, options?.body ?? ""]);
			}
			close() {}
		}
		(window as unknown as { Notification: unknown }).Notification = Stand;
		// Notifications are a choice of the device, on for this test.
		const kept = JSON.parse(window.localStorage.getItem("podbay.display") ?? "{}");
		window.localStorage.setItem("podbay.display", JSON.stringify({ ...kept, notifications: true }));
	});
	const notes = () =>
		page.evaluate(() => (window as unknown as { notes: [string, string][] }).notes);
	const heard = listen(page);
	const asked = lists(page);
	/** The notifier's own look: the top ten of the inbox. */
	const looks = () => asked.filter((query) => query.includes("limit=10")).length;

	await page.goto(`/mailbox/${encodeURIComponent(app.account.mailbox)}/emails/inbox`);
	await expect(page.getByRole("heading", { name: "Inbox" })).toBeAttached();
	await expect.poll(() => heard.received.length, "the connection").toBeGreaterThan(0);
	await expect.poll(looks, "the first look").toBeGreaterThan(0);
	await page.waitForTimeout(1500);
	// What was already there is not announced.
	expect(await notes()).toEqual([]);

	const before = Date.now();
	await app.deliver(
		mime({
			subject: "Live: here at once",
			to: app.account.mailbox,
			text: "The body stays private.",
		}),
	);
	await expect(row(page, "Live: here at once")).toBeVisible();
	await expect.poll(notes).toEqual([["ada@sender.test", "Live: here at once"]]);
	// Far sooner than the half minute the list used to wait.
	expect(Date.now() - before).toBeLessThan(15_000);

	// A move is told too, and the list reads again, but it is no reason to look for new mail.
	const looked = looks();
	const listed = asked.length;
	await select(page, "Live: here at once").check();
	await page.getByRole("button", { name: "Archive" }).first().click();
	await expect(row(page, "Live: here at once")).toHaveCount(0);
	await page.waitForTimeout(2500);
	expect(asked.length).toBeGreaterThan(listed);
	expect(looks()).toBe(looked);
	expect(await notes()).toHaveLength(1);
	expect((await app.seen()).violations).toEqual([]);
});

test("with the connection blocked the app still shows new mail, by its slower looking", async ({
	page,
	app,
}) => {
	// Time in the page is the test's to move: half a minute is not waited for.
	await page.clock.install();
	let refused = 0;
	await page.routeWebSocket(/\/api\/v1\/mailboxes\/[^/]+\/live$/, (socket) => {
		// The handshake never reaches the server, and the page's socket closes.
		refused += 1;
		void socket.close({ code: 1000, reason: "refused by the test" });
	});
	const asked = lists(page);
	// The list's first reading has to be over before the mail arrives: one that is still on
	// its way would bring the mail with it and prove nothing.
	const firstList = page.waitForResponse(
		(response) => new URL(response.url()).pathname.endsWith("/emails") && response.ok(),
	);
	await page.goto(`/mailbox/${encodeURIComponent(app.account.mailbox)}/emails/inbox`);
	await expect(page.getByRole("heading", { name: "Inbox" })).toBeAttached();
	await (await firstList).finished();
	await page.waitForLoadState("networkidle");
	await expect.poll(() => refused, "the app's first attempt").toBeGreaterThan(0);

	await app.deliver(mime({ subject: "Live: found by asking", to: app.account.mailbox, text: "x" }));
	// Nothing tells this tab, and it has not asked again yet: the mail is not there.
	await page.waitForTimeout(3000);
	await expect(row(page, "Live: found by asking")).toHaveCount(0);
	const listed = asked.length;
	// It keeps trying, a second later and then more slowly, and guesses nothing about why.
	expect(refused).toBeGreaterThanOrEqual(2);
	expect(refused).toBeLessThanOrEqual(4);

	// Half a minute on, the list asks by itself as it always did, and the mail is there.
	await page.clock.fastForward(30_000);
	await expect(row(page, "Live: found by asking")).toBeVisible();
	expect(asked.length).toBeGreaterThan(listed);
	// The app goes on working: the conversation opens.
	await row(page, "Live: found by asking").click();
	await expect(page.locator('iframe[title="Email content"]')).toBeVisible();
	expect((await app.seen()).violations).toEqual([]);
});

/**
 * How long nothing is said on a connection before it is asked whether it is still open. The
 * app says `ping` every minute, so the wait is a little longer than that.
 */
const IDLE_SECONDS = Number(process.env.PODBAY_E2E_IDLE_SECONDS ?? 65);

test("a connection on which nothing is said for longer than a minute stays open and is still told", async ({
	page,
	app,
}) => {
	test.setTimeout((IDLE_SECONDS + 60) * 1000);
	await page.clock.install();
	const heard = listen(page);
	await page.goto(`/mailbox/${encodeURIComponent(app.account.mailbox)}/emails/inbox`);
	await expect.poll(() => heard.received.length, "the connection").toBeGreaterThan(0);
	// The page's clock stops, so the app sends no `ping` and opens no new connection: for the
	// whole wait not one byte of the app's travels in either direction.
	await page.clock.pauseAt(new Date(Date.now() + 1000));
	const told = heard.received.length;
	await page.waitForTimeout(IDLE_SECONDS * 1000);
	expect(heard.sent).toEqual([]);
	expect(heard.received).toHaveLength(told);
	expect(heard.sockets).toHaveLength(1);
	expect(heard.sockets[0]?.isClosed()).toBe(false);

	// It is not only open on the page's side: what happens now is told on it.
	await app.deliver(
		mime({ subject: "Live: after the silence", to: app.account.mailbox, text: "x" }),
	);
	await expect
		.poll(() => heard.received.length, "being told after the silence")
		.toBeGreaterThan(told);
	expect(heard.sockets[0]?.isClosed()).toBe(false);
});
