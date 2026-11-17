// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * What every browser test gets: a signed-in page that is watched from the outside.
 *
 * The watch is the point. A hostile message must not be able to run a script, load anything
 * from anywhere, open a window, show a dialog or move the page. So every request that leaves
 * the app's origin is caught and counted, every `postMessage` to the page is kept, content
 * policy violations are collected in the page and in its frames, and dialogs and new windows
 * are recorded. A test then says what it expects of each.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test as base, expect, type Frame, type Page } from "@playwright/test";
import type { Account } from "./global-setup.ts";
import { PROXY } from "./proxy-address.ts";

export { expect };
export const BASE = "http://localhost:4174";
const root = (path: string) => fileURLToPath(new URL(`../../${path}`, import.meta.url));

/**
 * Hosts the browser talks to for itself, whatever page is open (form autofill, updates, safe
 * browsing). They are not something a message did. No test message names a host like these.
 */
const BROWSER_OWN = /(?:^|\.)(?:googleapis\.com|google\.com|gstatic\.com|gvt1\.com|gvt2\.com)$/;

/** A 1x1 PNG: what every request to another origin is answered with, so nothing really leaves. */
const PIXEL = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
	"base64",
);

export interface Part {
	filename: string;
	type: string;
	content: string | Buffer;
	/** Set for an image the message embeds: the Content-ID, without angle brackets. */
	cid?: string;
}

let sequence = 0;

/** A raw message. Every one has its own subject and Message-ID, so tests do not meet. */
export function mime(input: {
	subject: string;
	to: string;
	html?: string;
	text?: string;
	parts?: Part[];
	/** The Message-ID this message answers, so that several messages are one conversation. */
	inReplyTo?: string;
	/** Further header lines, as a mailing list adds them. */
	headers?: Record<string, string>;
}): string {
	sequence += 1;
	const id = `e2e-${Date.now()}-${sequence}@sender.test`;
	const body =
		input.html !== undefined
			? ["Content-Type: text/html; charset=utf-8", "", input.html]
			: ["Content-Type: text/plain; charset=utf-8", "", input.text ?? ""];
	const head = [
		"From: Ada <ada@sender.test>",
		`To: ${input.to}`,
		`Subject: ${input.subject}`,
		`Message-ID: <${id}>`,
		"MIME-Version: 1.0",
		...(input.inReplyTo
			? [`In-Reply-To: <${input.inReplyTo}>`, `References: <${input.inReplyTo}>`]
			: []),
		...Object.entries(input.headers ?? {}).map(([name, value]) => `${name}: ${value}`),
	];
	if (!input.parts?.length) return [...head, ...body, ""].join("\r\n");
	const boundary = `b-${sequence}`;
	const lines = [...head, `Content-Type: multipart/mixed; boundary="${boundary}"`, ""];
	lines.push(`--${boundary}`, ...body);
	for (const part of input.parts) {
		lines.push(
			`--${boundary}`,
			`Content-Type: ${part.type}; name="${part.filename}"`,
			`Content-Disposition: ${part.cid ? "inline" : "attachment"}; filename="${part.filename}"`,
			...(part.cid ? [`Content-ID: <${part.cid}>`] : []),
			"Content-Transfer-Encoding: base64",
			"",
			Buffer.from(part.content).toString("base64"),
		);
	}
	lines.push(`--${boundary}--`, "");
	return lines.join("\r\n");
}

export interface Watch {
	/**
	 * Requests to other origins that the test could see and answer itself, as
	 * `<resource type> <url>`. Not the whole picture: see `App.contacted`.
	 */
	readonly external: string[];
	/** The `Referer` each of those requests carried; empty when it carried none. */
	readonly referers: string[];
	readonly dialogs: string[];
	readonly popups: Page[];
	/** Console errors and uncaught exceptions of the page. */
	readonly errors: string[];
}

export interface App {
	readonly account: Account;
	readonly watch: Watch;
	/** Use the session the run signed in with once. A test about signing in does that itself. */
	signIn(): Promise<void>;
	/** Deliver a raw message to the instance's local mail endpoint. */
	deliver(raw: string): Promise<void>;
	/** Open the mailbox, then the message with this subject. Returns the mail frame. */
	openMessage(subject: string): Promise<Frame>;
	/**
	 * Every host other than the app's that the browser tried to reach during this test, sorted.
	 * This is the whole picture: what the test answered itself and what reached the proxy.
	 */
	contacted(): Promise<string[]>;
	/** Content policy violations and messages seen by the page itself. */
	seen(): Promise<{ violations: string[]; messages: unknown[] }>;
	/** Content policy violations inside a frame. */
	frameViolations(frame: Frame): Promise<string[]>;
}

/** Runs in every document before its own scripts: the page and each frame keep their own record. */
function record(): void {
	const state = { violations: [] as string[], messages: [] as unknown[] };
	(window as unknown as { __watch: typeof state }).__watch = state;
	document.addEventListener("securitypolicyviolation", (event) => {
		state.violations.push(`${event.violatedDirective} ${event.blockedURI}`);
	});
	window.addEventListener("message", (event) => {
		const data = event.data as { __emailIframeHeight?: boolean } | null;
		// The one message the mail frame is meant to send is its height.
		if (data && typeof data === "object" && data.__emailIframeHeight === true) return;
		state.messages.push(event.data);
	});
}

export const test = base.extend<{ app: App }>({
	app: async ({ page, context }, use) => {
		const account = JSON.parse(readFileSync(root(".e2e/account.json"), "utf8")) as Account;
		const watch: Watch = { external: [], referers: [], dialogs: [], popups: [], errors: [] };

		// A request to another origin that the test can see is answered here with a pixel. One it
		// cannot see (the mail frame runs in a process of its own) reaches the proxy, which writes
		// the host down and refuses it. `contacted()` reads both.
		await fetch(`${PROXY}/__reset`, { method: "POST" });
		await context.route("**/*", async (route) => {
			const request = route.request();
			const url = request.url();
			if (url.startsWith(BASE)) return route.continue();
			watch.external.push(`${request.resourceType()} ${url}`);
			watch.referers.push(request.headers().referer ?? "");
			return route.fulfill({ status: 200, contentType: "image/png", body: PIXEL });
		});
		await context.addInitScript(record);
		page.on("dialog", (dialog) => {
			watch.dialogs.push(`${dialog.type()}: ${dialog.message()}`);
			void dialog.dismiss();
		});
		context.on("page", (popup) => {
			if (popup !== page) watch.popups.push(popup);
		});
		page.on("pageerror", (error) => watch.errors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error") watch.errors.push(message.text());
		});

		const watchOf = (target: Page | Frame) =>
			target.evaluate(
				() =>
					(window as unknown as { __watch?: { violations: string[]; messages: unknown[] } })
						.__watch ?? { violations: ["the watch did not start"], messages: [] },
			);

		await use({
			account,
			watch,
			async signIn() {
				const { cookie } = JSON.parse(readFileSync(root(".e2e/session.json"), "utf8")) as {
					cookie: string;
				};
				await context.addCookies(
					cookie.split("; ").map((pair) => {
						const at = pair.indexOf("=");
						return { name: pair.slice(0, at), value: pair.slice(at + 1), url: BASE };
					}),
				);
				// The tests share one person, and a person's choices are kept with their account
				// (ADR-0012): what one test chose is taken back, so the next starts from the defaults.
				const headers = { cookie, origin: BASE, "content-type": "application/json" };
				const kept = (await (await fetch(`${BASE}/api/v1/me/choices`, { headers })).json()) as {
					choices: Record<string, unknown>;
				};
				const chosen = Object.keys(kept.choices).filter((key) => key !== "v");
				if (chosen.length > 0) {
					const res = await fetch(`${BASE}/api/v1/me/choices`, {
						method: "PUT",
						headers,
						body: JSON.stringify(Object.fromEntries(chosen.map((key) => [key, null]))),
					});
					expect(res.status, "taking back the choices of the test before").toBe(200);
				}
			},
			async deliver(raw) {
				const res = await fetch(
					`${BASE}/cdn-cgi/local/email?from=ada@sender.test&to=${encodeURIComponent(account.mailbox)}`,
					{ method: "POST", body: raw },
				);
				expect(res.status, "delivering a message").toBe(200);
			},
			async openMessage(subject) {
				await page.goto(`/mailbox/${encodeURIComponent(account.mailbox)}/emails/inbox`);
				await page.getByText(subject, { exact: false }).first().click();
				const element = page.locator('iframe[title="Email content"]').first();
				await expect(element).toBeVisible();
				// The frame element is replaced when the body changes (embedded images arriving), so
				// the document is asked for until a live one answers.
				let frame: Frame | null = null;
				await expect
					.poll(async () => {
						frame = (await (await element.elementHandle())?.contentFrame()) ?? null;
						return frame !== null && !frame.isDetached();
					})
					.toBe(true);
				const live = frame as Frame | null;
				if (live === null) throw new Error("the mail frame has no document");
				await live.waitForLoadState("load");
				return live;
			},
			async contacted() {
				const viaProxy = (await (await fetch(`${PROXY}/__contacts`)).json()) as string[];
				const answered = watch.external.map((entry) => new URL(entry.split(" ")[1] ?? "").hostname);
				return [...new Set([...viaProxy, ...answered])]
					.filter((host) => !BROWSER_OWN.test(host))
					.sort();
			},
			seen: () => watchOf(page),
			async frameViolations(frame) {
				return (await watchOf(frame)).violations;
			},
		});
	},
});
