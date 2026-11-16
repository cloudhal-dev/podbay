/**
 * S4: one renderer for mail HTML. No file in the UI may inject HTML into the page, and only the
 * mail frame component may set a frame's `srcdoc`, which it builds with `app/lib/mail-html.ts`.
 */
import { existsSync } from "node:fs";
import { type Check, read, repoFiles } from "./lib.ts";

const UI_FILE = /^app\/.*\.(ts|tsx)$/;
const FRAME_COMPONENT = "app/components/EmailIframe.tsx";
const INJECTION: [string, RegExp][] = [
	["innerHTML", /\.innerHTML\s*=(?!=)/],
	["outerHTML", /\.outerHTML\s*=(?!=)/],
	["insertAdjacentHTML", /\.insertAdjacentHTML\s*\(/],
	["document.write", /\bdocument\.write(?:ln)?\s*\(/],
	["dangerouslySetInnerHTML", /\bdangerouslySetInnerHTML\b/],
	["createContextualFragment", /\.createContextualFragment\s*\(/],
];
const SRCDOC = /\bsrcdoc\b\s*=|\bsrcDoc\b\s*=/;

/** Comments are prose about the rule, not code that breaks it. */
function withoutComments(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

export function htmlProblems(file: string, source: string): string[] {
	if (!UI_FILE.test(file)) return [];
	const code = withoutComments(source);
	const problems: string[] = [];
	for (const [name, pattern] of INJECTION) {
		if (pattern.test(code))
			problems.push(`${file}: uses ${name}; mail HTML has one renderer (rule S4)`);
	}
	if (file !== FRAME_COMPONENT && SRCDOC.test(code)) {
		problems.push(`${file}: sets srcdoc; only ${FRAME_COMPONENT} may (rule S4)`);
	}
	return problems;
}

export const check: Check = {
	name: "html",
	run() {
		const problems: string[] = [];
		for (const file of repoFiles()) {
			if (existsSync(file)) problems.push(...htmlProblems(file, read(file)));
		}
		return problems;
	},
};
