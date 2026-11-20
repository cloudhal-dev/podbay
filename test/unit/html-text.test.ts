import { describe, expect, it } from "vitest";
import { getSnippetText, htmlToPlainText, stripHtml } from "../../app/lib/utils.ts";
import { htmlToText } from "../../modules/mail/shared/html-text.ts";
import {
	buildQuotedReplyBlock,
	stripHtmlToText,
} from "../../modules/mail/worker/lib/email-helpers.ts";

describe("htmlToText", () => {
	it("keeps the text and drops the tags", () => {
		expect(htmlToText("<p>Hello <b>Podbay</b></p>")).toBe("Hello Podbay");
	});

	it("never shows the content of a script or a style", () => {
		const html = "<p>Hello</p><script>window.x=1</script><style>p{color:red}</style><p>there</p>";
		expect(htmlToText(html)).toBe("Hello there");
	});

	it("drops a script that is cut off before it closes", () => {
		expect(htmlToText("<p>Hello</p><script>window.x=1; steal(")).toBe("Hello");
	});

	it("drops a tag and a comment that are cut off", () => {
		expect(htmlToText('Hello <img src="https://tracker.test/p.gif')).toBe("Hello");
		expect(htmlToText("Hello <!-- secret")).toBe("Hello");
	});

	it("is not fooled by a tag name that only starts like script", () => {
		expect(htmlToText("<scripty>shown</scripty>")).toBe("shown");
		expect(htmlToText("<script>hidden</scripty>still hidden</script>shown")).toBe("shown");
	});

	it("handles upper case and attributes on raw-text elements", () => {
		expect(htmlToText('<SCRIPT type="text/javascript">x()</SCRIPT>ok')).toBe("ok");
	});

	it("is not slowed down by many raw-text elements: the work grows with the input, not its square", () => {
		// 60,000 elements in 900,000 characters. Copying the whole input once for each of them is
		// about fifty thousand million characters, and takes far longer than the bound.
		const html = `${"<style></style>".repeat(60_000)}<STYLE>x</STYLE>shown`;
		expect(html.length).toBeGreaterThan(900_000);
		const began = performance.now();
		expect(htmlToText(html)).toBe("shown");
		expect(performance.now() - began).toBeLessThan(1000);
	});

	it("keeps a bare less-than sign", () => {
		expect(htmlToText("a < b and c > d")).toBe("a < b and c > d");
	});

	it("puts no space around an inline element, and one between blocks and cells", () => {
		expect(htmlToText("<p>Hello from the <b>shop</b>.</p>")).toBe("Hello from the shop.");
		expect(htmlToText("<p>one</p><p>two</p>")).toBe("one two");
		expect(htmlToText("<table><tr><td>a</td><td>b</td></tr></table>")).toBe("a b");
		expect(htmlToText("un<i>break</i>able")).toBe("unbreakable");
	});

	it("collapses whitespace between blocks", () => {
		expect(htmlToText("<div>one</div>\n\n<div>two</div>")).toBe("one two");
	});

	it("returns nothing for nothing", () => {
		expect(htmlToText("")).toBe("");
		expect(htmlToText("<br><br>")).toBe("");
	});
});

describe("a list snippet cut from a real body", () => {
	it("shows the text and nothing from the script", () => {
		const body =
			'<p>Hello <b>Podbay</b></p><script>window.x=1</script><img src="https://tracker.test/p.gif">';
		expect(htmlToText(body.slice(0, 300))).toBe("Hello Podbay");
		// Cut in the middle of the script, as a 300-character snippet can be.
		expect(htmlToText(body.slice(0, body.indexOf("window.x") + 4))).toBe("Hello Podbay");
	});
});

describe("htmlToText with line breaks kept", () => {
	it("turns block boundaries into newlines", () => {
		const html = "<p>Hello Ada,</p><p>Two lines<br>here.</p><ul><li>one</li><li>two</li></ul>";
		expect(htmlToText(html, { keepLineBreaks: true })).toBe(
			"Hello Ada,\n\nTwo lines\nhere.\n\none\ntwo",
		);
	});

	it("still drops script content and never produces long runs of blank lines", () => {
		const html = "<div>a</div><div></div><div></div><div></div><script>x()</script><div>b</div>";
		const text = htmlToText(html, { keepLineBreaks: true });
		expect(text).not.toContain("x()");
		expect(text).not.toMatch(/\n{3,}/);
		expect(text.startsWith("a")).toBe(true);
		expect(text.endsWith("b")).toBe(true);
	});
});

describe("the text Podbay makes of a stranger's HTML", () => {
	// The forms a regular expression over markup misses: an end tag with a space or a line
	// break in it, capitals, a tag inside a tag, and a character reference written twice.
	const HOSTILE = [
		"<p>before</p><script >steal()</script ><p>after</p>",
		"<p>before</p><SCRIPT>steal()</SCRIPT><p>after</p>",
		"<p>before</p><script>steal()</script\n><p>after</p>",
		"<p>before</p><style >p{}</style ><p>after</p>",
	];
	// A tag inside a tag is one tag named "scr<script", as a browser reads it: what follows is
	// text, and no tag is left to put back together.
	const NESTED = "<p>before</p><scr<script>ipt>steal()</script><p>after</p>";
	const makers = {
		"the Worker's text for a model, a tool and a quote": stripHtmlToText,
		"the app's one-line text": stripHtml,
		"the app's list snippet": (html: string) => getSnippetText(html, 500),
		"the app's text part of a message": htmlToPlainText,
	};

	for (const [who, make] of Object.entries(makers)) {
		it(`${who}: never keeps script or style content, and never a tag`, () => {
			for (const html of HOSTILE) {
				const text = make(html);
				expect(text, html).toContain("before");
				expect(text, html).not.toContain("steal()");
				expect(text, html).not.toContain("p{}");
				expect(text, html).not.toMatch(/<\/?[a-z]/i);
			}
			expect(make(NESTED)).not.toMatch(/<\/?[a-z]/i);
		});

		it(`${who}: decodes each character reference once`, () => {
			expect(make("<p>a &amp;lt;b&amp;gt; c</p>")).toBe("a &lt;b&gt; c");
			expect(make("<p>caf&#233; &amp; co</p>")).toBe("café & co");
		});
	}

	it("a quoted reply shows what was written as text, and the reply holds no element of it", () => {
		const quoted = buildQuotedReplyBlock({
			sender: "ada@sender.test",
			date: "2026-11-18T10:00:00Z",
			body: "<p>&lt;script&gt;steal()&lt;/script&gt;</p><script >steal()</script >",
		});
		expect(quoted).toContain("&lt;script&gt;steal()&lt;/script&gt;");
		expect(quoted).not.toContain("<script");
		expect(quoted.match(/steal\(\)/g)).toHaveLength(1);
	});
});
