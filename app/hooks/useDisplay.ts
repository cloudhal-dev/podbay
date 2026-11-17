// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { useSyncExternalStore } from "react";
import { create } from "zustand";

export const DENSITIES = ["default", "comfortable", "compact"] as const;
export type Density = (typeof DENSITIES)[number];
export const READING_PANES = ["none", "right"] as const;
export type ReadingPane = (typeof READING_PANES)[number];
export const PAGE_SIZES = [10, 25, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZES)[number];
export const DEFAULT_REPLIES = ["reply", "reply-all"] as const;
export type DefaultReply = (typeof DEFAULT_REPLIES)[number];
export const AFTER_FILING = ["list", "newer", "older"] as const;
export type AfterFiling = (typeof AFTER_FILING)[number];
export const APPEARANCES = ["system", "light", "dark"] as const;
export type Appearance = (typeof APPEARANCES)[number];

const KEY = "podbay.display";
/** The reading pane needs room: below this width a conversation always replaces the list. */
const WIDE = "(min-width: 1024px)";
const DARK = "(prefers-color-scheme: dark)";

/**
 * A person's choices about how the mail screens look and behave. They are kept in this browser
 * only: a convenience, never something the Worker decides by.
 */
export interface Choices {
	/** How tall a line of a list is. */
	density: Density;
	/** Whether a conversation opens beside the list. */
	readingPane: ReadingPane;
	/** Conversations on one page of a list. */
	pageSize: PageSize;
	/** What the Reply button of a message does. */
	defaultReply: DefaultReply;
	/** Where to go after the open conversation is archived, deleted, moved or reported. */
	afterFiling: AfterFiling;
	/** Whether single keys act as shortcuts. */
	shortcuts: boolean;
	appearance: Appearance;
	/** Whether the messages of a conversation are one line and one screen, or each its own. */
	conversationView: boolean;
	/** Whether a line shows the start of the message after the subject. */
	snippets: boolean;
	/** Whether the line under the pointer offers archive, delete and read in place of its date. */
	hoverActions: boolean;
	/** Whether an answer can be sent and its conversation archived in one press. */
	sendAndArchive: boolean;
	/** Whether new mail is announced by a notification of this device. */
	notifications: boolean;
}

export const DEFAULT_CHOICES: Choices = {
	density: "default",
	readingPane: "none",
	pageSize: 25,
	defaultReply: "reply",
	afterFiling: "list",
	shortcuts: true,
	appearance: "system",
	conversationView: true,
	snippets: true,
	hoverActions: true,
	sendAndArchive: false,
	notifications: false,
};

const oneOf = <T>(allowed: readonly T[], value: unknown, fallback: T): T =>
	allowed.find((item) => item === value) ?? fallback;
const yesOrNo = (value: unknown, fallback: boolean): boolean =>
	typeof value === "boolean" ? value : fallback;

/** Whatever was stored, as valid choices: an unknown value falls back to its default. */
export function readChoices(saved: Partial<Record<keyof Choices, unknown>>): Choices {
	return {
		density: oneOf(DENSITIES, saved.density, DEFAULT_CHOICES.density),
		readingPane: oneOf(READING_PANES, saved.readingPane, DEFAULT_CHOICES.readingPane),
		pageSize: oneOf(PAGE_SIZES, saved.pageSize, DEFAULT_CHOICES.pageSize),
		defaultReply: oneOf(DEFAULT_REPLIES, saved.defaultReply, DEFAULT_CHOICES.defaultReply),
		afterFiling: oneOf(AFTER_FILING, saved.afterFiling, DEFAULT_CHOICES.afterFiling),
		shortcuts: yesOrNo(saved.shortcuts, DEFAULT_CHOICES.shortcuts),
		appearance: oneOf(APPEARANCES, saved.appearance, DEFAULT_CHOICES.appearance),
		conversationView: yesOrNo(saved.conversationView, DEFAULT_CHOICES.conversationView),
		snippets: yesOrNo(saved.snippets, DEFAULT_CHOICES.snippets),
		hoverActions: yesOrNo(saved.hoverActions, DEFAULT_CHOICES.hoverActions),
		sendAndArchive: yesOrNo(saved.sendAndArchive, DEFAULT_CHOICES.sendAndArchive),
		notifications: yesOrNo(saved.notifications, DEFAULT_CHOICES.notifications),
	};
}

function remembered(): Choices {
	try {
		return readChoices(JSON.parse(window.localStorage.getItem(KEY) ?? "{}"));
	} catch {
		return DEFAULT_CHOICES;
	}
}

function remember(choices: Choices): void {
	try {
		window.localStorage.setItem(KEY, JSON.stringify(choices));
	} catch {
		// Private windows and blocked storage: the screens open with the defaults next time.
	}
}

/** Light or dark, on the document, where the components read it. */
function showAppearance(appearance: Appearance): void {
	const dark =
		appearance === "dark" || (appearance === "system" && window.matchMedia(DARK).matches);
	document.documentElement.setAttribute("data-mode", dark ? "dark" : "light");
}

interface DisplayState extends Choices {
	choose: (change: Partial<Choices>) => void;
	setDensity: (density: Density) => void;
	setReadingPane: (readingPane: ReadingPane) => void;
}

const choicesOf = (state: Choices): Choices => readChoices(state);

export const useDisplay = create<DisplayState>((set, get) => ({
	...remembered(),
	choose: (change) => {
		const next = { ...choicesOf(get()), ...change };
		remember(next);
		showAppearance(next.appearance);
		set(change);
	},
	setDensity: (density) => get().choose({ density }),
	setReadingPane: (readingPane) => get().choose({ readingPane }),
}));

// The appearance holds from the first paint, and "system" follows the system while the app is open.
showAppearance(useDisplay.getState().appearance);
window.matchMedia(DARK).addEventListener("change", () => {
	showAppearance(useDisplay.getState().appearance);
});

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
