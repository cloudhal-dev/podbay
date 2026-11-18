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
	"4f53c6c301f98610918a5418c65988fab5fd03f9d217902bff2f03c2daef56b4",
	"0fc712a7cb8fc3e5612dd91ccffb6d695e177db770985ae45bfdbd05c4690a28",
	"b1799e6e18de8f6f7d073bff4c2d0d728b8578057b0cb36f3cbc3516396c003a",
	"4f7587684b017657a317a17e35f319bc319acc807a15eb15776fdb44b6bfa1f6",
	"b28e4e917773971bccd78611ffdae77758614222e542585daa923d50cd57ed75",
	"cb2317426a5c336d2b0a044101bb5f53bcc1b5ca1630f486fb707b9b1f549cbe",
	"a7a4ded2d5035adb26a222c67032f04cfcd2279ab508cf2a7ff612aead97551e",
	"56584949957de203b0b6cb347b57e0553cb31115cc3049e9839b7fb944465a9b",
	"ed0f45e26b04d335116ca186473582d79b83c2bfb6b7ba4c379793fa596bf7b2",
	"abdaa2a4b9e2e0e609da42dfbd339c186315ebcb179f7332a7e7c602c262b9f4",
	"d1c01ba06b10dd865827ca970004848185ee51fed7037c33ef204a731255ea87",
	"e0aa81dd500c530a70b5511fc95959ae1e19dc19a01034e223bfc5ed78e3bdef",
	"deecdf692a463157cf768aa90eba318f873e3e25252e5b206691acfb71a513ec",
	"f5ff9a1659616da7827d86e4631eec44a2609b6d13c90778ee863121055837d3",
	"8d62793654e05588c70f1d45214b4b5b864f3487fc43640be976294fe36d728b",
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
