/**
 * ADR-0003: no running Podbay instance is served from `cloudhal.com` or a subdomain of it. This
 * check fails when a deployment configuration or a workflow names such a host. Documents and
 * contact addresses are not deployment configuration and are not scanned.
 */
import { existsSync } from "node:fs";
import { type Check, read, repoFiles } from "./lib.ts";

const DEPLOYMENT_FILE = /^(wrangler[^/]*\.(jsonc|json|toml)|\.github\/workflows\/[^/]+\.ya?ml)$/;
const FORBIDDEN_HOST = /(^|[^a-z0-9.-])((?:[a-z0-9-]+\.)*cloudhal\.com)(?![a-z0-9-]|\.[a-z0-9])/gi;

export function hostProblems(file: string, text: string): string[] {
	if (!DEPLOYMENT_FILE.test(file)) return [];
	const hosts = new Set<string>();
	for (const match of text.matchAll(FORBIDDEN_HOST)) hosts.add((match[2] ?? "").toLowerCase());
	return [...hosts].map(
		(host) => `${file}: names ${host}; nothing runs under cloudhal.com (ADR-0003)`,
	);
}

export const check: Check = {
	name: "hosts",
	run() {
		const problems: string[] = [];
		for (const file of repoFiles()) {
			if (existsSync(file)) problems.push(...hostProblems(file, read(file)));
		}
		return problems;
	},
};
