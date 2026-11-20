/**
 * The content policies (rules S4 and S11): the page's, the mail frame's and the API's. The mail
 * frame is a `srcdoc` document and inherits the page's policy, so the two are held together
 * here: the page allows what the frame needs and nothing looser than that.
 */
import { describe, expect, it } from "vitest";
import {
	embedInlineImages,
	inlineImages,
	MAX_INLINE_IMAGE_BYTES,
} from "../../app/lib/inline-images.ts";
import { freshNonce, mailContentPolicy, mailDocument } from "../../app/lib/mail-html.ts";
import {
	MAIL_FRAME_SANDBOX,
	MAIL_FRAME_SCRIPT,
	MAIL_FRAME_SCRIPT_HASH,
} from "../../modules/mail/shared/mail-frame.ts";
import {
	API_CONTENT_POLICY,
	PAGE_CONTENT_POLICY_DIRECTIVES as PAGE,
	PAGE_CONTENT_POLICY,
} from "../../shared/security-headers.ts";

function directives(policy: string): Record<string, string[]> {
	return Object.fromEntries(
		policy.split(";").map((part) => {
			const [name = "", ...sources] = part.trim().split(/\s+/);
			return [name, sources];
		}),
	);
}

describe("the page's content policy", () => {
	it("starts from nothing and names every kind of load", () => {
		expect(PAGE["default-src"]).toEqual(["'none'"]);
		expect(PAGE["object-src"]).toEqual(["'none'"]);
		expect(PAGE["base-uri"]).toEqual(["'none'"]);
		expect(PAGE["frame-ancestors"]).toEqual(["'none'"]);
		expect(PAGE["connect-src"]).toEqual(["'self'"]);
		expect(PAGE["form-action"]).toEqual(["'self'"]);
	});

	it("runs the app's own script and one inline script by its hash, nothing else", () => {
		expect(PAGE["script-src"]).toEqual(["'self'", `'${MAIL_FRAME_SCRIPT_HASH}'`]);
		expect(PAGE_CONTENT_POLICY).not.toMatch(/unsafe-eval|strict-dynamic|wasm-unsafe-eval/);
	});

	it("names no host, no wildcard and no plain-http source anywhere", () => {
		for (const [name, sources] of Object.entries(PAGE)) {
			for (const source of sources) {
				expect(source, name).toMatch(
					/^'(?:none|self|unsafe-inline|sha256-[A-Za-z0-9+/=]+)'$|^(?:data|blob|https):$/,
				);
			}
		}
		// The wider entries exist for the mail frame only, and only where the frame needs them.
		const wide = Object.entries(PAGE)
			.filter(([, sources]) => sources.some((s) => s === "'unsafe-inline'" || s === "https:"))
			.map(([name]) => name);
		expect(wide.sort()).toEqual(["img-src", "style-src"]);
	});

	it("is one header line, as the assets file needs it", () => {
		expect(PAGE_CONTENT_POLICY).not.toContain("\n");
		expect(directives(PAGE_CONTENT_POLICY)["script-src"]).toEqual(PAGE["script-src"]);
	});
});

describe("the frame's sizing script", () => {
	it("has the hash the page's policy names", async () => {
		const digest = await crypto.subtle.digest(
			"SHA-256",
			new TextEncoder().encode(MAIL_FRAME_SCRIPT),
		);
		const base64 = btoa(String.fromCharCode(...new Uint8Array(digest)));
		expect(MAIL_FRAME_SCRIPT_HASH).toBe(`sha256-${base64}`);
	});

	it("is exactly what the mail document puts in its one script element", () => {
		const nonce = freshNonce();
		const html = mailDocument({
			sanitizedBody: "<p>Hi</p>",
			autoSize: true,
			allowRemote: false,
			nonce,
		});
		const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\b[^>]*>/gi)].map(
			(m) => m[1],
		);
		expect(scripts).toEqual([MAIL_FRAME_SCRIPT]);
		const without = mailDocument({
			sanitizedBody: "<p>Hi</p>",
			autoSize: false,
			allowRemote: false,
			nonce,
		});
		expect(without).not.toContain("<script");
	});
});

describe("the mail frame inside the page", () => {
	it.each([false, true])(
		"needs nothing the page does not allow (remote content: %s)",
		(allowRemote) => {
			const frame = directives(mailContentPolicy({ allowRemote, nonce: freshNonce() }));
			for (const name of ["style-src", "img-src"]) {
				for (const source of frame[name] ?? []) {
					expect(PAGE[name], `${name} ${source}`).toContain(source);
				}
			}
			// Its script is allowed by nonce in the frame and by hash in the page: the same script.
			expect(frame["script-src"]).toEqual([expect.stringMatching(/^'nonce-/)]);
			expect(frame["default-src"]).toEqual(["'none'"]);
		},
	);

	it("stays narrower than the page: no remote image until the reader asks, never a form", () => {
		const closed = directives(mailContentPolicy({ allowRemote: false, nonce: freshNonce() }));
		expect(closed["img-src"]).toEqual(["data:"]);
		expect(closed["form-action"]).toEqual(["'none'"]);
		expect(closed["connect-src"]).toBeUndefined();
	});
});

describe("the mail frame's sandbox", () => {
	it("gives the frame no origin, no way to move the app, no forms and no downloads", () => {
		const allowed = MAIL_FRAME_SANDBOX.split(" ").sort();
		expect(allowed).toEqual(["allow-popups", "allow-popups-to-escape-sandbox", "allow-scripts"]);
	});
});

describe("the API's content policy", () => {
	it("allows nothing and sandboxes whatever a browser would show", () => {
		expect(directives(API_CONTENT_POLICY)).toEqual({
			"default-src": ["'none'"],
			"frame-ancestors": ["'none'"],
			sandbox: [],
		});
	});
});

describe("images a message embeds", () => {
	const image = (over: Record<string, unknown> = {}) => ({
		id: "a1",
		filename: "logo.png",
		mimetype: "image/png",
		size: 1000,
		content_id: "<logo@sender.test>",
		disposition: "inline",
		...over,
	});

	it("are only plain images, embedded by the message, of a modest size", () => {
		expect(inlineImages([image()]).map((a) => a.id)).toEqual(["a1"]);
		expect(inlineImages([image({ mimetype: "image/svg+xml" })])).toEqual([]);
		expect(inlineImages([image({ mimetype: "text/html" })])).toEqual([]);
		expect(inlineImages([image({ disposition: "attachment" })])).toEqual([]);
		expect(inlineImages([image({ content_id: undefined })])).toEqual([]);
		expect(inlineImages([image({ size: MAX_INLINE_IMAGE_BYTES + 1 })])).toEqual([]);
		expect(inlineImages(undefined)).toEqual([]);
	});

	it("stop at a total size, however many a message carries", () => {
		const many = Array.from({ length: 10 }, (_, i) =>
			image({ id: `a${i}`, size: MAX_INLINE_IMAGE_BYTES, content_id: `<c${i}@x>` }),
		);
		expect(inlineImages(many)).toHaveLength(4);
	});

	it("replace their cid references and leave every other reference alone", () => {
		const body =
			'<img src="cid:logo@sender.test"><img src="CID:logo@sender.test"><img src="cid:other@x">';
		const out = embedInlineImages(
			body,
			new Map([["logo@sender.test", "data:image/png;base64,AAAA"]]),
		);
		expect(out).toBe(
			'<img src="data:image/png;base64,AAAA"><img src="data:image/png;base64,AAAA"><img src="cid:other@x">',
		);
	});

	it("treat a content id as text, not as a pattern", () => {
		const out = embedInlineImages(
			'<img src="cid:a.b+c@x">',
			new Map([["a.b+c@x", "data:image/gif;base64,$&"]]),
		);
		expect(out).toBe('<img src="data:image/gif;base64,$&">');
		expect(
			embedInlineImages('<img src="cid:aXb+c@x">', new Map([["a.b+c@x", "data:x"]])),
		).toContain("cid:aXb");
	});
});
