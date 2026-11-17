// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { randomBytes } from "node:crypto";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Tier 3: the Worker's handlers in the real Workers runtime. `remoteBindings: false` keeps every
// binding local, so a test can never reach a real account or send real mail (rule D7). The two
// secrets are generated for each run; none is ever written to the repository (rule S6).
const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

const TEST_FILES = readdirSync(here(".")).filter((name) => name.endsWith(".test.ts")).length;

export default defineConfig({
	plugins: [
		cloudflareTest(async () => ({
			remoteBindings: false,
			wrangler: { configPath: here("../../wrangler.jsonc") },
			miniflare: {
				bindings: {
					TEST_MIGRATIONS: await readD1Migrations(here("../../migrations")),
					AUTH_SECRET: randomBytes(32).toString("hex"),
					SETUP_TOKEN: randomBytes(24).toString("hex"),
					// Stated here so a developer's own .dev.vars cannot switch a feature on in a test.
					AGENT_ENABLED: "false",
					MCP_ENABLED: "false",
				},
			},
		})),
	],
	resolve: {
		alias: { "~": here("../../app"), shared: here("../../shared") },
	},
	test: {
		root: here("../.."),
		include: ["test/workerd/**/*.test.ts"],
		// One worker for each test file. A worker that is given a second file exits ("Worker
		// exited unexpectedly"), so the suite must not depend on how many cores the machine has.
		maxWorkers: TEST_FILES,
		testTimeout: 60_000,
		hookTimeout: 60_000,
	},
});
