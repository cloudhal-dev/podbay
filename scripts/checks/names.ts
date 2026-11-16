/**
 * S17: Podbay is an original work and names no other mail product. The list of names is kept as
 * SHA-256 digests, so this file does not name them either. Every word of every tracked text file
 * is hashed and compared.
 *
 * To add a name: node -e 'console.log(require("node:crypto").createHash("sha256").update("name").digest("hex"))'
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { type Check, read, repoFiles } from "./lib.ts";

const FORBIDDEN_DIGESTS = new Set([
	"e67eb162e08f5dfcb8e64d41e677e6dcfdf8ad4823ca4e3a13dd4c41f32aba30",
	"40607af13958f0aa572c0285472932f260f79fd19ee9ab02b13ea81f66a16967",
]);
const TEXT = /\.(md|ts|tsx|js|json|jsonc|css|html|yml|yaml|txt|svg)$|^(NOTICE|LICENSE)$/;
const SKIP = /^(pnpm-lock\.yaml)$/;

export function forbiddenWords(text: string, digests: ReadonlySet<string>): string[] {
	const hits: string[] = [];
	const seen = new Set<string>();
	for (const word of text.toLowerCase().match(/[a-z][a-z0-9]{3,}/g) ?? []) {
		if (seen.has(word)) continue;
		seen.add(word);
		if (digests.has(createHash("sha256").update(word).digest("hex"))) hits.push(word);
	}
	return hits;
}

export const check: Check = {
	name: "names",
	run() {
		const problems: string[] = [];
		for (const path of repoFiles()) {
			if (!TEXT.test(path) || SKIP.test(path) || !existsSync(path)) continue;
			if (forbiddenWords(read(path), FORBIDDEN_DIGESTS).length > 0) {
				problems.push(`${path}: names another mail product (rule S17)`);
			}
		}
		return problems;
	},
};
