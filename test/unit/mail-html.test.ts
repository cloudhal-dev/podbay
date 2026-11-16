/**
 * Rule S4: the mail renderer, tested against hostile bodies with a real DOM and the real
 * sanitiser. Each case is something a stranger can put in a message.
 */
import createDOMPurify from "dompurify";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import {
	freshNonce,
	mailContentPolicy,
	mailDocument,
	type Purifier,
	sanitizeMailHtml,
} from "../../app/lib/mail-html.ts";

const dom = new JSDOM("");
const purify = createDOMPurify(dom.window) as unknown as Purifier;

const blocked = (body: string) => sanitizeMailHtml(body, { allowRemote: false, purify });
const allowed = (body: string) => sanitizeMailHtml(body, { allowRemote: true, purify });

/** Parse the sanitised output so assertions are about the DOM, not about string shapes. */
function parse(html: string): Document {
	return new JSDOM(`<!DOCTYPE html><body>${html}</body>`).window.document;
}

describe("sanitizeMailHtml removes active content", () => {
	it.each([
		["a script element", "<p>hi</p><script>steal()</script>"],
		["an inline handler", '<img src="data:image/gif;base64,AA==" onerror="steal()">'],
		["an SVG with onload", '<svg onload="steal()"><circle r="1"/></svg>'],
		["a javascript link", '<a href="javascript:steal()">click</a>'],
		["a javascript link with entities", '<a href="jav&#x09;ascript:steal()">click</a>'],
		["a data HTML link", '<a href="data:text/html,<script>steal()</script>">click</a>'],
		["an iframe", '<iframe src="https://evil.test"></iframe>'],
		["an iframe with srcdoc", '<iframe srcdoc="<script>steal()</script>"></iframe>'],
		["an object and an embed", '<object data="https://evil.test/x.swf"></object><embed src="x">'],
		["a meta refresh", '<meta http-equiv="refresh" content="0;url=https://evil.test">'],
		["a base element", '<base href="https://evil.test/">'],
		["a style element", "<style>body{background:url(https://evil.test/p.gif)}</style>"],
		["a link stylesheet", '<link rel="stylesheet" href="https://evil.test/x.css">'],
		[
			"a form that posts away",
			'<form action="https://evil.test"><input name="password"><button>Go</button></form>',
		],
		["a formaction button", '<button formaction="https://evil.test">Go</button>'],
		[
			"a mutation-XSS classic",
			'<math><mtext><table><mglyph><style><!--</style><img title="--&gt;&lt;img src=1 onerror=steal()&gt;">',
		],
	])("%s", (_name, body) => {
		const document = parse(blocked(body).html);
		expect(
			document.querySelectorAll(
				"script, iframe, object, embed, meta, base, style, link, form, input, button",
			).length,
		).toBe(0);
		for (const element of document.querySelectorAll("*")) {
			for (const attribute of element.getAttributeNames()) {
				expect(attribute.startsWith("on"), `${element.tagName} keeps ${attribute}`).toBe(false);
				expect(["action", "formaction", "srcdoc"]).not.toContain(attribute);
			}
			const href = element.getAttribute("href");
			if (href !== null)
				expect(href.trim().toLowerCase()).not.toMatch(/^(javascript|data|vbscript):/);
		}
		expect(blocked(body).html).not.toContain("steal()");
	});

	it("keeps ordinary formatting", () => {
		const { html } = blocked(
			"<p>Hello <b>bold</b> <i>italic</i></p><ul><li>one</li></ul><table><tr><td>cell</td></tr></table>",
		);
		const document = parse(html);
		expect(document.querySelector("b")?.textContent).toBe("bold");
		expect(document.querySelectorAll("li, td").length).toBe(2);
	});
});

describe("sanitizeMailHtml and remote content", () => {
	it("takes a remote image out and counts it", () => {
		const result = blocked(
			'<p>Hi</p><img src="https://tracker.test/pixel.gif" width="1" height="1">',
		);
		expect(result.blockedRemote).toBe(1);
		expect(result.html).not.toContain("tracker.test");
	});

	it.each([
		["a protocol-relative image", '<img src="//tracker.test/p.gif">'],
		["an http image", '<img src="http://tracker.test/p.gif">'],
		["a srcset", '<img srcset="https://tracker.test/a.png 1x, https://tracker.test/b.png 2x">'],
		[
			"a table background",
			'<table background="https://tracker.test/bg.png"><tr><td>x</td></tr></table>',
		],
		["a CSS background", '<div style="background-image: url(https://tracker.test/bg.png)">x</div>'],
		[
			"a CSS background with quotes",
			"<div style=\"background:url('//tracker.test/bg.png')\">x</div>",
		],
	])("blocks %s", (_name, body) => {
		const result = blocked(body);
		expect(result.blockedRemote).toBeGreaterThan(0);
		expect(result.html).not.toContain("tracker.test");
	});

	it("keeps inline and attached images", () => {
		const result = blocked(
			'<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="><img src="cid:logo@sender.test">',
		);
		expect(result.blockedRemote).toBe(0);
		expect(parse(result.html).querySelectorAll("img").length).toBe(2);
	});

	it("keeps remote images once the reader allowed them, and counts nothing", () => {
		const result = allowed('<img src="https://cdn.sender.test/logo.png">');
		expect(result.blockedRemote).toBe(0);
		expect(result.html).toContain("https://cdn.sender.test/logo.png");
	});

	it("still removes active content when remote content is allowed", () => {
		const result = allowed(
			'<img src="https://cdn.sender.test/logo.png" onerror="steal()"><script>steal()</script>',
		);
		expect(result.html).not.toContain("steal()");
	});

	it("does not leak the hook into the next call", () => {
		blocked('<img src="https://tracker.test/p.gif">');
		expect(allowed('<img src="https://cdn.sender.test/logo.png">').html).toContain(
			"cdn.sender.test",
		);
	});
});

describe("links", () => {
	it("open outside the frame and send no referrer or opener", () => {
		const anchor = parse(
			blocked('<a href="https://example.org/page" target="_self" rel="opener">read</a>').html,
		).querySelector("a");
		expect(anchor?.getAttribute("href")).toBe("https://example.org/page");
		expect(anchor?.getAttribute("target")).toBe("_blank");
		expect(anchor?.getAttribute("rel")).toBe("noopener noreferrer nofollow");
	});
});

describe("mailContentPolicy", () => {
	const nonce = "QUJDREVGR0hJSktMTU5PUA==";

	it("allows no network load while remote content is blocked", () => {
		const policy = mailContentPolicy({ allowRemote: false, nonce });
		expect(policy).toContain("default-src 'none'");
		expect(policy).toContain("img-src data: cid:");
		expect(policy).not.toContain("https:");
		expect(policy).not.toContain("http:");
	});

	it("allows only https images once the reader allowed remote content", () => {
		const policy = mailContentPolicy({ allowRemote: true, nonce });
		expect(policy).toContain("img-src data: cid: https:");
		expect(policy).not.toMatch(/(connect|font|media|frame|object)-src/);
	});

	it("allows script only by nonce, never inline or by host", () => {
		const policy = mailContentPolicy({ allowRemote: true, nonce });
		expect(policy).toContain(`script-src 'nonce-${nonce}'`);
		expect(policy).not.toContain("script-src 'unsafe-inline'");
		expect(policy).not.toContain("unsafe-eval");
	});

	it("forbids form submission and a base element", () => {
		const policy = mailContentPolicy({ allowRemote: false, nonce });
		expect(policy).toContain("form-action 'none'");
		expect(policy).toContain("base-uri 'none'");
	});
});

describe("mailDocument", () => {
	it("carries the policy, a no-referrer hint and the nonce on its one script", () => {
		const nonce = freshNonce();
		const html = mailDocument({
			sanitizedBody: "<p>hi</p>",
			autoSize: true,
			allowRemote: false,
			nonce,
		});
		const document = new JSDOM(html).window.document;
		const policy = document
			.querySelector('meta[http-equiv="Content-Security-Policy"]')
			?.getAttribute("content");
		expect(policy).toBe(mailContentPolicy({ allowRemote: false, nonce }));
		expect(document.querySelector('meta[name="referrer"]')?.getAttribute("content")).toBe(
			"no-referrer",
		);
		const scripts = [...document.querySelectorAll("script")];
		expect(scripts).toHaveLength(1);
		expect(scripts[0]?.getAttribute("nonce")).toBe(nonce);
	});

	it("has no script at all when the frame does not size itself", () => {
		const html = mailDocument({
			sanitizedBody: "<p>hi</p>",
			autoSize: false,
			allowRemote: false,
			nonce: freshNonce(),
		});
		expect(new JSDOM(html).window.document.querySelectorAll("script").length).toBe(0);
	});

	it("refuses a nonce that could break out of the attribute", () => {
		expect(() =>
			mailDocument({ sanitizedBody: "", autoSize: true, allowRemote: false, nonce: '"><script>' }),
		).toThrow();
	});

	it("uses a different nonce every time", () => {
		const nonces = new Set(Array.from({ length: 50 }, () => freshNonce()));
		expect(nonces.size).toBe(50);
	});
});
