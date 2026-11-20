// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * A person's choices as they are kept and as they are taken (ADR-0012), written out. Where the
 * table of choices lives, and who gives which part of it, must leave all of this as it is: the
 * order of the keys, the defaults, the bytes of a change and of a document for a person who set
 * every choice, and what the strict schema takes and refuses.
 */
import { describe, expect, it } from "vitest";
import {
	CHOICES,
	type Choices,
	changeOf,
	chosenKeys,
	DEFAULT_CHOICES,
	readDocument,
	TRAVELLING,
} from "../../shared/choices.ts";
import { parseChange } from "../../shared/choices-schema.ts";

/** A person who set every choice to something other than its default. */
const EVERY: Choices = {
	density: "compact",
	readingPane: "right",
	pageSize: 50,
	order: "unread",
	defaultReply: "reply-all",
	afterFiling: "newer",
	shortcuts: false,
	appearance: "dark",
	language: "tr",
	conversationView: false,
	snippets: false,
	hoverActions: false,
	sendAndArchive: true,
	undoSeconds: 30,
	notifications: true,
};

/** The change, and the document, of that person: byte for byte. */
const CHANGE =
	'{"pageSize":50,"order":"unread","defaultReply":"reply-all","afterFiling":"newer","shortcuts":false,"appearance":"dark","language":"tr","conversationView":false,"snippets":false,"hoverActions":false,"sendAndArchive":true,"undoSeconds":30}';
const EVERY_DOCUMENT = `{"v":1,${CHANGE.slice(1)}`;

describe("the choices as they are kept", () => {
	it("are these keys, in this order, with these defaults", () => {
		expect(Object.keys(CHOICES)).toEqual([
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
		]);
		expect(TRAVELLING).toEqual([
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
		]);
		expect(JSON.stringify(DEFAULT_CHOICES)).toBe(
			'{"density":"default","readingPane":"none","pageSize":25,"order":"newest","defaultReply":"reply","afterFiling":"list","shortcuts":true,"appearance":"system","language":"system","conversationView":true,"snippets":true,"hoverActions":true,"sendAndArchive":false,"undoSeconds":10,"notifications":false}',
		);
	});

	it("make the same change and the same document for a person who set every choice", () => {
		const change = JSON.stringify(changeOf(EVERY, chosenKeys(EVERY)));
		expect(change).toBe(CHANGE);
		expect(JSON.stringify(readDocument(JSON.parse(EVERY_DOCUMENT)))).toBe(EVERY_DOCUMENT);
		// Taking every choice back sends each as null, in the same order.
		expect(JSON.stringify(changeOf(DEFAULT_CHOICES, TRAVELLING))).toBe(
			'{"pageSize":null,"order":null,"defaultReply":null,"afterFiling":null,"shortcuts":null,"appearance":null,"language":null,"conversationView":null,"snippets":null,"hoverActions":null,"sendAndArchive":null,"undoSeconds":null}',
		);
	});
});

describe("the strict schema", () => {
	const takes: unknown[] = [
		{},
		JSON.parse(CHANGE),
		{ pageSize: null, appearance: null },
		{ pageSize: 10 },
		{ pageSize: 100 },
		{ order: "starred" },
		{ defaultReply: "reply" },
		{ afterFiling: "older" },
		{ shortcuts: true },
		{ appearance: "light" },
		{ language: "system" },
		{ language: "en" },
		{ undoSeconds: 5 },
		{ sendAndArchive: false },
	];
	const refuses: unknown[] = [
		{ theme: "dark" },
		{ pageSize: 10, theme: "dark" },
		{ v: 1 },
		{ density: "compact" },
		{ readingPane: "right" },
		{ notifications: true },
		{ pageSize: 7 },
		{ pageSize: "50" },
		{ order: "oldest" },
		{ language: "xx" },
		{ shortcuts: "yes" },
		{ undoSeconds: 60 },
		{ appearance: { mode: "dark" } },
		[{ pageSize: 10 }],
		null,
		"pageSize",
		42,
	];

	it("takes exactly these changes, as they were sent", () => {
		for (const body of takes) expect(parseChange(body), JSON.stringify(body)).toEqual(body);
	});

	it("refuses exactly these, whole", () => {
		for (const body of refuses) expect(parseChange(body), JSON.stringify(body)).toBeNull();
	});
});
