// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Tier 6: how tall the mail frame stands (#110, rule S4). The frame is as tall as the message,
 * to its last line, and follows the message when it grows. A stranger writes the message, and
 * with it every height in it: a height that follows the frame's own height must not make the
 * frame grow without end, and the page is told a small, known number of times.
 */
import type { Frame, Page } from "@playwright/test";
import { FRAME_MAX_HEIGHT, FRAME_MAX_REPORTS } from "../../shared/mail-frame.ts";
import { expect, mime, test } from "./fixtures.ts";
import { png } from "./png.ts";
import { PROXY } from "./proxy-address.ts";

const FRAME = 'iframe[title="Email content"]';

/**
 * Every height a mail frame told the page, in order, kept by the page's own window: which
 * document said it (counted from 0, in the order they first spoke) and the height.
 */
async function countReports(page: Page): Promise<void> {
	await page.addInitScript(() => {
		if (window !== window.top) return;
		const told: { document: number; height: number }[] = [];
		const documents: unknown[] = [];
		(window as unknown as { __told: typeof told }).__told = told;
		window.addEventListener("message", (event) => {
			const data = event.data as { __emailIframeHeight?: boolean; height?: number } | null;
			if (!data || typeof data !== "object" || data.__emailIframeHeight !== true) return;
			if (!documents.includes(event.source)) documents.push(event.source);
			told.push({ document: documents.indexOf(event.source), height: Number(data.height) });
		});
	});
}

/** The heights the newest document has told, and how many documents spoke. */
const reports = async (page: Page) => {
	const told = await page.evaluate(
		() => (window as unknown as { __told: { document: number; height: number }[] }).__told,
	);
	const newest = Math.max(-1, ...told.map((one) => one.document));
	return told.filter((one) => one.document === newest).map((one) => one.height);
};

/** Waits until the page has been told nothing new for a whole second, and returns what it was told. */
async function atRest(page: Page): Promise<number[]> {
	let last = -1;
	let still = 0;
	for (let turn = 0; turn < 20 && still < 2; turn++) {
		await page.waitForTimeout(500);
		const now = (await reports(page)).length;
		still = now === last ? still + 1 : 0;
		last = now;
	}
	expect(still, "the page stopped being told").toBe(2);
	return reports(page);
}

const frameHeight = async (page: Page) =>
	Math.round((await page.locator(FRAME).boundingBox())?.height ?? 0);

test("a message is shown to its last line: the frame is as tall as the whole document", async ({
	page,
	app,
}) => {
	const subject = "Size: the last line";
	await app.deliver(
		mime({
			subject,
			to: app.account.mailbox,
			html: "<p>The first line of a short message.</p><p>The last line, which is shown whole.</p>",
		}),
	);
	await app.signIn();
	const frame = await app.openMessage(subject);
	const measured = await frame.evaluate(() => {
		const last = [...document.querySelectorAll("p")].pop() as HTMLElement;
		return {
			document: document.documentElement.scrollHeight,
			viewport: window.innerHeight,
			lastLineBottom: Math.ceil(last.getBoundingClientRect().bottom),
		};
	});
	// The paragraphs' own margins belong to the message: the last one's bottom is inside the frame.
	expect(measured.lastLineBottom, "the last line ends inside the frame").toBeLessThanOrEqual(
		measured.viewport,
	);
	expect(measured.document, "nothing of the document lies under the frame").toBe(measured.viewport);
	expect(await frameHeight(page)).toBe(measured.viewport);
});

/**
 * Heights a stranger can write that follow the frame's own height: each report makes the frame
 * taller, and a taller frame makes the message taller again. Each must come to rest.
 */
const FOLLOWERS: { name: string; html: string }[] = [
	{ name: "twice the frame's height", html: '<div style="height:200vh">tall</div>' },
	{
		name: "one pixel more than the frame",
		html: '<div style="min-height:calc(100vh + 1px)">taller by one</div>',
	},
	{
		name: "a percentage of a height in vh",
		html: '<div style="height:100vh"><div style="height:200%">nested</div></div>',
	},
	{
		name: "a calc() of vh and %",
		html: '<div style="height:100vh"><div style="height:calc(100% + 50vh)">mixed</div></div>',
	},
	{
		name: "a height that shrinks as the frame grows",
		html: '<div style="height:calc(600px - 100vh)">swings</div>',
	},
	{
		// A delayed transition would move the message only after the script looked: it would seem
		// to stand still each time. The renderer takes it out of the message (app/lib/mail-html.ts).
		name: "a delayed transition",
		html: '<div style="height:calc(100vh + 1px);transition:height 0s .2s">later</div>',
	},
];

for (const follower of FOLLOWERS) {
	test(`a message whose height follows the frame (${follower.name}) comes to rest, and the page stops being told`, async ({
		page,
		app,
	}) => {
		await countReports(page);
		const subject = `Size: follows the frame, ${follower.name}`;
		await app.deliver(
			mime({
				subject,
				to: app.account.mailbox,
				html: `<p>Above it.</p>${follower.html}<p>The last line of a hostile message.</p>`,
			}),
		);
		await app.signIn();
		const frame = await app.openMessage(subject);
		// Every assertion here is a bound, and each says what holds it. How many times the message
		// moves before the script stops is not fixed (a resize and a report can fall in one frame),
		// so neither the number of reports nor the height is asserted exactly.
		const told = await atRest(page);
		const height = await frameHeight(page);
		// The page's own count and height hold whatever the frame does.
		expect(told.length, "the page was told a bounded number of times").toBeLessThanOrEqual(
			FRAME_MAX_REPORTS,
		);
		expect(height, "the frame stands at a bounded height").toBeLessThanOrEqual(FRAME_MAX_HEIGHT);
		// And the script stopped first, at the message's third move in a row: a first height and a
		// few more, far below the other two stops (six doublings from 100 px are 6400 px).
		expect(told.length, `stopped by the moves, not by the count: ${told.join(" ")}`).toBeLessThan(
			20,
		);
		expect(height, `stopped by the moves, not by the height: ${told.join(" ")}`).toBeLessThan(
			FRAME_MAX_HEIGHT,
		);
		expect(height, "the frame stands at the last height it was told").toBe(told.at(-1));
		// What the frame does not show is not lost: the reader's wheel scrolls the message inside
		// the frame to its last line. (A script can scroll a frame the reader cannot.)
		await page.locator(FRAME).scrollIntoViewIfNeeded();
		const box = await page.locator(FRAME).boundingBox();
		await page.mouse.move((box?.x ?? 0) + 20, Math.max(box?.y ?? 0, 0) + 20);
		for (let turn = 0; turn < 6; turn++) await page.mouse.wheel(0, 1000);
		await expect
			.poll(() =>
				frame.evaluate(() => {
					const last = [...document.querySelectorAll("p")].pop() as HTMLElement;
					return last.getBoundingClientRect().bottom <= window.innerHeight;
				}),
			)
			.toBe(true);
		expect(app.watch.errors).toEqual([]);
	});
}

/**
 * Lets the requests to one host through to the proxy, whoever sees them first. The fixture answers
 * every request to another origin that it can see with a pixel; the mail frame's requests have not
 * reached it so far (0 of 23), but nothing says they never will. With this the picture is the
 * proxy's either way, and the proxy still writes the host down at its CONNECT.
 */
const throughProxy = (page: Page, host: string) =>
	page.context().route(`https://${host}/**`, (route) => route.continue());

/** Asks the proxy to answer one `.test` host with a picture of the given height, late. */
async function answerLate(
	page: Page,
	host: string,
	delayMs: number,
	height: number,
): Promise<void> {
	await throughProxy(page, host);
	const res = await fetch(`${PROXY}/__answer`, {
		method: "POST",
		body: JSON.stringify({
			host,
			delayMs,
			contentType: "image/png",
			body: png(40, height, [90, 120, 200]).toString("base64"),
		}),
	});
	expect(res.status, `the proxy answers ${host}`).toBe(204);
}

/** The bottom of the message's last line, and the frame's height, measured inside the frame. */
const lastLine = (frame: Frame) =>
	frame.evaluate(() => {
		const last = [...document.querySelectorAll("p")].pop() as HTMLElement;
		return {
			bottom: Math.ceil(last.getBoundingClientRect().bottom),
			viewport: window.innerHeight,
		};
	});

test.describe("pictures that arrive late", () => {
	// This describe alone accepts the certificate the proxy made for this run (test/e2e/proxy.ts).
	test.use({ ignoreHTTPSErrors: true });

	test("a picture that arrives after the message is shown makes the frame tall enough for it", async ({
		page,
		app,
	}) => {
		await answerLate(page, "late.images.test", 1500, 300);
		const subject = "Size: a late picture";
		await app.deliver(
			mime({
				subject,
				to: app.account.mailbox,
				html: '<p>Before the picture.</p><img src="https://late.images.test/a.png" alt=""><p>The last line, under the picture.</p>',
			}),
		);
		await app.signIn();
		await app.openMessage(subject);
		await page.getByRole("button", { name: "Show images" }).click();
		const live = page.frameLocator(FRAME);
		await expect
			.poll(() => live.locator("img").evaluate((image: HTMLImageElement) => image.naturalHeight))
			.toBe(300);
		// Showing images made a new document, in a frame element of its own.
		const inside = await (await page.locator(FRAME).elementHandle())?.contentFrame();
		if (!inside) throw new Error("the mail frame has no document");
		await expect
			.poll(async () => {
				const { bottom, viewport } = await lastLine(inside);
				return bottom <= viewport && viewport >= 300;
			})
			.toBe(true);
		expect(await app.contacted()).toEqual(["late.images.test"]);
	});

	test("an ordinary message with three late pictures tells the page at most four times: once, and once for each picture", async ({
		page,
		app,
	}) => {
		await countReports(page);
		await answerLate(page, "first.images.test", 600, 120);
		await answerLate(page, "second.images.test", 1200, 120);
		await answerLate(page, "third.images.test", 1800, 120);
		const subject = "Size: three late pictures";
		await app.deliver(
			mime({
				subject,
				to: app.account.mailbox,
				html: [
					"<p>A newsletter.</p>",
					'<img src="https://first.images.test/1.png" alt="">',
					"<p>Between.</p>",
					'<img src="https://second.images.test/2.png" alt="">',
					"<p>Between again.</p>",
					'<img src="https://third.images.test/3.png" alt="">',
					"<p>The end of the newsletter.</p>",
				].join(""),
			}),
		);
		await app.signIn();
		await app.openMessage(subject);
		await page.getByRole("button", { name: "Show images" }).click();
		const live = page.frameLocator(FRAME);
		await expect
			.poll(() =>
				live
					.locator("img")
					.evaluateAll((images) =>
						images.every((image) => (image as HTMLImageElement).naturalHeight === 120),
					),
			)
			.toBe(true);
		// The script reports only when the height changes, and this message's height changes when it
		// is first laid out and when each picture arrives: at most four times. Two pictures arriving
		// in one frame make one report, so the number is a bound and not exact.
		const told = await atRest(page);
		expect(told.length, "once, and once for each picture").toBeLessThanOrEqual(4);
		// A picture only adds to the message: each report is taller than the one before.
		for (let one = 1; one < told.length; one++)
			expect(told[one], told.join(" ")).toBeGreaterThan(told[one - 1] ?? 0);
		const frame = await (await page.locator(FRAME).elementHandle())?.contentFrame();
		if (!frame) throw new Error("the mail frame has no document");
		const { bottom, viewport } = await lastLine(frame);
		expect(viewport, "the frame stands at the last height it was told").toBe(told.at(-1));
		expect(bottom, "the last line ends inside the frame").toBeLessThanOrEqual(viewport);
	});
});

test.describe("a host answered before", () => {
	// The same certificate as the test that was answered: a picture the proxy still answered would
	// load here, so a picture at 0 px means the proxy refused it.
	test.use({ ignoreHTTPSErrors: true });

	test("with nothing asked of it, the proxy still refuses a host it answered before and writes it down", async ({
		page,
		app,
	}) => {
		// The proxy, and not the fixture's pixel, decides what this picture is.
		await throughProxy(page, "late.images.test");
		const subject = "Size: a picture nobody answers";
		await app.deliver(
			mime({
				subject,
				to: app.account.mailbox,
				html: '<p>Before the picture.</p><img src="https://late.images.test/a.png" alt=""><p>After it.</p>',
			}),
		);
		await app.signIn();
		await app.openMessage(subject);
		await page.getByRole("button", { name: "Show images" }).click();
		await expect.poll(() => app.contacted()).toEqual(["late.images.test"]);
		// Longer than the late answer of the test before (1500 ms), had it been kept.
		await page.waitForTimeout(2500);
		const image = page.frameLocator(FRAME).locator("img");
		expect(await image.evaluate((one: HTMLImageElement) => one.naturalHeight)).toBe(0);
		expect(await app.contacted()).toEqual(["late.images.test"]);
	});
});
