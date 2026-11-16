import { describe, expect, it } from "vitest";
import { htmlToText } from "../../shared/html-text.ts";

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
