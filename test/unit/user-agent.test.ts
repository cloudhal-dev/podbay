import { describe, expect, it } from "vitest";
import { deviceOf } from "../../app/lib/user-agent.ts";

describe("the browser a session came from", () => {
	it.each([
		[
			"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
			"Chrome",
			"macOS",
		],
		[
			"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.1 Safari/605.1.15",
			"Safari",
			"macOS",
		],
		[
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0",
			"Edge",
			"Windows",
		],
		["Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0", "Firefox", "Linux"],
		[
			"Mozilla/5.0 (iPhone; CPU iPhone OS 19_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.1 Mobile/15E148 Safari/604.1",
			"Safari",
			"iPhone",
		],
		[
			"Mozilla/5.0 (Linux; Android 16; Pixel 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36",
			"Chrome",
			"Android",
		],
		[
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 OPR/125.0.0.0",
			"Opera",
			"Windows",
		],
	])("reads %s", (userAgent, browser, system) => {
		expect(deviceOf(userAgent)).toEqual({ browser, system });
	});

	it("says nothing about what it does not know", () => {
		expect(deviceOf("curl/8.9.0")).toEqual({ browser: null, system: null });
		expect(deviceOf("")).toEqual({ browser: null, system: null });
		expect(deviceOf(null)).toEqual({ browser: null, system: null });
	});
});
