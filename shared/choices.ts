// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * A person's choices (ADR-0012), as the shell puts them together: the choices that belong to
 * no module (`@podbay/contract/choices`) and mail's own (`./mail-choices`), joined in one order,
 * with a key given once. This is the one schema of them, for the Worker and the app alike.
 *
 * Writing is strict: the Worker refuses a change with a key or a value that is not here
 * (`shared/choices-schema.ts`, built from the table below). Reading is lenient: a stored value
 * that is no longer known reads as the default, and a stored key that is not known is left
 * where it is and is not given on.
 *
 * The app imports this module as it is, so nothing here needs the schema library.
 */
import {
	type ChoicesChangeOf,
	type ChoicesDocumentOf,
	choicesOver,
	joinTables,
	PERSON_CHOICES,
	type PersonChoices,
} from "@podbay/contract/choices";
import { MAIL_CHOICES, type MailChoices } from "./mail-choices";

export {
	APPEARANCES,
	type Appearance,
	CHOICES_VERSION,
	LANGUAGE_CHOICES,
	type LanguageChoice,
	MAX_CHOICES_BYTES,
} from "@podbay/contract/choices";
export {
	AFTER_FILING,
	type AfterFiling,
	DEFAULT_REPLIES,
	DENSITIES,
	type DefaultReply,
	type Density,
	PAGE_SIZES,
	type PageSize,
	READING_PANES,
	type ReadingPane,
} from "./mail-choices";

export type Choices = MailChoices & PersonChoices;
export type ChoiceKey = keyof Choices;

/**
 * The order of the keys, which is the order of a stored document's: the choices that belong to
 * no module stand where they stood when every choice was mail's.
 */
const ORDER: readonly ChoiceKey[] = [
	"density",
	"readingPane",
	"pageSize",
	"order",
	"defaultReply",
	"afterFiling",
	"shortcuts",
	"appearance",
	"language",
	"conversationView",
	"snippets",
	"hoverActions",
	"sendAndArchive",
	"undoSeconds",
	"notifications",
];

export const CHOICES = joinTables<Choices>(ORDER, [PERSON_CHOICES, MAIL_CHOICES]);

/** The choices that travel with the person. The others never leave the browser. */
export type TravellingKey = Exclude<ChoiceKey, "density" | "readingPane" | "notifications">;
/** What is kept with the account: the version, and only what the person chose. */
export type ChoicesDocument = ChoicesDocumentOf<Choices, TravellingKey>;
/** A change: only the keys that changed. `null` takes a choice back to its default. */
export type ChoicesChange = ChoicesChangeOf<Choices, TravellingKey>;
/** The answer of both routes: the whole document, and how often it was written (0: never). */
export interface ChoicesAnswer {
	choices: ChoicesDocument;
	rev: number;
}

const over = choicesOver<Choices, TravellingKey>(CHOICES);
export const TRAVELLING = over.TRAVELLING;
export const isTravelling = over.isTravelling;
export const DEFAULT_CHOICES = over.DEFAULTS;
export const readChoices = over.readChoices;
export const readDocument = over.readDocument;
export const withDocument = over.withDocument;
export const changeOf = over.changeOf;
export const chosenKeys = over.chosenKeys;
