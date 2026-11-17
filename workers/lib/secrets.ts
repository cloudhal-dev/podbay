// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Secrets and optional settings that are not in `wrangler.jsonc`. The generated `Env` type only
 * knows them on a machine that has a `.dev.vars` file, so they are read by name here and the
 * code never depends on which machine generated the types.
 */
export type SecretName = "AUTH_SECRET" | "SETUP_TOKEN" | "POLICY_AUD" | "TEAM_DOMAIN";

/** The value of a secret, or undefined when it is not set or is empty. */
export function secret(env: object, name: SecretName): string | undefined {
	const value = (env as Record<string, unknown>)[name];
	return typeof value === "string" && value !== "" ? value : undefined;
}
