// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Tier 6: what the mail frame does for an ordinary message (rules S4 and S5): remote images
 * only when the reader asks, embedded images without a request, links that open outside the
 * app and tell the destination nothing.
 */
import { deflateSync } from "node:zlib";
import { MAIL_FRAME_SANDBOX } from "../../shared/mail-frame.ts";
import { expect, mime, test } from "./fixtures.ts";

/** A real PNG of one colour, large enough to see. */
function png(width: number, height: number, rgb: [number, number, number]): Buffer {
	const chunk = (type: string, data: Buffer) => {
		const body = Buffer.concat([Buffer.from(type), data]);
		const out = Buffer.alloc(body.length + 8);
		out.writeUInt32BE(data.length, 0);
		body.copy(out, 4);
		out.writeUInt32BE(crc32(body), body.length + 4);
		return out;
	};
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header.set([8, 2, 0, 0, 0], 8);
	const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array(width).fill(rgb).flat())]);
	const pixels = Buffer.concat(Array(height).fill(row));
	return Buffer.concat([
		Buffer.from("\x89PNG\r\n\x1a\n", "latin1"),
		chunk("IHDR", header),
		chunk("IDAT", deflateSync(pixels)),
		chunk("IEND", Buffer.alloc(0)),
	]);
}

function crc32(data: Buffer): number {
	let crc = 0xffffffff;
	for (const byte of data) {
		crc ^= byte;
		for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
	}
	return (crc ^ 0xffffffff) >>> 0;
}

test("remote images stay out until the reader asks, and then only images load", async ({
	page,
	app,
}) => {
	const subject = "Frame: remote images";
	await app.deliver(
		mime({
			subject,
			to: app.account.mailbox,
			// Each resource has a host of its own, so the proxy's record says which ones were asked for.
			html: '<p>Newsletter</p><img src="https://one.images.test/a.png"><img src="https://two.images.test/b.png"><p style="background-image:url(https://styled.images.test/c.png)">styled</p><img src="http://plain-http.images.test/d.png">',
		}),
	);
	await app.signIn();
	await app.openMessage(subject);
	await expect(page.getByText("Remote images are hidden")).toBeVisible();
	await page.waitForTimeout(1000);
	expect(await app.contacted(), "before the reader asks").toEqual([]);

	await page.getByRole("button", { name: "Show images" }).click();
	await expect(page.getByText("Remote images are hidden")).toBeHidden();
	// The three https images are asked for. The plain-http one never is: the frame's policy
	// names `https:` only, so a message cannot make the browser send a request in the clear.
	await expect
		.poll(() => app.contacted(), { timeout: 10_000 })
		.toEqual(["one.images.test", "styled.images.test", "two.images.test"]);
	await page.waitForTimeout(500);
	expect(await app.contacted()).toEqual([
		"one.images.test",
		"styled.images.test",
		"two.images.test",
	]);
	// What the test could answer itself carried no Referer: the host learns nothing of the app.
	expect(app.watch.referers.filter((r) => r !== "")).toEqual([]);
});

test("a frame's mark is its own document's: a new document is unmarked until it stands at its size", async ({
	page,
	app,
}) => {
	const subject = "Frame: the mark of a document";
	await app.deliver(
		mime({
			subject,
			to: app.account.mailbox,
			html: '<p>Newsletter</p><img src="https://one.images.test/a.png">',
		}),
	);
	await app.signIn();
	// The first document is marked: openMessage waits for that.
	await app.openMessage(subject);
	// What happens to every frame element put on the page from now on, in order.
	await page.evaluate(() => {
		const marks: string[] = [];
		(window as unknown as { __marks: string[] }).__marks = marks;
		const old = new Set(document.querySelectorAll("iframe"));
		new MutationObserver((records) => {
			for (const record of records) {
				for (const node of record.addedNodes) {
					if (!(node instanceof HTMLIFrameElement) || old.has(node)) continue;
					marks.push(`inserted ${node.getAttribute("data-sized")}`);
				}
				const target = record.target;
				if (
					record.type === "attributes" &&
					target instanceof HTMLIFrameElement &&
					!old.has(target)
				) {
					marks.push(`marked ${target.getAttribute("data-sized")}`);
				}
			}
		}).observe(document.body, {
			subtree: true,
			childList: true,
			attributes: true,
			attributeFilter: ["data-sized"],
		});
	});
	// Showing the images is a new document, in a new frame element.
	await page.getByRole("button", { name: "Show images" }).click();
	await expect(page.locator('iframe[title="Email content"]')).toHaveAttribute("data-sized", "true");
	const marks = await page.evaluate(() => (window as unknown as { __marks: string[] }).__marks);
	// The new element comes unmarked and is marked later, by its own document. When that is, before
	// or after the frame's load event, is not part of the rule: the sizing script reports as soon as
	// it runs, and load waits for the document's pictures, which may be refused at once or late.
	expect(marks[0], marks.join(", ")).toBe("inserted null");
	expect(marks.indexOf("marked true"), marks.join(", ")).toBeGreaterThan(0);
});

test("an image the message embeds is shown without any request", async ({ page, app }) => {
	const subject = "Frame: embedded image";
	await app.deliver(
		mime({
			subject,
			to: app.account.mailbox,
			html: '<p>Our logo: <img id="logo" src="cid:logo@sender.test" alt="logo"></p>',
			parts: [
				{
					filename: "logo.png",
					type: "image/png",
					content: png(90, 30, [200, 30, 30]),
					cid: "logo@sender.test",
				},
			],
		}),
	);
	await app.signIn();
	await app.openMessage(subject);
	const image = page.frameLocator('iframe[title="Email content"]').locator("#logo");
	// The frame is replaced once the image has been fetched; the locator follows it.
	await expect(image).toHaveJSProperty("naturalWidth", 90);
	await expect(image).toHaveAttribute("src", /^data:image\/png;base64,/);
	expect(await app.contacted()).toEqual([]);
	// An embedded image is part of the message, not a file to download.
	await expect(page.getByText("logo.png")).toHaveCount(0);
});

test("a link opens outside the app, in a window that knows nothing of it", async ({
	page,
	context,
	app,
}) => {
	const subject = "Frame: links";
	await app.deliver(
		mime({
			subject,
			to: app.account.mailbox,
			html: '<p><a id="plain" href="https://canary.test/article">An article</a></p><p><a id="top" href="https://canary.test/takeover" target="_top">Aimed at the app</a></p>',
		}),
	);
	await app.signIn();
	await app.openMessage(subject);
	const frame = page.frameLocator('iframe[title="Email content"]');
	expect(await page.locator('iframe[title="Email content"]').getAttribute("sandbox")).toBe(
		MAIL_FRAME_SANDBOX,
	);

	// One click follows a link: the message is open once its frame stands at its size (#43).
	const follow = async (id: string) => {
		const opened = context.waitForEvent("page");
		await frame.locator(`#${id}`).click();
		return opened;
	};

	for (const id of ["plain", "top"]) {
		const popup = await follow(id);
		await popup.waitForLoadState("domcontentloaded");
		expect(new URL(popup.url()).origin, id).toBe("https://canary.test");
		// The new window has no handle on the app, and it is an ordinary window, not a sandboxed one.
		expect(await popup.evaluate(() => window.opener === null), id).toBe(true);
		expect(await popup.evaluate(() => window.origin), id).toBe("https://canary.test");
		await popup.close();
		// The app stays where it was, also for the link that asked for the app's own window.
		expect(new URL(page.url()).pathname, id).toContain("/mailbox/");
	}
	expect(app.watch.referers.filter((r) => r !== "")).toEqual([]);
});

test("quoted text at the end of a reply is folded, and opens without leaving the frame", async ({
	page,
	app,
}) => {
	await app.signIn();
	await app.deliver(
		mime({
			subject: "Frame: folded quote",
			to: app.account.mailbox,
			html: `<p>My answer is above the fold.</p><blockquote>${"<p>An old line of the earlier message.</p>".repeat(12)}</blockquote>`,
		}),
	);
	const frame = await app.openMessage("Frame: folded quote");
	await expect(frame.getByText("My answer is above the fold.")).toBeVisible();
	const quoted = frame.getByText("An old line of the earlier message.").first();
	await expect(quoted).toBeHidden();

	// The frame is as tall as the message, and opening the fold makes it as tall as the message
	// now is: nothing is cut off and nothing scrolls inside it.
	const element = page.locator('iframe[title="Email content"]');
	const before = (await element.boundingBox())?.height ?? 0;
	// One click opens it: the message is open once its frame stands at its size (#43).
	await frame.getByText("Show quoted text").click();
	await expect(quoted).toBeVisible();
	await expect
		.poll(async () => (await element.boundingBox())?.height ?? 0)
		.toBeGreaterThan(before + 100);
	expect(await app.frameViolations(frame)).toEqual([]);
	expect(app.watch.errors).toEqual([]);
});

test("a long message is shown whole: the conversation scrolls, not the message inside it", async ({
	page,
	app,
}) => {
	await app.signIn();
	await app.deliver(
		mime({
			subject: "Frame: a long message",
			to: app.account.mailbox,
			html: "<p>A line of a long message.</p>".repeat(60),
		}),
	);
	await app.openMessage("Frame: a long message");
	const element = page.locator('iframe[title="Email content"]');
	await expect.poll(async () => (await element.boundingBox())?.height ?? 0).toBeGreaterThan(1000);
	// Reply sits under the whole message.
	await page.getByRole("button", { name: "Reply", exact: true }).scrollIntoViewIfNeeded();
	await expect(page.getByRole("button", { name: "Reply", exact: true })).toBeVisible();
});
