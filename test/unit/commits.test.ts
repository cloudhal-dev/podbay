// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Tier 0: every commit of a pull request has a conventional subject and its author's sign-off
 * (D12, CONTRIBUTING.md), and the range is read from git as it is. The CI job
 * `commits (form and sign-off)` runs `scripts/commits.ts` on the commits of a pull request.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { type Commit, commitProblems, commitsOf } from "../../scripts/commit-form.ts";

const AUTHOR = { authorName: "Ada Writer", authorEmail: "ada@contributors.test" };
const signed = (subject: string, signer = "Ada Writer <ada@contributors.test>") =>
	`${subject}\n\nWhy it changes.\n\nSigned-off-by: ${signer}\n`;
const commit = (message: string, over: Partial<Commit> = {}): Commit => ({
	id: "0123456789abcdef0123456789abcdef01234567",
	parents: ["fedcba9876543210fedcba9876543210fedcba98"],
	...AUTHOR,
	message,
	...over,
});

describe("the form of a commit", () => {
	it.each([
		"feat: a mailbox keeps its rules",
		"fix(rules): a reply is not made twice",
		"docs(adr): ADR-0017 says what GitHub refused",
		"chore(deps): Bump dompurify from 3.4.17 to 3.4.18",
		"feat(auth,app)!: sign-in asks for a passkey",
		"test: the content policy test finds a closing script tag",
	])("takes %j", (subject) => {
		expect(commitProblems(commit(signed(subject)))).toEqual([]);
	});

	it.each([
		["no type", "a mailbox keeps its rules"],
		["a type that is not one", "update: a mailbox keeps its rules"],
		["a capital type", "Fix: a reply is not made twice"],
		["no space after the colon", "fix:a reply is not made twice"],
		["nothing after the colon", "fix: "],
		["a scope that is not closed", "fix(rules: a reply"],
		["an empty scope", "fix(): a reply"],
		["what git writes for a fixup", "fixup! fix: a reply"],
	])("refuses %s", (_what, subject) => {
		const problems = commitProblems(commit(signed(subject)));
		expect(problems).toHaveLength(1);
		expect(problems[0]).toMatch(/^0123456: the subject is not a conventional commit/);
	});
});

describe("the sign-off of a commit", () => {
	it("refuses a commit without one", () => {
		expect(commitProblems(commit("fix: a reply\n\nWhy it changes.\n"))).toEqual([
			'0123456: no "Signed-off-by:" line (commit with git commit -s)',
		]);
	});

	it("refuses a sign-off in the middle of a line, or without an address", () => {
		for (const message of [
			"fix: a reply\n\nAs in Signed-off-by: Ada Writer <ada@contributors.test>\n",
			"fix: a reply\n\nSigned-off-by: Ada Writer\n",
		]) {
			expect(commitProblems(commit(message)), message).toHaveLength(1);
		}
	});

	it("refuses a sign-off of someone else", () => {
		expect(
			commitProblems(commit(signed("fix: a reply", "Grace Other <grace@contributors.test>"))),
		).toEqual(["0123456: it is not signed off by its author"]);
	});

	it("takes the author's address in another case, and a bot's own name with another address", () => {
		expect(
			commitProblems(commit(signed("fix: a reply", "A. Writer <ADA@Contributors.test>"))),
		).toEqual([]);
		expect(
			commitProblems(
				commit(signed("chore(deps): Bump a package", "dependabot[bot] <support@github.com>"), {
					authorName: "dependabot[bot]",
					authorEmail: "49699333+dependabot[bot]@users.noreply.github.com",
				}),
			),
		).toEqual([]);
	});

	it("takes one of several sign-offs, and co-authors beside it", () => {
		const message =
			"fix: a reply\n\nSigned-off-by: Grace Other <grace@contributors.test>\nSigned-off-by: Ada Writer <ada@contributors.test>\nCo-Authored-By: Someone <someone@contributors.test>\n";
		expect(commitProblems(commit(message))).toEqual([]);
	});

	it("says both problems of a commit that has both", () => {
		expect(commitProblems(commit("a reply\n"))).toHaveLength(2);
	});

	it("does not check a merge commit", () => {
		expect(
			commitProblems(commit("Merge pull request #46 from a branch\n", { parents: ["a", "b"] })),
		).toEqual([]);
	});
});

describe("a range read from git", () => {
	const repository = mkdtempSync(join(tmpdir(), "podbay-commits-"));
	afterAll(() => rmSync(repository, { recursive: true, force: true }));
	const git = (...args: string[]) =>
		execFileSync(
			"git",
			[
				"-c",
				"user.name=Ada Writer",
				"-c",
				"user.email=ada@contributors.test",
				"-c",
				"commit.gpgsign=false",
				...args,
			],
			{ cwd: repository, encoding: "utf8" },
		).trim();
	const head = () => git("rev-parse", "HEAD");

	it("reads every commit after the base with its message, trailers and parents", () => {
		git("init", "-q", "-b", "main");
		git("commit", "-q", "--allow-empty", "-m", "chore: the start");
		const base = head();
		git("commit", "-q", "--allow-empty", "-s", "-m", "feat: one\n\nA body\nof two lines.");
		git("commit", "-q", "--allow-empty", "-m", "two, without a type or a sign-off");
		const commits = commitsOf(`${base}..${head()}`, repository);
		expect(commits).toHaveLength(2);
		expect(commits[1]).toMatchObject({
			parents: [base],
			authorName: "Ada Writer",
			authorEmail: "ada@contributors.test",
		});
		expect(commits[1]?.message).toContain("A body\nof two lines.");
		expect(commits.flatMap(commitProblems)).toHaveLength(2);
		expect(commitProblems(commits[1] as Commit)).toEqual([]);
	});

	it("is a command that checks the range however it is started, and fails a range it reads nothing in", () => {
		const script = fileURLToPath(new URL("../../scripts/commits.ts", import.meta.url));
		const linked = join(repository, "linked-commits.ts");
		symlinkSync(script, linked);
		const run = (path: string, range: string) =>
			spawnSync(process.execPath, [path, range], { cwd: repository, encoding: "utf8" });
		const first = git("rev-list", "--max-parents=0", "HEAD");
		const second = git("rev-parse", "HEAD~1");
		for (const path of [script, linked]) {
			// One good commit: read, and passed.
			const good = run(path, `${first}..${second}`);
			expect(good.stdout, path).toBe("commits: 1 read, 0 problem(s)\n");
			expect(good.status, path).toBe(0);
			// With the bad one: read, and failed, with the problems on their own lines.
			const bad = run(path, `${first}..${head()}`);
			expect(bad.stdout, path).toBe("commits: 2 read, 2 problem(s)\n");
			expect(bad.stderr, path).toMatch(/the subject is not a conventional commit/);
			expect(bad.status, path).toBe(1);
			// A range with nothing in it checked nothing, and is not a pass.
			const none = run(path, `${head()}..${head()}`);
			expect(none.stdout, path).toBe("commits: 0 read, 0 problem(s)\n");
			expect(none.status, path).toBe(1);
			// Something that is not a range is refused before git runs.
			const refused = run(path, "--output=/tmp/x");
			expect(refused.stderr, path).toMatch(/not a range of two commit ids/);
			expect(refused.status, path).toBe(2);
		}
	});

	it("takes nothing but a range of two commit ids", () => {
		for (const range of ["--output=/tmp/x", "HEAD~1..HEAD", "main", `${head()}..`, ""]) {
			expect(() => commitsOf(range, repository), range).toThrow(/not a range of two commit ids/);
		}
	});
});
