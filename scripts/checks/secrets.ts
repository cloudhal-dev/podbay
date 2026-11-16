/**
 * S6: no secret in the repository. This looks for the shapes of real credentials and for
 * environment files that should never be tracked. It is a net under review, not a replacement
 * for it: a secret in an unknown format passes.
 */
import { existsSync } from "node:fs";
import { type Check, read, repoFiles } from "./lib.ts";

const SHAPES: [string, RegExp][] = [
	["a private key", /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/],
	["a GitHub token", /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/],
	["a GitHub fine-grained token", /\bgithub_pat_[A-Za-z0-9_]{50,}\b/],
	["an AWS access key id", /\bAKIA[0-9A-Z]{16}\b/],
	["an API key", /\bsk-(?:ant-)?[A-Za-z0-9_-]{32,}\b/],
	["a Slack token", /\bxox[abprs]-[A-Za-z0-9-]{20,}\b/],
	[
		"a Cloudflare credential",
		/\b(?:CLOUDFLARE|CF)_[A-Z_]*(?:TOKEN|KEY|SECRET)["']?\s*[=:]\s*["']?[A-Za-z0-9_-]{30,}/,
	],
];
const ENV_FILE = /(^|\/)(\.dev\.vars|\.env)(\.[^/]*)?$/;
const ENV_EXAMPLE = /\.example$/;
const BINARY = /\.(png|ico|jpg|jpeg|gif|webp|woff2?|pdf)$/;

export function secretProblems(file: string, text: string): string[] {
	const problems: string[] = [];
	if (ENV_FILE.test(file) && !ENV_EXAMPLE.test(file)) {
		problems.push(`${file}: an environment file must not be tracked`);
	}
	for (const [what, shape] of SHAPES) {
		if (shape.test(text)) problems.push(`${file}: looks like ${what}`);
	}
	return problems;
}

export const check: Check = {
	name: "secrets",
	run() {
		const problems: string[] = [];
		for (const file of repoFiles()) {
			if (BINARY.test(file) || file === "pnpm-lock.yaml" || !existsSync(file)) continue;
			problems.push(...secretProblems(file, read(file)));
		}
		return problems;
	},
};
