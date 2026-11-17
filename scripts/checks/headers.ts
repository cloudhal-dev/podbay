/**
 * S11: the static assets carry the same security headers as the API. `public/_headers` is
 * generated from `shared/security-headers.ts`; this check fails when the two differ.
 *
 *   node scripts/checks/headers.ts --write    regenerate public/_headers
 */
import { existsSync, writeFileSync } from "node:fs";
import { headersFile } from "../../shared/security-headers.ts";
import { type Check, read } from "./lib.ts";

const FILE = "public/_headers";

export function headersProblems(current: string | null, expected: string): string[] {
	if (current === null) return [`${FILE} is missing; run node scripts/checks/headers.ts --write`];
	if (current !== expected) {
		return [
			`${FILE} differs from shared/security-headers.ts; run node scripts/checks/headers.ts --write`,
		];
	}
	return [];
}

export const check: Check = {
	name: "headers",
	run: () => headersProblems(existsSync(FILE) ? read(FILE) : null, headersFile()),
};

if (import.meta.url === `file://${process.argv[1]}`) {
	if (process.argv.includes("--write")) {
		writeFileSync(FILE, headersFile());
	} else {
		const problems = await check.run();
		for (const p of problems) process.stderr.write(`headers: ${p}\n`);
		process.exitCode = problems.length === 0 ? 0 : 1;
	}
}
