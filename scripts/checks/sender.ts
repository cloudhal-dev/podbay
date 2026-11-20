/**
 * S8 and D7: one send path. Mail leaves by one function, `leaveOne` in the mailbox object
 * (ADR-0016, decision 4), which is the only code that reads the send binding and the only
 * caller of the adapter around it; and the handover that function makes has no other caller.
 *
 * - the send binding (`.EMAIL`) is read in one file only;
 * - the adapter (`workers/email-sender.ts`) is called from that file only, and once;
 * - the handover (`handOver` of `workers/durableObject/submissions.ts`) is called from that
 *   file only, and once.
 */
import { existsSync } from "node:fs";
import { type Check, read, repoFiles } from "./lib.ts";

/** The one file that lets mail leave. */
export const LEAVING = "workers/durableObject/leaving.ts";
const ADAPTER = "workers/email-sender.ts";
const HANDOVER = "workers/durableObject/submissions.ts";
const SHIPPED = /^(workers|shared|packages)\/.*\.ts$/;

/** Comments are prose about the rule, not code that breaks it. */
function withoutComments(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

const count = (code: string, pattern: RegExp): number => (code.match(pattern) ?? []).length;

export function senderProblems(file: string, source: string): string[] {
	if (!SHIPPED.test(file)) return [];
	const code = withoutComments(source);
	const problems: string[] = [];
	const binding = count(code, /\.EMAIL\b/g);
	const adapter = count(code, /\bsendEmail\s*\(/g);
	const handover = count(code, /\bhandOver\s*\(/g);

	if (file === LEAVING) {
		if (binding !== 1) problems.push(`${file}: reads the send binding ${binding} times, not once`);
		if (adapter !== 1) problems.push(`${file}: calls the send adapter ${adapter} times, not once`);
		if (handover !== 1) problems.push(`${file}: makes the handover ${handover} times, not once`);
		return problems;
	}
	if (binding > 0) {
		problems.push(`${file}: reads the send binding; only ${LEAVING} may (rule S8)`);
	}
	if (file !== ADAPTER && adapter > 0) {
		problems.push(`${file}: calls the send adapter; only ${LEAVING} may (rule S8)`);
	}
	if (file !== HANDOVER && (handover > 0 || /\bhandOver\b/.test(code))) {
		problems.push(`${file}: makes the handover; only ${LEAVING} may (ADR-0016)`);
	}
	return problems;
}

export const check: Check = {
	name: "sender",
	run() {
		const problems: string[] = [];
		const files = repoFiles().filter((file) => existsSync(file));
		for (const file of files) problems.push(...senderProblems(file, read(file)));
		if (!files.includes(LEAVING)) problems.push(`${LEAVING} is missing: nothing lets mail leave`);
		return problems;
	},
};
