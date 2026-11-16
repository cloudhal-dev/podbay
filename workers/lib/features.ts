// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Optional features. The agent and the MCP server are off unless the deployer turns them on
 * (ADR-0001, decision 5): the agent calls a model, and both act on mail.
 */
export interface Features {
	readonly agent: boolean;
	readonly mcp: boolean;
}

export interface FeatureVars {
	readonly AGENT_ENABLED?: string;
	readonly MCP_ENABLED?: string;
}

/** Only the exact string "true" turns a feature on; anything else, and absence, is off. */
export function features(env: FeatureVars): Features {
	return {
		agent: env.AGENT_ENABLED === "true",
		mcp: env.MCP_ENABLED === "true",
	};
}
