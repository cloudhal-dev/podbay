/**
 * Commit form and sign-off (docs/engineering-rules.md, D12; CONTRIBUTING.md).
 *
 *   node scripts/commits.ts <base>..<head>   every commit after <base> up to <head>: a
 *                                            conventional subject and the author's sign-off;
 *                                            exit 1 with one line per problem
 *
 * CI runs it on the commits of a pull request. A merge commit is not checked: GitHub writes one
 * when a pull request is merged, and a branch may merge `main` into itself. Only `git` is run,
 * with a range of two commit ids and nothing else from the request.
 */
import { execFileSync } from "node:child_process";

/** The conventional types this repository uses. */
export const TYPES = [
	"feat",
	"fix",
	"docs",
	"chore",
	"test",
	"refactor",
	"perf",
	"ci",
	"build",
	"revert",
];

/** `type(scope)!: text`, with the scope and the `!` optional, and text after one space. */
const SUBJECT = new RegExp(`^(${TYPES.join("|")})(\\([a-z0-9][a-z0-9,./ -]*\\))?!?: \\S`);
/** A `Signed-off-by` trailer: a name and an address in angle brackets. */
const SIGN_OFF = /^Signed-off-by: (.+?) <([^<>\s]+)>\s*$/gm;

export interface Commit {
	id: string;
	parents: string[];
	authorName: string;
	authorEmail: string;
	/** The whole message: the subject, the body and the trailers. */
	message: string;
}

/** What is wrong with one commit, one message per problem; none for a merge. */
export function commitProblems(commit: Commit): string[] {
	if (commit.parents.length > 1) return [];
	const short = commit.id.slice(0, 7);
	const subject = commit.message.split("\n", 1)[0] ?? "";
	const problems: string[] = [];
	if (!SUBJECT.test(subject)) {
		problems.push(
			`${short}: the subject is not a conventional commit ("type(scope): text", the type one of ${TYPES.join(", ")})`,
		);
	}
	const signers = [...commit.message.matchAll(SIGN_OFF)].map((match) => ({
		name: match[1]?.trim() ?? "",
		email: (match[2] ?? "").toLowerCase(),
	}));
	if (signers.length === 0) {
		problems.push(`${short}: no "Signed-off-by:" line (commit with git commit -s)`);
	} else if (
		// The author certifies the commit (DCO). A bot may sign with another address of its own,
		// so the name or the address of the author is enough.
		!signers.some(
			(one) => one.email === commit.authorEmail.toLowerCase() || one.name === commit.authorName,
		)
	) {
		problems.push(`${short}: it is not signed off by its author`);
	}
	return problems;
}

const ID = "[0-9a-f]{7,40}";
const RANGE = new RegExp(`^${ID}\\.\\.${ID}$`);

/** The commits of a range, read with `git log` in the repository at `cwd`. */
export function commitsOf(range: string, cwd = process.cwd()): Commit[] {
	if (!RANGE.test(range)) throw new Error(`not a range of two commit ids: ${range}`);
	const out = execFileSync("git", ["log", "--format=%H%x00%P%x00%an%x00%ae%x00%B%x1e", range], {
		cwd,
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
	});
	return out
		.split("\x1e")
		.map((record) => record.replace(/^\n/, ""))
		.filter((record) => record !== "")
		.map((record) => {
			const [id = "", parents = "", authorName = "", authorEmail = "", message = ""] =
				record.split("\x00");
			return {
				id,
				parents: parents.split(" ").filter((one) => one !== ""),
				authorName,
				authorEmail,
				message,
			};
		});
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const range = process.argv[2] ?? "";
	const commits = commitsOf(range);
	const problems = commits.flatMap(commitProblems);
	for (const problem of problems) process.stderr.write(`${problem}\n`);
	process.stdout.write(`commits: ${commits.length} read, ${problems.length} problem(s)\n`);
	process.exit(problems.length === 0 ? 0 : 1);
}
