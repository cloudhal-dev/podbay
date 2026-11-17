// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { defineConfig } from "@playwright/test";

const PORT = 4174;
const PROXY_PORT = 4175;

/**
 * Tier 6: the built app in a real browser, under its real response headers.
 *
 * One server, one worker, tests in order: they share one instance (one owner, one mailbox), and
 * the server is slow to start. The browser is the installed Chrome (set PODBAY_E2E_CHANNEL to
 * use another); nothing is downloaded to run these.
 */
export default defineConfig({
	testDir: ".",
	testMatch: "*.spec.ts",
	outputDir: "../../test-results",
	fullyParallel: false,
	workers: 1,
	retries: 0,
	forbidOnly: !!process.env.CI,
	reporter: [["list"]],
	timeout: 60_000,
	expect: { timeout: 10_000 },
	globalSetup: "./global-setup.ts",
	use: {
		baseURL: `http://localhost:${PORT}`,
		channel: process.env.PODBAY_E2E_CHANNEL ?? "chrome",
		trace: "retain-on-failure",
		// A message in a test may try to open, download or locate anything; the browser gets no
		// permission of any kind.
		permissions: [],
		// The browser's own calls home are kept to a minimum; what remains is filtered by host in
		// the fixture (BROWSER_OWN).
		launchOptions: { args: ["--disable-features=AutofillServerCommunication,OptimizationHints"] },
		// The app itself is reached directly; everything else goes to the proxy and is refused.
		proxy: { server: `http://127.0.0.1:${PROXY_PORT}`, bypass: "localhost" },
	},
	webServer: [
		{
			command: "node scripts/e2e-server.ts",
			cwd: "../..",
			url: `http://localhost:${PORT}/api/health`,
			reuseExistingServer: false,
			// Asked to stop, not killed: the server puts the build's local variables back.
			gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
			timeout: 240_000,
			stdout: "ignore",
			stderr: "pipe",
		},
		{
			// Everything the browser sends anywhere but localhost ends here (test/e2e/proxy.ts).
			command: "node test/e2e/proxy.ts",
			cwd: "../..",
			url: `http://127.0.0.1:${PROXY_PORT}/__contacts`,
			reuseExistingServer: false,
			timeout: 30_000,
		},
	],
});
