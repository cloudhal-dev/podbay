// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Tier 0: the browser tests' shared session stays fresh through any one test, however long the
 * run is (#43). It is made again once older than `RENEW_AFTER_SECONDS`, so a test starts with a
 * session at most that old and must end before the session is `FRESH_SECONDS` old, with a minute
 * to spare. A test that may run longer, or a fresh window made shorter, fails here first.
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FRESH_SECONDS } from "../../workers/auth/fresh.ts";
import { LONGEST_TEST_SECONDS, RENEW_AFTER_SECONDS } from "../e2e/session.ts";

const e2e = new URL("../e2e/", import.meta.url);
const read = (name: string) => readFileSync(new URL(name, e2e), "utf8");

/** Seconds of a timeout written as a number of milliseconds, such as `120_000`. */
const seconds = (literal: string) => Number(literal.replaceAll("_", "")) / 1000;

/** Timeouts that are not a number, each with the longest it can be, read by a person. */
const COMPUTED: Record<string, number> = {
	// live.spec.ts: IDLE_SECONDS is 65 unless PODBAY_E2E_IDLE_SECONDS sets it.
	"(IDLE_SECONDS + 60) * 1000": 125,
};

describe("the browser tests' shared session", () => {
	it("is made again early enough to stay fresh through the longest test", () => {
		expect(RENEW_AFTER_SECONDS + LONGEST_TEST_SECONDS + 60).toBeLessThanOrEqual(FRESH_SECONDS);
	});

	it("holds every test's timeout to the longest one", () => {
		const config = /\btimeout: ([\d_]+),/.exec(read("playwright.config.ts"));
		expect(config, "the config's timeout per test").not.toBeNull();
		expect(seconds(config?.[1] ?? "0")).toBeLessThanOrEqual(LONGEST_TEST_SECONDS);

		const computed: string[] = [];
		for (const file of readdirSync(e2e).filter((name) => name.endsWith(".spec.ts"))) {
			for (const [, value] of read(file).matchAll(/test\.setTimeout\(([^;]+)\);/g)) {
				const timeout = (value ?? "").trim();
				if (/^[\d_]+$/.test(timeout)) {
					expect(seconds(timeout), `${file}: test.setTimeout(${timeout})`).toBeLessThanOrEqual(
						LONGEST_TEST_SECONDS,
					);
				} else {
					computed.push(timeout);
					expect(
						COMPUTED[timeout],
						`${file}: test.setTimeout(${timeout}) is not known`,
					).toBeDefined();
					expect(COMPUTED[timeout]).toBeLessThanOrEqual(LONGEST_TEST_SECONDS);
				}
			}
		}
		expect(computed.sort()).toEqual(Object.keys(COMPUTED).sort());
	});
});
