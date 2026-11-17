// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// Tier 0: pure code in Node. The Workers runtime tests have their own config (test/workerd).
export default defineConfig({
	// The app's own way of naming its modules, for a test that loads one of them.
	resolve: { alias: { "~": here("./app"), shared: here("./shared") } },
	test: {
		include: ["test/unit/**/*.test.ts"],
		testTimeout: 30_000,
	},
});
