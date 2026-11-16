// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { fileURLToPath } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const at = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
	plugins: [react(), tailwindcss(), cloudflare({ viteEnvironment: { name: "worker" } })],
	resolve: {
		alias: {
			"~": at("./app"),
			shared: at("./shared"),
		},
	},
	environments: {
		worker: { build: { sourcemap: true } },
	},
});
