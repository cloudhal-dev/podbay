/** D14: every relative link in the repository's Markdown resolves to a file, and its anchor exists. */
import { existsSync } from "node:fs";
import path from "node:path";
import { type Check, read, repoFiles } from "./lib.ts";

function slug(heading: string): string {
	return heading
		.trim()
		.toLowerCase()
		.replace(/[`*]/g, "")
		.replace(/[^\p{L}\p{N}\- ]/gu, "")
		.replace(/ /g, "-");
}

function anchors(markdown: string): Set<string> {
	const found = new Set<string>();
	for (const match of markdown.matchAll(/^#+\s+(.*)$/gm)) found.add(slug(match[1] ?? ""));
	return found;
}

/** Links outside fenced code blocks and inline code. */
function links(markdown: string): string[] {
	const prose = markdown.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
	return [...prose.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1] ?? "");
}

export const check: Check = {
	name: "docs",
	run() {
		const problems: string[] = [];
		const markdown = repoFiles().filter((f) => f.endsWith(".md") && existsSync(f));
		for (const file of markdown) {
			for (const link of links(read(file))) {
				if (/^[a-z][a-z0-9+.-]*:/i.test(link)) continue;
				const [target = "", fragment] = link.split("#", 2);
				const resolved =
					target === "" ? file : path.normalize(path.join(path.dirname(file), target));
				if (!existsSync(resolved)) {
					problems.push(`${file}: link to ${link} does not resolve`);
					continue;
				}
				if (fragment && resolved.endsWith(".md") && !anchors(read(resolved)).has(fragment)) {
					problems.push(`${file}: ${link} names a heading that does not exist`);
				}
			}
		}
		return problems;
	},
};
