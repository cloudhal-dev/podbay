/**
 * The check that holds the project's guidance (skills, rules, subagents, settings) to its own
 * rules. The real files are checked by `pnpm static guidance`; these cases are the failures it
 * must catch.
 */
import { describe, expect, it } from "vitest";
import {
	frontmatter,
	type GuidanceFiles,
	globToRegExp,
	guidanceProblems,
	MAX_AGENTS_MD_LINES,
} from "../../scripts/checks/guidance.ts";

const SKILL =
	"---\nname: podbay-x\ndescription: Use it whenever something about x is changed in this repository.\n---\n\n# X\n";
const AGENT =
	"---\nname: reviewer\ndescription: Reads a change and reports findings; never edits anything at all.\ntools: Read, Grep, Glob\nskills:\n  - podbay-x\n---\n\nYou review.\n";
const RULE = '---\npaths:\n  - "app/**"\n---\n\nLoad the `podbay-x` skill.\n';
const SETTINGS = JSON.stringify({
	permissions: {
		deny: ["Read(./.dev.vars)"],
		ask: ["Bash(git push:*)", "Bash(wrangler deploy:*)"],
		allow: ["Bash(pnpm check)"],
	},
});

function repo(overrides: Record<string, string | null> = {}): GuidanceFiles {
	const files = new Map<string, string>([
		["AGENTS.md", "# AGENTS.md\n\nSkills: `podbay-x`. Subagents: `reviewer`.\n"],
		["CLAUDE.md", "@AGENTS.md\n\nMore.\n"],
		[".claude/skills/podbay-x/SKILL.md", SKILL],
		[".claude/agents/reviewer.md", AGENT],
		[".claude/rules/app.md", RULE],
		[".claude/settings.json", SETTINGS],
	]);
	for (const [path, text] of Object.entries(overrides)) {
		if (text === null) files.delete(path);
		else files.set(path, text);
	}
	return { files, paths: [...files.keys(), "app/main.tsx"] };
}

describe("guidanceProblems", () => {
	it("passes a repository whose guidance is consistent", () => {
		expect(guidanceProblems(repo())).toEqual([]);
	});

	it.each([
		[
			"AGENTS.md that grew past one page",
			{ "AGENTS.md": `${"line\n".repeat(MAX_AGENTS_MD_LINES + 1)}\`podbay-x\` \`reviewer\`` },
			/one page/,
		],
		["CLAUDE.md that does not import AGENTS.md", { "CLAUDE.md": "# Claude\n" }, /@AGENTS\.md/],
		[
			"a skill AGENTS.md does not list",
			{ "AGENTS.md": "Subagents: `reviewer`.\n" },
			/does not list the skill podbay-x/,
		],
		[
			"a subagent AGENTS.md does not list",
			{ "AGENTS.md": "Skills: `podbay-x`.\n" },
			/does not list the subagent reviewer/,
		],
		[
			"a skill named differently from its folder",
			{ ".claude/skills/podbay-x/SKILL.md": SKILL.replace("name: podbay-x", "name: other") },
			/name must be "podbay-x"/,
		],
		[
			"a skill that does not say when to use it",
			{ ".claude/skills/podbay-x/SKILL.md": "---\nname: podbay-x\ndescription: X.\n---\n" },
			/does not say when/,
		],
		[
			"a skill without frontmatter",
			{ ".claude/skills/podbay-x/SKILL.md": "# X\n" },
			/no frontmatter/,
		],
		[
			"a subagent that names a skill which does not exist",
			{ ".claude/agents/reviewer.md": AGENT.replace("podbay-x", "podbay-gone") },
			/podbay-gone, which does not exist/,
		],
		[
			"a subagent that may edit",
			{ ".claude/agents/reviewer.md": AGENT.replace("Read, Grep, Glob", "Read, Edit") },
			/does not edit/,
		],
		[
			"a subagent without tools",
			{ ".claude/agents/reviewer.md": AGENT.replace("tools: Read, Grep, Glob\n", "") },
			/name the tools/,
		],
		[
			"a rule that is not scoped to paths",
			{ ".claude/rules/app.md": "# Always\n" },
			/scoped with `paths:`/,
		],
		[
			"a rule whose path matches nothing any more",
			{ ".claude/rules/app.md": RULE.replace("app/**", "gone/**") },
			/matches no file/,
		],
		[
			"a rule that names a skill which does not exist",
			{ ".claude/rules/app.md": RULE.replace("podbay-x", "podbay-gone") },
			/podbay-gone, which does not exist/,
		],
		[
			"settings that let local secrets be read",
			{ ".claude/settings.json": SETTINGS.replace("Read(./.dev.vars)", "Read(./other)") },
			/deny reading \.dev\.vars/,
		],
		[
			"settings that push without asking",
			{ ".claude/settings.json": SETTINGS.replace("Bash(git push:*)", "Bash(git fetch:*)") },
			/ask before `git push`/,
		],
		[
			"settings that allow a deploy",
			{ ".claude/settings.json": SETTINGS.replace("Bash(pnpm check)", "Bash(wrangler deploy:*)") },
			/without asking/,
		],
		["missing settings", { ".claude/settings.json": null }, /settings\.json is missing/],
	] as const)("fails on %s", (_name, overrides, expected) => {
		const problems = guidanceProblems(repo(overrides));
		expect(problems.join("\n")).toMatch(expected);
	});
});

describe("frontmatter", () => {
	it("reads fields and lists, and nothing from a file without any", () => {
		const parsed = frontmatter(AGENT);
		expect(parsed?.fields.name).toBe("reviewer");
		expect(parsed?.lists.skills).toEqual(["podbay-x"]);
		expect(parsed?.body.trim()).toBe("You review.");
		expect(frontmatter("# No frontmatter\n")).toBeNull();
	});
});

describe("globToRegExp", () => {
	it("matches the way a rule's paths are meant", () => {
		expect(globToRegExp("app/**").test("app/routes/home.tsx")).toBe(true);
		expect(globToRegExp("app/**").test("workers/app.ts")).toBe(false);
		expect(globToRegExp("workers/app.ts").test("workers/app.ts")).toBe(true);
		expect(globToRegExp("workers/app.ts").test("workers/appxts")).toBe(false);
		expect(
			globToRegExp(".claude/skills/podbay-*/**").test(".claude/skills/podbay-ui/SKILL.md"),
		).toBe(true);
		expect(globToRegExp("test/*.ts").test("test/unit/a.ts")).toBe(false);
	});
});
