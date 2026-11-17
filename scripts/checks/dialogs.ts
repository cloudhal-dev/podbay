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

/**
 * Debt, to shrink and never to grow: the link box of the editor still uses the browser's prompt.
 * It reads one address and changes nothing by itself.
 */
export const BROWSER_DIALOG_DEBT: Record<string, string[]> = {
	"app/components/RichTextEditor.tsx": ["prompt"],
};

/** Comments are prose about the rule, not code that breaks it. */
function withoutComments(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

export function dialogProblems(file: string, source: string): string[] {
	if (!UI_FILE.test(file)) return [];
	const code = withoutComments(source);
	const problems: string[] = [];
	const allowed = BROWSER_DIALOG_DEBT[file] ?? [];
	for (const match of code.matchAll(BROWSER_DIALOG)) {
		const name = match[1] ?? "";
		if (!allowed.includes(name))
			problems.push(`${file}: opens the browser's ${name}(); ask with useConfirm() (rule D16)`);
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
		for (const file of Object.keys(BROWSER_DIALOG_DEBT)) {
			if (!existsSync(file) || !BROWSER_DIALOG.test(withoutComments(read(file))))
				problems.push(`${file}: no longer opens a browser dialog; remove it from the debt list`);
			BROWSER_DIALOG.lastIndex = 0;
		}
		return problems;
	},
};
