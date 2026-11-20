/**
 * S14: the Worker holds no Cloudflare account credential and calls no Cloudflare REST API. It
 * works through its bindings only. This fails when shipped code or the Worker configuration
 * names the API host or a credential variable.
 */
import { existsSync } from "node:fs";
import { type Check, read, repoFiles } from "./lib.ts";

const SHIPPED =
	/^(workers|app|shared|packages|modules)\/.*\.(ts|tsx)$|^wrangler[^/]*\.(jsonc|json|toml)$/;
const API_HOST = /\bapi\.cloudflare\.com\b/i;
const CREDENTIAL_NAME =
	/\b(?:CLOUDFLARE_API_TOKEN|CLOUDFLARE_API_KEY|CF_API_TOKEN|CF_API_KEY|CF_TOKEN)\b/;

export function accountProblems(file: string, text: string): string[] {
	if (!SHIPPED.test(file)) return [];
	const problems: string[] = [];
	if (API_HOST.test(text)) problems.push(`${file}: calls the Cloudflare REST API (rule S14)`);
	if (CREDENTIAL_NAME.test(text)) {
		problems.push(`${file}: names a Cloudflare account credential (rule S14)`);
	}
	return problems;
}

export const check: Check = {
	name: "account",
	run() {
		const problems: string[] = [];
		for (const file of repoFiles()) {
			if (existsSync(file)) problems.push(...accountProblems(file, read(file)));
		}
		return problems;
	},
};
