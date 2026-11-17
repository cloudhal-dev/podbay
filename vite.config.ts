// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { fileURLToPath } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const at = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const stateDir = process.env.PODBAY_STATE_DIR;

export default defineConfig({
	plugins: [
		react(),
		tailwindcss(),
		cloudflare({
			viteEnvironment: { name: "worker" },
			// A second local instance with its own data, beside the one in `.wrangler/state`: set
			// PODBAY_STATE_DIR to a directory. Used to try a build without touching local mail.
			...(stateDir ? { persistState: { path: stateDir } } : {}),
		}),
	],
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
