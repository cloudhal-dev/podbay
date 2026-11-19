// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Tier 6: how tall the mail frame stands (#110, rule S4). The frame is as tall as the message,
 * to its last line, and follows the message when it grows. A stranger writes the message, and
 * with it every height in it: a height that follows the frame's own height must not make the
 * frame grow without end, and the page is told a small, known number of times.
 */
import { randomUUID } from "node:crypto";
import type { Frame, Page } from "@playwright/test";
import { FRAME_MAX_HEIGHT, FRAME_MAX_REPORTS } from "../../shared/mail-frame.ts";
import { expect, mime, test } from "./fixtures.ts";
import { png } from "./png.ts";
import { PROXY } from "./proxy-address.ts";

const FRAME = 'iframe[title="Email content"]';

/**
 * An SVG picture that grows by itself, in 31 steps of 0.4 s from 100 px to 1600 px, in base64. A
 * browser keeps a picture it has drawn, with its clock: one it drew before would stand at its last
 * height at once. So each call makes a picture of its own (`run`), and a test makes its message
 * when it runs, not when the file loads: a second run in the same worker gets a new picture too.
 */
function steppingSvg(): string {
	const run = randomUUID();
	const steps = Array.from({ length: 31 }, (_, step) => 100 + step * 50).join(";");
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="100"><title>${run}</title><animate attributeName="height" values="${steps}" dur="12.4s" calcMode="discrete" fill="freeze"/><rect width="40" height="100%" fill="#68c"/></svg>`;
	return Buffer.from(svg).toString("base64");
}
const steppingPicture = () => `data:image/svg+xml;base64,${steppingSvg()}`;

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

/**
 * Waits until the page has been told nothing new for a whole second, and returns what it was told.
 * A message that moved less often than once a second would look at rest here with a low count:
 * no such mover is known once the known ones are taken out (app/lib/mail-html.ts).
 */
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
 * taller, and a taller frame makes the message taller again. And heights that move by themselves,
 * some time after the frame took its height, so that the script would see a message at rest each
 * time. Each must come to rest.
 */
const FOLLOWERS: { name: string; html: () => string }[] = [
	{ name: "twice the frame's height", html: () => '<div style="height:200vh">tall</div>' },
	{
		name: "one pixel more than the frame",
		html: () => '<div style="min-height:calc(100vh + 1px)">taller by one</div>',
	},
	{
		name: "a percentage of a height in vh",
		html: () => '<div style="height:100vh"><div style="height:200%">nested</div></div>',
	},
	{
		name: "a calc() of vh and %",
		html: () => '<div style="height:100vh"><div style="height:calc(100% + 50vh)">mixed</div></div>',
	},
	{
		name: "a height that shrinks as the frame grows",
		html: () => '<div style="height:calc(600px - 100vh)">swings</div>',
	},
	{
		// A delayed transition would move the message only after the script looked: it would seem
		// to stand still each time. The renderer takes it out of the message (app/lib/mail-html.ts).
		name: "a delayed transition",
		html: () => '<div style="height:calc(100vh + 1px);transition:height 0s .2s">later</div>',
	},
	{
		// The same by another door: a picture that moves by itself, a step after the frame took the
		// height. The renderer takes such pictures out of `data:` addresses (app/lib/mail-html.ts).
		name: "an SVG picture that grows in steps",
		html: () => `<img src="${steppingPicture()}" alt="">`,
	},
	{
		name: "the same picture through a style",
		html: () => `<div style="content:url(${steppingPicture()})">picture</div>`,
	},
	{
		// A shorthand that uses var(): its longhands read as "", so there is nothing to search.
		name: "the same picture in a shorthand with var()",
		html: () =>
			`<ul><li style="list-style:var(--x,inside url(data:image/svg+xml;base64,${steppingSvg()}))">item</li></ul>`,
	},
	{
		// A value that uses var() is kept as written, tab and all; the address parser drops the tab.
		name: "the same picture behind var(), with a tab in its scheme",
		html: () =>
			`<div style="content:var(--x,url('da&#9;ta:image/svg+xml;base64,${steppingSvg()}'))">picture</div>`,
	},
	{
		// Letters that grow when lowered would move the cut of the type past `image/svg+xml;`. The
		// picture comes second in the text and is the one for this screen (1x).
		name: "the same picture behind letters that grow when lowered",
		html: () =>
			`<div style="content:image-set(&quot;data:image/png;${"İ".repeat(14)},x&quot; 2x, &quot;data:image/svg+xml;image/png;base64,${steppingSvg()}&quot; 1x)">picture</div>`,
	},
];

for (const follower of FOLLOWERS) {
	test(`a message whose height follows the frame or moves by itself (${follower.name}) comes to rest, and the page stops being told`, async ({
		page,
		app,
	}) => {
		await countReports(page);
		const subject = `Size: follows the frame, ${follower.name}`;
		await app.deliver(
			mime({
				subject,
				to: app.account.mailbox,
				html: `<p>Above it.</p>${follower.html()}<p>The last line of a hostile message.</p>`,
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

	test("a remote picture whose address holds the letters data: is counted, offered and shown", async ({
		page,
		app,
	}) => {
		await answerLate(page, "pics.sender.test", 0, 50);
		const subject = "Size: a remote picture with data: in its address";
		await app.deliver(
			mime({
				subject,
				to: app.account.mailbox,
				html: '<p>Before.</p><img src="https://pics.sender.test/a.png?metadata:1" alt=""><p>After.</p>',
			}),
		);
		await app.signIn();
		await app.openMessage(subject);
		await page.getByRole("button", { name: "Show images" }).click();
		await expect
			.poll(() =>
				page
					.frameLocator(FRAME)
					.locator("img")
					.evaluate((one: HTMLImageElement) => one.naturalHeight),
			)
			.toBe(50);
		expect(await app.contacted()).toEqual(["pics.sender.test"]);
	});
});

test.describe("a host the proxy answered", () => {
	// The run's certificate is accepted, so a picture the proxy answered loads: a picture that does
	// not load was refused by the proxy.
	test.use({ ignoreHTTPSErrors: true });

	test("is refused once the proxy is reset, and is written down again", async ({ page, app }) => {
		await answerLate(page, "late.images.test", 0, 300);
		const shown = page.frameLocator(FRAME).locator("img");
		const open = async (subject: string, path: string) => {
			await app.deliver(
				mime({
					subject,
					to: app.account.mailbox,
					html: `<p>Before the picture.</p><img src="https://late.images.test/${path}" alt=""><p>After it.</p>`,
				}),
			);
			await app.openMessage(subject);
			await page.getByRole("button", { name: "Show images" }).click();
		};
		await app.signIn();
		await open("Size: a picture the proxy answers", "a.png");
		await expect.poll(() => shown.evaluate((one: HTMLImageElement) => one.naturalHeight)).toBe(300);

		// The reset forgets the answer and closes the tunnel the browser kept open.
		expect((await fetch(`${PROXY}/__reset`, { method: "POST" })).status).toBe(204);
		expect(await app.contacted()).toEqual([]);
		await open("Size: the same host after the reset", "b.png");
		// The picture has finished, and has nothing: the proxy refused it.
		await expect
			.poll(() =>
				shown.evaluate((one: HTMLImageElement) => (one.complete ? one.naturalHeight : -1)),
			)
			.toBe(0);
		expect(await app.contacted()).toEqual(["late.images.test"]);
	});
});

/** An SVG picture, as base64, for the spellings below. */
const SVG_BASE64 = Buffer.from(
	'<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40"/></svg>',
).toString("base64");

test("in the frame the known ways of moving are gone and no SVG picture is drawn, for each spelling tried", async ({
	app,
}) => {
	const moving = [
		"transition:height 1s 1s",
		"-webkit-transition:height 1s 1s",
		"transition-property:height;transition-duration:1s;transition-delay:1s",
		"transition:height 1s 1s !important",
		"--t:height 1s 1s;transition:var(--t)",
		"--d:1s;transition:height var(--d) var(--d)",
		"animation:grow 1s 1s infinite",
		"-webkit-animation:grow 1s 1s infinite",
		"animation-name:grow;animation-duration:1s;animation-delay:1s",
		"--a:grow 1s infinite;animation:var(--a)",
	];
	const pictured = [
		`content:url(data:image/svg+xml;base64,${SVG_BASE64})`,
		`background:url('DATA:IMAGE/SVG+XML;base64,${SVG_BASE64}') no-repeat`,
		`background-image:url( data:image/svg+xml;base64,${SVG_BASE64} )`,
		`list-style-image:url(data:image/svg+xml;base64,${SVG_BASE64})`,
		`content:url(d\\61ta:image/svg+xml;base64,${SVG_BASE64})`,
		`--p:url(data:image/svg+xml;base64,${SVG_BASE64});background-image:var(--p)`,
		`--p:url(d\\61ta:image/svg+xml;base64,${SVG_BASE64});background-image:var(--p)`,
		`background-image:image-set("data:image/svg+xml;base64,${SVG_BASE64}" 1x)`,
		`content:url('da&#9;ta:image/svg+xml;base64,${SVG_BASE64}')`,
		`list-style:var(--x,inside url(data:image/svg+xml;base64,${SVG_BASE64}))`,
		`content:var(--x,url('da&#9;ta:image/svg+xml;base64,${SVG_BASE64}'))`,
		`content:image-set('data:image/png;${"İ".repeat(14)},x' 2x, 'data:image/svg+xml;image/png;base64,${SVG_BASE64}' 1x)`,
		`content:env(x,url(data:image/svg+xml;base64,${SVG_BASE64}))`,
	];
	const pngBase64 = png(40, 30, [90, 120, 200]).toString("base64");
	const subject = "Size: every spelling of a message that moves";
	await app.deliver(
		mime({
			subject,
			to: app.account.mailbox,
			html: [
				...moving.map((style) => `<div class="moving" style="height:20px;${style}">m</div>`),
				...pictured.map((style) => `<div class="pictured" style="height:20px;${style}">p</div>`),
				`<img class="svg" src="data:image/svg+xml;base64,${SVG_BASE64}" alt="">`,
				`<img class="svg" src="   DATA:Image/SVG+xml;base64,${SVG_BASE64}" alt="">`,
				`<img class="svg-as-png" src="data:image/png;base64,${SVG_BASE64}" alt="">`,
				`<img class="png" src="data:image/png;base64,${pngBase64}" alt="">`,
				"<p>The last line.</p>",
			].join(""),
		}),
	);
	await app.signIn();
	const frame = await app.openMessage(subject);
	const seen = await frame.evaluate(() => {
		const all = (selector: string) => [...document.querySelectorAll<HTMLElement>(selector)];
		return {
			moving: all(".moving").map((one) => {
				const style = getComputedStyle(one);
				return [style.transitionDuration, style.transitionDelay, style.animationName].join(" ");
			}),
			pictured: all(".pictured").map((one) => {
				const style = getComputedStyle(one);
				return [style.content, style.backgroundImage, style.listStyleImage].join(" ");
			}),
			svg: all("img.svg").map((one) => one.getAttribute("src")),
			svgAsPng: all("img.svg-as-png").map((one) => {
				const image = one as HTMLImageElement;
				return image.complete ? image.naturalWidth : -1;
			}),
			png: all("img.png").map((one) => (one as HTMLImageElement).naturalWidth),
		};
	});
	expect(seen.moving).toEqual(moving.map(() => "0s 0s none"));
	expect(seen.pictured).toHaveLength(pictured.length);
	for (const [index, computed] of seen.pictured.entries())
		expect(computed, pictured[index]).not.toMatch(/svg|url\(/i);
	expect(seen.svg, "an SVG loses its address").toEqual([null, null]);
	// Pictures are told apart by their type: an SVG that says it is a PNG is drawn as nothing.
	expect(seen.svgAsPng).toEqual([0]);
	// And a picture the app shows is drawn: the check above would see one.
	expect(seen.png).toEqual([40]);
	expect(app.watch.errors).toEqual([]);
});
