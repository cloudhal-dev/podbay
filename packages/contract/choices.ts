// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * A person's choices as any client reads and writes them (ADR-0012; ADR-0018, decision 2): the
 * form of a choice, the stored document and its version, the pure functions over a table of
 * choices, and the two choices that belong to no module (how the app looks, and its language).
 * A module gives its own table; the shell joins them (`joinTables`), and a key is given once.
 *
 * Writing is strict: the Worker refuses a change with a key or a value the joined table does
 * not have. Reading is lenient: a stored value that is no longer known reads as the default,
 * and a stored key that is not known is left where it is and is not given on.
 */

/** The version of the stored document. A document with a higher one is not read or written. */
export const CHOICES_VERSION = 1;
/** The largest body `PUT /api/v1/me/choices` takes. */
export const MAX_CHOICES_BYTES = 4096;

/** What a choice can be: one of a few values, never free text. */
export type ChoiceValue = string | number | boolean;

export interface ChoiceRule<V extends ChoiceValue> {
	/** Every value the choice can take. Nothing is free text. */
	readonly values: readonly V[];
	/** What it is for a person who never chose. Not stored, so it can change for them. */
	readonly initial: V;
	/**
	 * `person`: kept with the account and the same on every device. `device`: its right value
	 * depends on the device (the room on its screen, a permission its browser gave), so it
	 * stays in the browser.
	 */
	readonly kept: "person" | "device";
}

/** A table of choices: for each key of `C`, the rule of its value. */
export type ChoiceTable<C> = { readonly [K in keyof C]: ChoiceRule<C[K] & ChoiceValue> };

export const APPEARANCES = ["system", "light", "dark"] as const;
export type Appearance = (typeof APPEARANCES)[number];
/** The language of the app's own words: this device's, or one the app speaks. */
export const LANGUAGE_CHOICES = ["system", "en", "tr"] as const;
export type LanguageChoice = (typeof LANGUAGE_CHOICES)[number];

/** The choices that belong to no module. */
export interface PersonChoices {
	appearance: Appearance;
	language: LanguageChoice;
}
export const PERSON_CHOICES: ChoiceTable<PersonChoices> = {
	appearance: { values: APPEARANCES, initial: "system", kept: "person" },
	language: { values: LANGUAGE_CHOICES, initial: "system", kept: "person" },
};

/**
 * The tables of the parts of the product as one, with its keys in `order`. A key given by two
 * tables, a key no table gives, and a key of a table that `order` leaves out are each refused:
 * the order of the keys is the order of a stored document's, so it is written down once.
 */
export function joinTables<C>(
	order: readonly (keyof C & string)[],
	tables: readonly Readonly<Record<string, ChoiceRule<ChoiceValue>>>[],
): ChoiceTable<C> {
	const given = new Map<string, ChoiceRule<ChoiceValue>>();
	for (const table of tables) {
		for (const [key, rule] of Object.entries(table)) {
			if (given.has(key)) throw new Error(`the choice ${key} is given by two tables`);
			given.set(key, rule);
		}
	}
	const joined: Record<string, ChoiceRule<ChoiceValue>> = {};
	for (const key of order) {
		const rule = given.get(key);
		if (rule === undefined) throw new Error(`no table gives the choice ${key}`);
		joined[key] = rule;
		given.delete(key);
	}
	const left = [...given.keys()];
	if (left.length > 0) throw new Error(`the order leaves out the choices ${left.join(", ")}`);
	return joined as unknown as ChoiceTable<C>;
}

/** What is kept with the account: the version, and only what the person chose. */
export type ChoicesDocumentOf<C, T extends keyof C> = { v: typeof CHOICES_VERSION } & {
	[K in T]?: C[K];
};
/** A change: only the keys that changed. `null` takes a choice back to its default. */
export type ChoicesChangeOf<C, T extends keyof C> = { [K in T]?: C[K] | null };

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The pure functions over one table: its keys, the ones that travel with the person, the
 * defaults, and reading, laying over and changing them. `T` names the keys whose rule is kept
 * with the person; the table decides which they are.
 */
export function choicesOver<C, T extends keyof C & string>(table: ChoiceTable<C>) {
	const KEYS = Object.keys(table) as (keyof C & string)[];
	/** The choices that travel with the person. The others never leave the browser. */
	const TRAVELLING: readonly T[] = KEYS.filter((key): key is T => table[key].kept === "person");
	const isTravelling = (key: string): key is T => TRAVELLING.some((one) => one === key);

	function known<K extends keyof C>(key: K, value: unknown): C[K] | undefined {
		return table[key].values.find((one) => one === value) as C[K] | undefined;
	}
	function put<K extends keyof C>(into: Partial<C>, key: K, value: C[K]): void {
		into[key] = value;
	}

	const DEFAULTS: C = (() => {
		const all: Partial<C> = {};
		for (const key of KEYS) put(all, key, table[key].initial as C[typeof key]);
		return all as C;
	})();

	/** Whatever was stored, as valid choices: an unknown value falls back to its default. */
	function readChoices(saved: unknown): C {
		const from = isRecord(saved) ? saved : {};
		const all: Partial<C> = {};
		for (const key of KEYS) {
			put(all, key, known(key, from[key]) ?? (table[key].initial as C[typeof key]));
		}
		return all as C;
	}

	/**
	 * A stored document as it is given on: the travelling choices it holds with a value that is
	 * known, and nothing else. A key this version does not know is not in the answer (and stays
	 * in the stored document); a document of a later version, or something that is no document,
	 * reads as one without choices.
	 */
	function readDocument(stored: unknown): ChoicesDocumentOf<C, T> {
		const document = { v: CHOICES_VERSION } as ChoicesDocumentOf<C, T>;
		if (!isRecord(stored)) return document;
		if (stored.v !== undefined && !(typeof stored.v === "number" && stored.v <= CHOICES_VERSION)) {
			return document;
		}
		const chosen: Partial<C> = {};
		for (const key of TRAVELLING) {
			const value = known(key, stored[key]);
			if (value !== undefined) put(chosen, key, value);
		}
		return { ...document, ...chosen };
	}

	/** The choices with the account's document laid over them: the server wins for what travels. */
	function withDocument(
		choices: C,
		document: ChoicesDocumentOf<C, T>,
		/** Changes made here that the account has not got yet: they stay as they are. */
		unsent: readonly T[] = [],
	): C {
		const next: Partial<C> = { ...choices };
		for (const key of TRAVELLING) {
			if (unsent.includes(key)) continue;
			put(
				next,
				key,
				known(key, (document as Record<string, unknown>)[key]) ??
					(table[key].initial as C[typeof key]),
			);
		}
		return next as C;
	}

	/** The change that carries these keys as they are now. A default is sent as `null`. */
	function changeOf(choices: C, keys: readonly T[]): ChoicesChangeOf<C, T> {
		const change: Record<string, unknown> = {};
		for (const key of keys) {
			change[key] = choices[key] === table[key].initial ? null : choices[key];
		}
		return change as ChoicesChangeOf<C, T>;
	}

	/** The travelling choices that are not the default: what a person chose, as far as is known. */
	function chosenKeys(choices: C): T[] {
		return TRAVELLING.filter((key) => choices[key] !== table[key].initial);
	}

	return {
		TRAVELLING,
		isTravelling,
		DEFAULTS,
		readChoices,
		readDocument,
		withDocument,
		changeOf,
		chosenKeys,
	};
}
