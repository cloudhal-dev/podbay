/**
 * S15 and S17: every installed package has a licence on the allow-list. Copyleft licences that
 * would bind an Apache-2.0 product (AGPL, GPL, SSPL) and unknown licences fail the build.
 *
 * LGPL is accepted only for the packages named in LGPL_TOOLING: native libraries used by the
 * local toolchain, never shipped in the Worker or the UI bundle.
 */
import { execFileSync } from "node:child_process";
import type { Check } from "./lib.ts";

/** The licences a package may have. The dependency review in `.github/workflows/checks.yml` names the same list. */
export const ALLOWED = new Set([
	"MIT",
	"MIT-0",
	"ISC",
	"Apache-2.0",
	"BSD-2-Clause",
	"BSD-3-Clause",
	"0BSD",
	"CC0-1.0",
	"CC-BY-4.0",
	"Unlicense",
	"BlueOak-1.0.0",
	"MPL-2.0",
	"Python-2.0",
]);
/** LGPL packages of the local toolchain, never shipped; the dependency review names them too. */
export const LGPL_TOOLING = /^@img\/sharp-libvips-/;
const FORBIDDEN = /\b(AGPL|GPL|SSPL|BUSL|Commons[- ]Clause)\b/i;

interface Listed {
	name: string;
	versions?: string[];
	license?: string;
}

/** True when an SPDX-style expression is acceptable: every OR branch is judged, one may pass. */
export function licenceAllowed(expression: string, packageName: string): boolean {
	const branches = expression
		.replace(/[()]/g, "")
		.split(/\s+OR\s+/i)
		.map((b) => b.trim());
	return branches.some((branch) => {
		const parts = branch.split(/\s+AND\s+/i).map((p) => p.trim());
		return parts.every((part) => {
			if (/^LGPL/i.test(part)) return LGPL_TOOLING.test(packageName);
			if (FORBIDDEN.test(part)) return false;
			return ALLOWED.has(part);
		});
	});
}

export function checkLicences(listing: Record<string, Listed[]>): string[] {
	const problems: string[] = [];
	for (const [licence, packages] of Object.entries(listing)) {
		for (const pkg of packages) {
			if (!licenceAllowed(licence, pkg.name)) {
				problems.push(`${pkg.name}: licence "${licence}" is not on the allow-list`);
			}
		}
	}
	return problems;
}

/**
 * The licences of every package installed for the workspace at `cwd`, every workspace package's
 * dependencies included: without `-r`, `pnpm licenses list` reads the root package's alone (tried
 * with a throwaway workspace on 2026-11-19, pnpm 12.10.1; ADR-0018, decision 4).
 */
export function licenceProblems(cwd = "."): string[] {
	const json = execFileSync("pnpm", ["licenses", "list", "--json", "-r"], {
		cwd,
		encoding: "utf8",
		maxBuffer: 128 * 1024 * 1024,
	});
	return checkLicences(JSON.parse(json) as Record<string, Listed[]>);
}

export const check: Check = {
	name: "licences",
	run: () => licenceProblems(),
};
