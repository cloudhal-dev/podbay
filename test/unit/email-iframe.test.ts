// @vitest-environment jsdom
// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Tier 0: the page holds the mail frame's limits whatever the frame says (#110). The script in
 * the frame is the stranger's neighbour, so here it is taken to be hostile: the frame reports
 * without end, with any numbers, and the page follows a bounded number of reports up to a
 * bounded height and then stands still.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import EmailIframe from "~/components/EmailIframe";
import { FRAME_MAX_HEIGHT, FRAME_MAX_REPORTS } from "../../modules/mail/shared/mail-frame.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("the page and a frame that reports without end", () => {
	let host: HTMLElement;
	let root: Root;

	beforeEach(async () => {
		host = document.createElement("div");
		document.body.appendChild(host);
		root = createRoot(host);
		await act(async () =>
			root.render(createElement(EmailIframe, { body: "<p>A message.</p>", autoSize: true })),
		);
	});

	afterEach(async () => {
		await act(async () => root.unmount());
		host.remove();
	});

	const frame = () => host.querySelector("iframe") as HTMLIFrameElement;
	const height = () => Number.parseFloat(frame().style.height);

	/** One message as the frame's own window would send it, with whatever it carries. */
	const report = (data: unknown, source: Window | null = frame().contentWindow) =>
		act(async () => {
			window.dispatchEvent(new MessageEvent("message", { data, source }));
		});

	it("follows the frame's reports, and stops at its own count however many more come", async () => {
		for (let one = 1; one <= FRAME_MAX_REPORTS; one++)
			await report({ __emailIframeHeight: true, height: 100 + one });
		expect(height()).toBe(100 + FRAME_MAX_REPORTS);
		for (let one = 0; one < 2_000; one++)
			await report({ __emailIframeHeight: true, height: 5_000 + one });
		expect(height(), "the page stands still past its count").toBe(100 + FRAME_MAX_REPORTS);
	});

	/** Shows a new message, so the next report comes from a fresh frame with a fresh count. */
	const freshFrame = async (body: string) => {
		await act(async () => root.render(createElement(EmailIframe, { body, autoSize: true })));
	};

	it.each([FRAME_MAX_HEIGHT + 1, 1e9, Number.MAX_VALUE])(
		"a fresh frame that reports %s stands at its own highest and no taller",
		async (reported) => {
			await freshFrame(`<p>A message that says it is ${reported} tall.</p>`);
			await report({ __emailIframeHeight: true, height: reported });
			expect(height()).toBe(FRAME_MAX_HEIGHT);
		},
	);

	it.each([Number.POSITIVE_INFINITY, Number.NaN, -1, 0, "99999", null])(
		"a fresh frame that reports %s is not followed: its height stays as it was",
		async (reported) => {
			await freshFrame(`<p>A message that says it is ${String(reported)} tall.</p>`);
			const before = height();
			expect(Number.isFinite(before)).toBe(true);
			await report({ __emailIframeHeight: true, height: reported });
			expect(height()).toBe(before);
		},
	);

	it("takes nothing from a window that is not its own frame", async () => {
		const before = height();
		await report({ __emailIframeHeight: true, height: 900 }, window);
		await report({ __emailIframeHeight: true, height: 900 }, null);
		expect(height()).toBe(before);
	});
});
