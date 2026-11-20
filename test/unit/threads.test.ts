import { describe, expect, it } from "vitest";
import { normalizeSubject } from "../../modules/mail/worker/durableObject/threads.ts";

describe("comparing the subjects of two messages", () => {
	it.each([
		["Re: Budget", "budget"],
		["RE: re: Fwd: Budget", "budget"],
		["AW: WG: Budget ", "budget"],
		["Réf: Budget", "budget"],
		["Budget", "budget"],
		["Regarding the budget", "regarding the budget"],
		["", ""],
	])("%j is %j", (subject, expected) => {
		expect(normalizeSubject(subject)).toBe(expected);
	});
});
