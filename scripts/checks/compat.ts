/**
 * V4: the Workers compatibility date moves forward. The check fails when the date in
 * `wrangler.jsonc` is more than MAX_AGE_DAYS old, or in the future.
 */
import type { Check } from "./lib.ts";
import { read } from "./lib.ts";

export const MAX_AGE_DAYS = 60;

export function compatProblems(config: string, now: number): string[] {
	const match = /"compatibility_date"\s*:\s*"(\d{4}-\d{2}-\d{2})"/.exec(config);
	if (!match) return ["wrangler.jsonc: no compatibility_date"];
	const date = Date.parse(`${match[1]}T00:00:00Z`);
	if (Number.isNaN(date)) return [`wrangler.jsonc: compatibility_date ${match[1]} is not a date`];
	const ageDays = Math.floor((now - date) / 86_400_000);
	if (ageDays < -1) return [`wrangler.jsonc: compatibility_date ${match[1]} is in the future`];
	if (ageDays > MAX_AGE_DAYS) {
		return [
			`wrangler.jsonc: compatibility_date ${match[1]} is ${ageDays} days old (limit ${MAX_AGE_DAYS}); move it forward and run the full tests`,
		];
	}
	return [];
}

export const check: Check = {
	name: "compat",
	run: () => compatProblems(read("wrangler.jsonc"), Date.now()),
};
