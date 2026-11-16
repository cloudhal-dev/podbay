import { describe, expect, it } from "vitest";
import { allPins, checkPins, newestSettled, readManifest } from "../../scripts/pins.ts";

const DAY = 86_400_000;

describe("checkPins", () => {
	it("accepts exact stable versions", () => {
		expect(checkPins({ dependencies: { a: "1.2.3" }, devDependencies: { b: "10.0.0" } })).toEqual(
			[],
		);
	});

	it.each(["^1.2.3", "~1.2.3", "1.x", "latest", "1.2.3-beta.1", "1.2", ">=1.0.0", "workspace:*"])(
		"rejects %j",
		(version) => {
			expect(checkPins({ dependencies: { a: version } })).toHaveLength(1);
		},
	);

	it("wants a dated exception for a 0.x release", () => {
		expect(checkPins({ dependencies: { a: "0.4.0" } })).toHaveLength(1);
		expect(
			checkPins({ dependencies: { a: "0.4.0" }, pinExceptions: { a: "2026-11-17: no 1.0 yet" } }),
		).toEqual([]);
	});

	it("rejects an exception for a package that is not installed", () => {
		expect(
			checkPins({ dependencies: {}, pinExceptions: { gone: "2026-11-17: old" } }),
		).toHaveLength(1);
	});

	it("passes on this repository", () => {
		const manifest = readManifest();
		expect(allPins(manifest).length).toBeGreaterThan(20);
		expect(checkPins(manifest)).toEqual([]);
	});
});

describe("newestSettled", () => {
	const now = Date.parse("2026-11-17T00:00:00Z");
	const at = (daysAgo: number) => new Date(now - daysAgo * DAY).toISOString();

	it("picks the newest stable version that is old enough", () => {
		const times = {
			created: at(900),
			modified: at(0),
			"1.0.0": at(400),
			"1.9.0": at(30),
			"1.10.0": at(10),
			"2.0.0": at(1),
			"2.0.0-rc.1": at(20),
		};
		expect(newestSettled(times, now, 3)).toBe("1.10.0");
	});

	it("returns nothing when every version is too new", () => {
		expect(newestSettled({ "1.0.0": at(1) }, now, 3)).toBeUndefined();
	});
});
