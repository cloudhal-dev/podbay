// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * A person's choices about how the mail screens look and behave (ADR-0012). This is the one
 * schema of them, for the Worker and the app alike: which choices there are, the values each
 * can take, its default, and whether it travels with the person or stays with the device.
 *
 * Writing is strict: the Worker refuses a change with a key or a value that is not here
 * (`shared/choices-schema.ts`, built from the table below). Reading is lenient: a stored value
 * that is no longer known reads as the default, and a stored key that is not known is left
 * where it is and is not given on.
 *
 * The app imports this module as it is, so nothing here needs the schema library.
 */
import { LIST_ORDERS, type ListOrder } from "./list-order";

/** The version of the stored document. A document with a higher one is not read or written. */
export const CHOICES_VERSION = 1;
/** The largest body `PUT /api/v1/me/choices` takes. */
export const MAX_CHOICES_BYTES = 4096;

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
/** The language of the app's own words: this device's, or one the app speaks (`app/i18n`). */
export const LANGUAGE_CHOICES = ["system", "en", "tr"] as const;
export type LanguageChoice = (typeof LANGUAGE_CHOICES)[number];
const YES_OR_NO = [true, false] as const;

export interface Choices {
	/** How tall a line of a list is. */
	density: Density;
	/** Whether a conversation opens beside the list. */
	readingPane: ReadingPane;
	/** Conversations on one page of a list. */
	pageSize: PageSize;
	/** What a list puts on top: the newest, or what is unread or starred (ADR-0014). */
	order: ListOrder;
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
export type ChoiceKey = keyof Choices;

interface Rule<K extends ChoiceKey> {
	/** Every value the choice can take. Nothing is free text. */
	readonly values: readonly Choices[K][];
	/** What it is for a person who never chose. Not stored, so it can change for them. */
	readonly initial: Choices[K];
	/**
	 * `person`: kept with the account and the same on every device. `device`: its right value
	 * depends on the device (the room on its screen, a permission its browser gave), so it
	 * stays in the browser.
	 */
	readonly kept: "person" | "device";
}

/** The schema: decision 4 of ADR-0012, and the order of a list by decision 25 of ADR-0014. */
export const CHOICES: { readonly [K in ChoiceKey]: Rule<K> } = {
	density: { values: DENSITIES, initial: "default", kept: "device" },
	readingPane: { values: READING_PANES, initial: "none", kept: "device" },
	pageSize: { values: PAGE_SIZES, initial: 25, kept: "person" },
	order: { values: LIST_ORDERS, initial: "newest", kept: "person" },
	defaultReply: { values: DEFAULT_REPLIES, initial: "reply", kept: "person" },
	afterFiling: { values: AFTER_FILING, initial: "list", kept: "person" },
	shortcuts: { values: YES_OR_NO, initial: true, kept: "person" },
	appearance: { values: APPEARANCES, initial: "system", kept: "person" },
	language: { values: LANGUAGE_CHOICES, initial: "system", kept: "person" },
	conversationView: { values: YES_OR_NO, initial: true, kept: "person" },
	snippets: { values: YES_OR_NO, initial: true, kept: "person" },
	hoverActions: { values: YES_OR_NO, initial: true, kept: "person" },
	sendAndArchive: { values: YES_OR_NO, initial: false, kept: "person" },
	notifications: { values: YES_OR_NO, initial: false, kept: "device" },
};

const KEYS = Object.keys(CHOICES) as ChoiceKey[];

/** The choices that travel with the person. The others never leave the browser. */
export type TravellingKey = Exclude<ChoiceKey, "density" | "readingPane" | "notifications">;
export const TRAVELLING: readonly TravellingKey[] = KEYS.filter(
	(key): key is TravellingKey => CHOICES[key].kept === "person",
);
export const isTravelling = (key: string): key is TravellingKey =>
	TRAVELLING.some((one) => one === key);

/** What is kept with the account: the version, and only what the person chose. */
export type ChoicesDocument = { v: typeof CHOICES_VERSION } & {
	[K in TravellingKey]?: Choices[K];
};
/** A change: only the keys that changed. `null` takes a choice back to its default. */
export type ChoicesChange = { [K in TravellingKey]?: Choices[K] | null };
/** The answer of both routes: the whole document, and how often it was written (0: never). */
export interface ChoicesAnswer {
	choices: ChoicesDocument;
	rev: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

function known<K extends ChoiceKey>(key: K, value: unknown): Choices[K] | undefined {
	return CHOICES[key].values.find((one) => one === value);
}

function put<K extends ChoiceKey>(into: Partial<Choices>, key: K, value: Choices[K]): void {
	into[key] = value;
}

export const DEFAULT_CHOICES: Choices = (() => {
	const all: Partial<Choices> = {};
	for (const key of KEYS) put(all, key, CHOICES[key].initial);
	return all as Choices;
})();

/** Whatever was stored, as valid choices: an unknown value falls back to its default. */
export function readChoices(saved: unknown): Choices {
	const from = isRecord(saved) ? saved : {};
	const all: Partial<Choices> = {};
	for (const key of KEYS) put(all, key, known(key, from[key]) ?? CHOICES[key].initial);
	return all as Choices;
}

/**
 * A stored document as it is given on: the travelling choices it holds with a value that is
 * known, and nothing else. A key this version does not know is not in the answer (and stays in
 * the stored document); a document of a later version, or something that is no document,
 * reads as one without choices.
 */
export function readDocument(stored: unknown): ChoicesDocument {
	const document: ChoicesDocument = { v: CHOICES_VERSION };
	if (!isRecord(stored)) return document;
	if (stored.v !== undefined && !(typeof stored.v === "number" && stored.v <= CHOICES_VERSION)) {
		return document;
	}
	const chosen: Partial<Choices> = {};
	for (const key of TRAVELLING) {
		const value = known(key, stored[key]);
		if (value !== undefined) put(chosen, key, value);
	}
	return { ...document, ...chosen };
}

/** The choices with the account's document laid over them: the server wins for what travels. */
export function withDocument(
	choices: Choices,
	document: ChoicesDocument,
	/** Changes made here that the account has not got yet: they stay as they are. */
	unsent: readonly TravellingKey[] = [],
): Choices {
	const next: Partial<Choices> = { ...choices };
	for (const key of TRAVELLING) {
		if (unsent.includes(key)) continue;
		put(next, key, known(key, document[key]) ?? CHOICES[key].initial);
	}
	return next as Choices;
}

/** The change that carries these keys as they are now. A default is sent as `null`. */
export function changeOf(choices: Choices, keys: readonly TravellingKey[]): ChoicesChange {
	const change: Record<string, unknown> = {};
	for (const key of keys) {
		change[key] = choices[key] === CHOICES[key].initial ? null : choices[key];
	}
	return change as ChoicesChange;
}

/** The travelling choices that are not the default: what a person chose, as far as is known. */
export function chosenKeys(choices: Choices): TravellingKey[] {
	return TRAVELLING.filter((key) => choices[key] !== CHOICES[key].initial);
}
