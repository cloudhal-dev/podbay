// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Tier 0: the page holds the mail frame's limits itself (#110). A stranger writes every height
 * in a message; whatever the frame reports, the page follows a bounded number of reports at one
 * width, up to a bounded height, and nothing that is not a height.
 */
import { describe, expect, it } from "vitest";
import {
	FRAME_MAX_FOLLOWS,
	FRAME_MAX_HEIGHT,
	FRAME_MAX_REPORTS,
	type FrameReports,
	MAIL_FRAME_SCRIPT,
	nextFrameHeight,
} from "../../modules/mail/shared/mail-frame.ts";

const fresh = (): FrameReports => ({ counts: new Map() });

describe("the height the page gives the mail frame", () => {
	it("follows a height the frame reports, rounded up", () => {
		expect(nextFrameHeight(fresh(), 83.2, 600)).toBe(84);
	});

	it("is never above the highest the frame stands", () => {
		expect(nextFrameHeight(fresh(), FRAME_MAX_HEIGHT * 4, 600)).toBe(FRAME_MAX_HEIGHT);
	});

	it("follows nothing that is not a positive height", () => {
		for (const reported of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, "500", null, {}])
			expect(nextFrameHeight(fresh(), reported, 600), String(reported)).toBeNull();
	});

	it("stops following a document that reports without end at one width", () => {
		const seen = fresh();
		for (let report = 1; report <= FRAME_MAX_REPORTS; report++)
			expect(nextFrameHeight(seen, 100 + report, 600)).toBe(100 + report);
		expect(nextFrameHeight(seen, 10_000, 600), "one report past the limit").toBeNull();
		expect(nextFrameHeight(seen, 10_001, 600)).toBeNull();
	});

	it("gives a new width a count of its own, as when the reader resizes the window", () => {
		const seen = fresh();
		for (let report = 0; report < FRAME_MAX_REPORTS; report++) nextFrameHeight(seen, 200, 600);
		expect(nextFrameHeight(seen, 300, 600)).toBeNull();
		expect(nextFrameHeight(seen, 300, 480)).toBe(300);
	});

	it("keeps the count of a width seen before, so a scrollbar that comes and goes cannot renew it", () => {
		// A message can only flip the frame between two widths: with the page's scrollbar and without.
		const seen = fresh();
		let followed = 0;
		for (let report = 0; report < 10 * FRAME_MAX_REPORTS; report++)
			if (nextFrameHeight(seen, 100 + report, report % 2 === 0 ? 600 : 585) !== null) followed++;
		expect(followed).toBe(2 * FRAME_MAX_REPORTS);
	});
});

describe("the frame's script", () => {
	it("holds the same limits as the page", () => {
		expect(MAIL_FRAME_SCRIPT).toContain(`h >= ${FRAME_MAX_HEIGHT}`);
		expect(MAIL_FRAME_SCRIPT).toContain(`told[innerWidth] >= ${FRAME_MAX_REPORTS}`);
		expect(MAIL_FRAME_SCRIPT).toContain(`++follows >= ${FRAME_MAX_FOLLOWS}`);
	});
});
