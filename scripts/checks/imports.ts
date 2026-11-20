/**
 * D5: dependency direction.
 *
 * - Worker-reachable code (`workers/`, `shared/`, `packages/`) imports no Node-only module;
 * - the UI (`app/`) never imports Worker code, and the Worker never imports the UI;
 * - nothing shipped imports from `scripts/` or `test/`;
 * - a package (`packages/`) imports no product code: not the Worker, not the UI and not `shared/`,
 *   which is mail's until it moves (ADR-0018, decision 2). A package imports only other packages.
 */
import { existsSync } from "node:fs";
import { type Check, read, repoFiles } from "./lib.ts";

const IMPORT = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;

export function importProblems(file: string, source: string): string[] {
	const problems: string[] = [];
	const worker = /^(workers|shared|packages)\//.test(file);
	const ui = file.startsWith("app/");
	const pkg = file.startsWith("packages/");
	if (!worker && !ui) return problems;
	for (const match of source.matchAll(IMPORT)) {
		const spec = match[1] ?? "";
		if (worker && (spec.startsWith("node:") || spec === "fs" || spec === "path")) {
			problems.push(`${file}: imports the Node-only module "${spec}"`);
		}
		if (ui && /(^|\/)workers\//.test(spec))
			problems.push(`${file}: the UI imports Worker code (${spec})`);
		if (worker && (spec.startsWith("~/") || /(^|\/)app\//.test(spec))) {
			problems.push(`${file}: the Worker imports UI code (${spec})`);
		}
		if (pkg && /(^|\/)(shared|workers)(\/|$)/.test(spec)) {
			problems.push(`${file}: a package imports product code (${spec})`);
		}
		if (/(^|\/)(scripts|test)\//.test(spec)) {
			problems.push(`${file}: shipped code imports from tooling or tests (${spec})`);
		}
	}
	return problems;
}

export const check: Check = {
	name: "imports",
	run() {
		const problems: string[] = [];
		for (const file of repoFiles()) {
			if (!/\.(ts|tsx)$/.test(file) || !existsSync(file)) continue;
			problems.push(...importProblems(file, read(file)));
		}
		return problems;
	},
};
