/**
 * Commit form and sign-off (docs/engineering-rules.md, D12; CONTRIBUTING.md).
 *
 *   node scripts/commits.ts <base>..<head>   every commit after <base> up to <head>: a
 *                                            conventional subject and the author's sign-off;
 *                                            exit 1 with one line per problem
 *
 * CI runs it on the commits of a pull request. This file is only the command: it runs whenever
 * it is started, with no test of how it was started, so a run that read nothing cannot pass for
 * a run that checked everything. It prints how many commits it read, and a range with none in
 * it is a failure. The rules are in `./commit-form.ts`.
 */
import { commitProblems, commitsOf } from "./commit-form.ts";

const range = process.argv[2] ?? "";
let commits: ReturnType<typeof commitsOf>;
try {
	commits = commitsOf(range);
} catch (error) {
	process.stderr.write(`commits: ${error instanceof Error ? error.message : String(error)}\n`);
	process.exit(2);
}
const problems = commits.flatMap(commitProblems);
for (const problem of problems) process.stderr.write(`${problem}\n`);
process.stdout.write(`commits: ${commits.length} read, ${problems.length} problem(s)\n`);
if (commits.length === 0) process.stderr.write("commits: the range holds no commit\n");
process.exit(problems.length === 0 && commits.length > 0 ? 0 : 1);
