import { describe, expect, it } from "vitest";
import { features } from "../../workers/lib/features.ts";

describe("features", () => {
	it("is all off by default", () => {
		expect(features({})).toEqual({ agent: false, mcp: false });
	});

	it("turns a feature on only for the exact string true", () => {
		expect(features({ AGENT_ENABLED: "true", MCP_ENABLED: "TRUE" })).toEqual({
			agent: true,
			mcp: false,
		});
		expect(features({ AGENT_ENABLED: "1", MCP_ENABLED: "true" })).toEqual({
			agent: false,
			mcp: true,
		});
	});
});
