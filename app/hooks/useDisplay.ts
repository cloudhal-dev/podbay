// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { useSyncExternalStore } from "react";
import { create } from "zustand";

export const DENSITIES = ["default", "comfortable", "compact"] as const;
export type Density = (typeof DENSITIES)[number];
export const READING_PANES = ["none", "right"] as const;
export type ReadingPane = (typeof READING_PANES)[number];

const KEY = "podbay.display";
/** The reading pane needs room: below this width a conversation always replaces the list. */
const WIDE = "(min-width: 1024px)";

interface Choices {
	density: Density;
	readingPane: ReadingPane;
}

const DEFAULTS: Choices = { density: "default", readingPane: "none" };

/** How the reader left the mail screens last time. A convenience kept in this browser only. */
function remembered(): Choices {
	try {
		const saved = JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as Partial<Choices>;
		return {
			density: DENSITIES.find((d) => d === saved.density) ?? DEFAULTS.density,
			readingPane: READING_PANES.find((p) => p === saved.readingPane) ?? DEFAULTS.readingPane,
		};
	} catch {
		return DEFAULTS;
	}
}

function remember(choices: Choices): void {
	try {
		window.localStorage.setItem(KEY, JSON.stringify(choices));
	} catch {
		// Private windows and blocked storage: the screens open with the defaults next time.
	}
}

interface DisplayState extends Choices {
	setDensity: (density: Density) => void;
	setReadingPane: (readingPane: ReadingPane) => void;
}

/** How the mail screens are laid out: how tall a line is, and whether a conversation opens beside the list. */
export const useDisplay = create<DisplayState>((set, get) => ({
	...remembered(),
	setDensity: (density) => {
		remember({ density, readingPane: get().readingPane });
		set({ density });
	},
	setReadingPane: (readingPane) => {
		remember({ density: get().density, readingPane });
		set({ readingPane });
	},
}));

function subscribeToWidth(notify: () => void): () => void {
	const query = window.matchMedia(WIDE);
	query.addEventListener("change", notify);
	return () => query.removeEventListener("change", notify);
}

/** Whether a conversation opens beside the list: the reader chose it and the screen has room. */
export function useSplit(): boolean {
	const wide = useSyncExternalStore(
		subscribeToWidth,
		() => window.matchMedia(WIDE).matches,
		() => false,
	);
	return useDisplay((state) => state.readingPane) === "right" && wide;
}
