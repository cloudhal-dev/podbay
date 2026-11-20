// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import type { ListOrder } from "@podbay/mail/shared";
import { useEffect, useSyncExternalStore } from "react";
import {
	type Appearance,
	CHOICES_VERSION,
	type Choices,
	type ChoicesAnswer,
	changeOf,
	chosenKeys,
	DEFAULT_CHOICES,
	type Density,
	isTravelling,
	type LanguageChoice,
	type ReadingPane,
	readChoices,
	type TravellingKey,
	withDocument,
} from "shared/choices";
import { create } from "zustand";
import { deviceLanguage, setLanguage } from "~/i18n";
import { fetchChoices, saveChoices } from "~/lib/session";

export { LIST_ORDERS, type ListOrder } from "@podbay/mail/shared";
// The schema of the choices is shared with the Worker (ADR-0012); the screens take it from here.
export {
	AFTER_FILING,
	type AfterFiling,
	APPEARANCES,
	type Appearance,
	type Choices,
	DEFAULT_CHOICES,
	DEFAULT_REPLIES,
	DENSITIES,
	type DefaultReply,
	type Density,
	LANGUAGE_CHOICES,
	type LanguageChoice,
	PAGE_SIZES,
	type PageSize,
	READING_PANES,
	type ReadingPane,
	readChoices,
} from "shared/choices";

const KEY = "podbay.display";
/** The reading pane needs room: without it a conversation always replaces the list. */
const WIDE = "(min-width: 1024px)";
/** Under the list a pane needs height more than width. */
const TALL = "(min-width: 768px) and (min-height: 640px)";
const DARK = "(prefers-color-scheme: dark)";

/**
 * This browser's copy of a person's choices (ADR-0012, decision 5). It is what the first paint
 * is drawn from, so the language and the appearance hold before anything is asked. For the
 * choices that travel it is a cache: the account's document wins once it is read. It says
 * whose it is, and which changes the account has not got yet. Its shape is the app's own.
 */
interface Copy {
	choices: Choices;
	/** The person the travelling part belongs to; `null` until someone signed in here. */
	owner: string | null;
	/** Travelling choices changed here and not yet taken by the Worker. */
	unsent: TravellingKey[];
}

function remembered(): Copy {
	try {
		const saved: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? "{}");
		const { owner, unsent } = (saved ?? {}) as { owner?: unknown; unsent?: unknown };
		return {
			choices: readChoices(saved),
			owner: typeof owner === "string" ? owner : null,
			unsent: Array.isArray(unsent) ? unsent.filter(isTravelling) : [],
		};
	} catch {
		return { choices: DEFAULT_CHOICES, owner: null, unsent: [] };
	}
}

const copy = remembered();

function remember(): void {
	try {
		window.localStorage.setItem(
			KEY,
			JSON.stringify({ ...copy.choices, owner: copy.owner, unsent: copy.unsent }),
		);
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
	setOrder: (order: ListOrder) => void;
}

export const useDisplay = create<DisplayState>((_set, get) => ({
	...copy.choices,
	// A change applies at once, and what travels is then sent (decision 6).
	choose: (change) => {
		const changed = Object.keys(change).filter(isTravelling);
		copy.unsent = [...new Set([...copy.unsent, ...changed])];
		show({ ...copy.choices, ...change });
		if (changed.length > 0) void send();
	},
	setDensity: (density) => get().choose({ density }),
	setReadingPane: (readingPane) => get().choose({ readingPane }),
	setOrder: (order) => get().choose({ order }),
}));

/** Puts choices in force everywhere they show, and keeps them for the next first paint. */
function show(next: Choices): void {
	copy.choices = next;
	remember();
	showAppearance(next.appearance);
	speak(next.language);
	useDisplay.setState(next);
}

let sending: Promise<void> | null = null;
/**
 * The newest writing of the account's document seen here. An answer that was on its way while
 * a newer one arrived is older than what is on screen and is not laid over it.
 */
let seen = 0;

/**
 * Sends what was changed here and not yet taken: only those keys, a default as `null`. A
 * change that cannot be sent stays in force on this device and stays unsent; it goes at the
 * next contact, where it is then the last write. Nothing is sent before someone signed in.
 */
function send(): Promise<void> {
	if (sending !== null) return sending;
	sending = (async () => {
		while (copy.owner !== null && copy.unsent.length > 0) {
			const owner = copy.owner;
			const keys = [...copy.unsent];
			const change = changeOf(copy.choices, keys);
			let answer: ChoicesAnswer;
			try {
				answer = await saveChoices(change);
			} catch {
				return;
			}
			// Someone else signed in here meanwhile: the answer is not theirs.
			if (copy.owner !== owner) return;
			// A choice changed again while this was on its way is still to be sent.
			const now = changeOf(copy.choices, keys);
			copy.unsent = copy.unsent.filter((key) => !keys.includes(key) || now[key] !== change[key]);
			seen = Math.max(seen, answer.rev);
			show(withDocument(copy.choices, answer.choices, copy.unsent));
		}
	})().finally(() => {
		sending = null;
	});
	return sending;
}

let reading: Promise<void> | null = null;

/**
 * Brings this browser and the person's account together: when the app loads and when its tab
 * is come back to (decision 7). The account wins for the choices that travel, except for
 * changes made here that it has not got yet, which are sent now. Another person's copy is not
 * this person's: its travelling part goes back to the defaults before theirs is read. When
 * the account has no document yet, this browser brings its choices along (decision 8).
 */
export function syncChoices(userId: string): Promise<void> {
	if (copy.owner !== userId) {
		const foreign = copy.owner !== null;
		copy.owner = userId;
		seen = 0;
		if (foreign) {
			copy.unsent = [];
			show(withDocument(copy.choices, { v: CHOICES_VERSION }));
		} else {
			remember();
		}
	}
	if (reading !== null) return reading;
	reading = (async () => {
		// What is on its way is the last write: it goes first, and the answer is read after it.
		await send();
		let answer: ChoicesAnswer;
		try {
			answer = await fetchChoices();
		} catch {
			// No answer: the copy stays what the screens are drawn from.
			return;
		}
		if (copy.owner !== userId || answer.rev < seen) return;
		seen = answer.rev;
		if (answer.rev === 0) {
			copy.unsent = [...new Set([...copy.unsent, ...chosenKeys(copy.choices)])];
		}
		show(withDocument(copy.choices, answer.choices, copy.unsent));
		await send();
	})().finally(() => {
		reading = null;
	});
	return reading;
}

/** Keeps the signed-in person's choices in step with their account while the app is open. */
export function useChoicesSync(userId: string | undefined): void {
	useEffect(() => {
		if (userId === undefined) return;
		void syncChoices(userId);
		const back = () => {
			if (document.visibilityState === "visible") void syncChoices(userId);
		};
		document.addEventListener("visibilitychange", back);
		return () => document.removeEventListener("visibilitychange", back);
	}, [userId]);
}

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
