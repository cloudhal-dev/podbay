/**
 * D16: the app asks in its own voice. No file in the UI may open one of the browser's own dialogs
 * (`confirm`, `alert`, `prompt`), and dialogs are built from Kumo's `LayerDialog`, not the older
 * `Dialog`. A confirmation goes through `useConfirm()` in `app/components/Confirm.tsx`.
 */
import { existsSync } from "node:fs";
import { type Check, read, repoFiles } from "./lib.ts";

const UI_FILE = /^app\/.*\.(ts|tsx)$/;
const BROWSER_DIALOG = /\b(?:window|globalThis|self)\.(confirm|alert|prompt)\s*\(/g;
const KUMO_IMPORT = /import\s*\{([^}]*)\}\s*from\s*"@cloudflare\/kumo"/g;
const OLD_DIALOG = /^Dialog(?:Root|Title|Description|Close|Trigger)?$/;

/** Comments are prose about the rule, not code that breaks it. */
function withoutComments(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

export function dialogProblems(file: string, source: string): string[] {
	if (!UI_FILE.test(file)) return [];
	const code = withoutComments(source);
	const problems: string[] = [];
	for (const match of code.matchAll(BROWSER_DIALOG)) {
		problems.push(
			`${file}: opens the browser's ${match[1]}(); use a LayerDialog or useConfirm() (rule D16)`,
		);
	}
	for (const match of code.matchAll(KUMO_IMPORT)) {
		const names = (match[1] ?? "").split(",").map((name) => name.replace(/^\s*type\s+/, "").trim());
		if (names.some((name) => OLD_DIALOG.test(name)))
			problems.push(`${file}: imports Kumo's Dialog; dialogs are LayerDialog (rule D16)`);
	}
	return problems;
}

export const check: Check = {
	name: "dialogs",
	run() {
		const problems: string[] = [];
		for (const file of repoFiles()) {
			if (existsSync(file)) problems.push(...dialogProblems(file, read(file)));
		}
		return problems;
	},
};
