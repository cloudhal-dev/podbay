// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * The tables of choices are joined by the shell (ADR-0018, decision 2): mail gives its own, the
 * choices that belong to no module come from the contract, and a key is given once.
 */
import { describe, expect, it } from "vitest";
import { joinTables, PERSON_CHOICES } from "../../packages/contract/choices.ts";
import { CHOICES, DEVICE_KEYS, TRAVELLING } from "../../shared/choices.ts";
import { MAIL_CHOICES } from "../../shared/mail-choices.ts";

const yesOrNo = { values: [true, false], initial: true, kept: "person" } as const;

describe("joining the tables of choices", () => {
	it("refuses a key given by two tables", () => {
		expect(() =>
			joinTables<{ shortcuts: boolean }>(
				["shortcuts"],
				[{ shortcuts: yesOrNo }, { shortcuts: yesOrNo }],
			),
		).toThrow("the choice shortcuts is given by two tables");
		// Mail giving one of the choices that belong to no module is the same mistake.
		expect(() =>
			joinTables(Object.keys(CHOICES) as never[], [
				PERSON_CHOICES,
				{ ...MAIL_CHOICES, language: yesOrNo },
			]),
		).toThrow("the choice language is given by two tables");
	});

	it("refuses an order that names a key no table gives, or leaves one out", () => {
		expect(() => joinTables<{ a: boolean; b: boolean }>(["a", "b"], [{ a: yesOrNo }])).toThrow(
			"no table gives the choice b",
		);
		expect(() => joinTables<{ a: boolean }>(["a"], [{ a: yesOrNo, b: yesOrNo }])).toThrow(
			"the order leaves out the choices b",
		);
	});

	it("keeps with the device exactly the choices its type keeps from travelling", () => {
		const onDevice = Object.entries(CHOICES)
			.filter(([, rule]) => rule.kept === "device")
			.map(([key]) => key);
		expect(onDevice).toEqual([...DEVICE_KEYS]);
		expect([...TRAVELLING, ...DEVICE_KEYS].sort()).toEqual(Object.keys(CHOICES).sort());
	});

	it("gives each choice the rule of the table that has it, and nothing else", () => {
		for (const [key, rule] of Object.entries(CHOICES)) {
			const from = key in PERSON_CHOICES ? PERSON_CHOICES : MAIL_CHOICES;
			expect(rule, key).toBe((from as Record<string, unknown>)[key]);
		}
		expect(Object.keys(CHOICES).sort()).toEqual(
			[...Object.keys(PERSON_CHOICES), ...Object.keys(MAIL_CHOICES)].sort(),
		);
		expect(Object.keys(PERSON_CHOICES)).toEqual(["appearance", "language"]);
	});
});
