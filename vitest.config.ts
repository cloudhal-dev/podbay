// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { defineConfig } from "vitest/config";

// Tier 0: pure code in Node. The Workers runtime tests have their own config (test/workerd).
export default defineConfig({
	test: {
		include: ["test/unit/**/*.test.ts"],
		testTimeout: 30_000,
	},
});
