// @vitest-environment jsdom
// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Tier 0: the answer under a conversation goes on in the window when the conversation is left,
 * and only then (#104). In development React mounts under StrictMode, which runs every effect, its
 * clean-up and the effect again; that rehearsal is not a person leaving, and the answer stays.
 */
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useAnswerFollowsToWindow } from "~/hooks/useAnswerFollowsToWindow";
import { useUIStore } from "~/hooks/useUIStore";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Answer() {
	useAnswerFollowsToWindow();
	return null;
}

/** Lets the microtasks queued by a clean-up run. */
const settle = () => act(async () => {});

describe("the answer under a conversation", () => {
	let host: HTMLElement;
	let root: Root;

	beforeEach(() => {
		useUIStore.setState({ isComposing: true, composePlacement: "inline" });
		host = document.createElement("div");
		document.body.appendChild(host);
		root = createRoot(host);
	});

	afterEach(() => {
		host.remove();
	});

	it("stays under the conversation when it is mounted under StrictMode", async () => {
		await act(async () => root.render(createElement(StrictMode, null, createElement(Answer))));
		await settle();
		expect(useUIStore.getState().composePlacement).toBe("inline");
		await act(async () => root.unmount());
	});

	it("goes on in the window when the conversation is left", async () => {
		await act(async () => root.render(createElement(StrictMode, null, createElement(Answer))));
		await settle();
		await act(async () => root.unmount());
		await settle();
		expect(useUIStore.getState().composePlacement).toBe("window");
		expect(useUIStore.getState().isComposing).toBe(true);
	});

	it("leaves a closed answer alone", async () => {
		await act(async () => root.render(createElement(Answer)));
		useUIStore.setState({ isComposing: false });
		await act(async () => root.unmount());
		await settle();
		expect(useUIStore.getState().composePlacement).toBe("inline");
	});
});
