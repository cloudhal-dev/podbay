// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { useSyncExternalStore } from "react";
import { create } from "zustand";
import { deviceLanguage, LANGUAGES, setLanguage } from "~/i18n";

export const DENSITIES = ["default", "comfortable", "compact"] as const;
export type Density = (typeof DENSITIES)[number];
export const READING_PANES = ["none", "right", "below"] as const;
export type ReadingPane = (typeof READING_PANES)[number];
export const PAGE_SIZES = [10, 25, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZES)[number];
export const DEFAULT_REPLIES = ["reply", "reply-all"] as const;
export type DefaultReply = (typeof DEFAULT_REPLIES)[number];
export const AFTER_FILING = ["list", "newer", "older"] as const;
export type AfterFiling = (typeof AFTER_FILING)[number];
export const APPEARANCES = ["system", "light", "dark"] as const;
export type Appearance = (typeof APPEARANCES)[number];
/** The language of the app's own words: this device's, or one chosen. */
export const LANGUAGE_CHOICES = ["system", ...LANGUAGES] as const;
export type LanguageChoice = (typeof LANGUAGE_CHOICES)[number];

const KEY = "podbay.display";
/** The reading pane needs room: without it a conversation always replaces the list. */
const WIDE = "(min-width: 1024px)";
/** Under the list a pane needs height more than width. */
const TALL = "(min-width: 768px) and (min-height: 640px)";
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
	language: LanguageChoice;
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
	language: "system",
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
		language: oneOf(LANGUAGE_CHOICES, saved.language, DEFAULT_CHOICES.language),
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

/** Puts the app's words in the chosen language, or this device's. */
function speak(choice: LanguageChoice): void {
	setLanguage(choice === "system" ? deviceLanguage() : choice);
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
		speak(next.language);
		set(change);
	},
	setDensity: (density) => get().choose({ density }),
	setReadingPane: (readingPane) => get().choose({ readingPane }),
}));

// The words are in the reader's language before anything is drawn.
speak(useDisplay.getState().language);

// The appearance holds from the first paint, and "system" follows the system while the app is open.
showAppearance(useDisplay.getState().appearance);
window.matchMedia(DARK).addEventListener("change", () => {
	showAppearance(useDisplay.getState().appearance);
});

/** Whether the screen is of a size, kept up to date as the window changes. */
function useRoom(media: string): boolean {
	return useSyncExternalStore(
		(notify) => {
			const query = window.matchMedia(media);
			query.addEventListener("change", notify);
			return () => query.removeEventListener("change", notify);
		},
		() => window.matchMedia(media).matches,
		() => false,
	);
}

/**
 * Where a conversation opens with the list still on screen: beside it or under it, when the
 * reader chose that and the screen has room. `null` when a conversation replaces the list.
 */
export function useSplit(): "right" | "below" | null {
	const wide = useRoom(WIDE);
	const tall = useRoom(TALL);
	const pane = useDisplay((state) => state.readingPane);
	if (pane === "right" && wide) return "right";
	if (pane === "below" && tall) return "below";
	return null;
}
