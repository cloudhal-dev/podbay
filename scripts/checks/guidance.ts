/**
 * D15: the guidance that agents and engineers follow is itself checked. A skill nobody can
 * find, a rule that points at paths that are gone, or a subagent that names a skill which does
 * not exist fails silently in use, so it fails loudly here.
 *
 * - `AGENTS.md` stays one page and names every skill and every subagent; `CLAUDE.md` imports it;
 * - every project skill has a name equal to its folder and a description that fits;
 * - every rule is scoped to paths, and each of its paths still matches a file;
 * - every subagent names its tools and only skills that exist;
 * - the committed settings keep local secrets unread and ask before anything leaves the machine.
 */
import { existsSync } from "node:fs";
import { type Check, read, repoFiles } from "./lib.ts";

export const MAX_AGENTS_MD_LINES = 200;
export const MAX_SKILL_LINES = 500;
/** What an agent's skill listing shows of a description before it is cut. */
export const MAX_DESCRIPTION = 1536;
const VENDORED_SKILLS = new Set(["security-audit"]);

export interface Frontmatter {
	readonly fields: Record<string, string>;
	readonly lists: Record<string, string[]>;
	readonly body: string;
}

/** The small part of YAML these files use: `key: value` lines and `key:` followed by `- item` lines. */
export function frontmatter(text: string): Frontmatter | null {
	const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
	if (match === null) return null;
	const fields: Record<string, string> = {};
	const lists: Record<string, string[]> = {};
	let list: string | null = null;
	for (const line of (match[1] ?? "").split("\n")) {
		const item = /^\s+-\s+(.*)$/.exec(line);
		if (item !== null && list !== null) {
			lists[list]?.push((item[1] ?? "").trim().replace(/^["']|["']$/g, ""));
			continue;
		}
		const field = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
		if (field === null) continue;
		const [, key = "", value = ""] = field;
		if (value === "") {
			list = key;
			lists[key] = [];
		} else {
			list = null;
			fields[key] = value.trim();
		}
	}
	return { fields, lists, body: match[2] ?? "" };
}

/** A glob as these rules write it (`**`, `*`, literal text) as a pattern over repository paths. */
export function globToRegExp(glob: string): RegExp {
	let pattern = "";
	for (let i = 0; i < glob.length; ) {
		if (glob.startsWith("**/", i)) {
			pattern += "(?:.*/)?";
			i += 3;
		} else if (glob.startsWith("**", i)) {
			pattern += ".*";
			i += 2;
		} else if (glob[i] === "*") {
			pattern += "[^/]*";
			i += 1;
		} else {
			pattern += (glob[i] ?? "").replace(/[.+^${}()|[\]\\?]/g, "\\$&");
			i += 1;
		}
	}
	return new RegExp(`^${pattern}$`);
}

export interface GuidanceFiles {
	/** Path to content, for every file the check reads. */
	readonly files: ReadonlyMap<string, string>;
	/** Every path in the repository, for the rules' globs. */
	readonly paths: readonly string[];
}

const names = (files: ReadonlyMap<string, string>, pattern: RegExp): string[] =>
	[...files.keys()].flatMap((path) => {
		const match = pattern.exec(path);
		return match?.[1] ? [match[1]] : [];
	});

export function guidanceProblems({ files, paths }: GuidanceFiles): string[] {
	const problems: string[] = [];
	const agentsMd = files.get("AGENTS.md") ?? "";
	const skills = names(files, /^\.claude\/skills\/([^/]+)\/SKILL\.md$/);
	const agents = names(files, /^\.claude\/agents\/([^/]+)\.md$/);

	if (agentsMd === "") problems.push("AGENTS.md is missing");
	if (agentsMd.split("\n").length > MAX_AGENTS_MD_LINES) {
		problems.push(
			`AGENTS.md is longer than ${MAX_AGENTS_MD_LINES} lines: it is one page; move detail to docs/ or a skill`,
		);
	}
	if (!(files.get("CLAUDE.md") ?? "").startsWith("@AGENTS.md\n")) {
		problems.push("CLAUDE.md must start with the line `@AGENTS.md`, so both files say the same");
	}

	for (const skill of skills) {
		const path = `.claude/skills/${skill}/SKILL.md`;
		const text = files.get(path) ?? "";
		const parsed = frontmatter(text);
		if (parsed === null) {
			problems.push(`${path}: no frontmatter`);
			continue;
		}
		if (parsed.fields.name !== skill) problems.push(`${path}: name must be "${skill}"`);
		const description = `${parsed.fields.description ?? ""}${parsed.fields.when_to_use ?? ""}`;
		if (description.length < 40)
			problems.push(`${path}: the description does not say when to use it`);
		if (description.length > MAX_DESCRIPTION) {
			problems.push(`${path}: the description is cut after ${MAX_DESCRIPTION} characters`);
		}
		if (VENDORED_SKILLS.has(skill)) continue;
		if (text.split("\n").length > MAX_SKILL_LINES) {
			problems.push(
				`${path}: longer than ${MAX_SKILL_LINES} lines; move detail to a file it links`,
			);
		}
		if (!agentsMd.includes(`\`${skill}\``))
			problems.push(`AGENTS.md does not list the skill ${skill}`);
	}

	for (const agent of agents) {
		const path = `.claude/agents/${agent}.md`;
		const parsed = frontmatter(files.get(path) ?? "");
		if (parsed === null) {
			problems.push(`${path}: no frontmatter`);
			continue;
		}
		if (parsed.fields.name !== agent) problems.push(`${path}: name must be "${agent}"`);
		if ((parsed.fields.description ?? "").length < 40) {
			problems.push(`${path}: the description does not say when to use it`);
		}
		if (!parsed.fields.tools) problems.push(`${path}: name the tools it may use`);
		if (/\b(?:Edit|Write|NotebookEdit)\b/.test(parsed.fields.tools ?? "")) {
			problems.push(`${path}: a reviewing subagent does not edit; remove the editing tools`);
		}
		for (const skill of parsed.lists.skills ?? []) {
			if (!skills.includes(skill))
				problems.push(`${path}: names the skill ${skill}, which does not exist`);
		}
		if (!agentsMd.includes(`\`${agent}\``))
			problems.push(`AGENTS.md does not list the subagent ${agent}`);
	}

	for (const path of files.keys()) {
		if (!/^\.claude\/rules\/.*\.md$/.test(path)) continue;
		const parsed = frontmatter(files.get(path) ?? "");
		const globs = parsed?.lists.paths ?? [];
		if (globs.length === 0) {
			problems.push(
				`${path}: a rule is scoped with \`paths:\`; what holds everywhere belongs in AGENTS.md`,
			);
			continue;
		}
		for (const glob of globs) {
			const pattern = globToRegExp(glob);
			if (!paths.some((file) => pattern.test(file))) {
				problems.push(`${path}: the path "${glob}" matches no file any more`);
			}
		}
		for (const skill of (parsed?.body ?? "").matchAll(/`(podbay-[a-z-]+)` skill/g)) {
			if (!skills.includes(skill[1] ?? "")) {
				problems.push(`${path}: names the skill ${skill[1]}, which does not exist`);
			}
		}
	}

	const settings = files.get(".claude/settings.json");
	if (settings === undefined) {
		problems.push(".claude/settings.json is missing");
	} else {
		let parsed: { permissions?: { deny?: string[]; ask?: string[]; allow?: string[] } } = {};
		try {
			parsed = JSON.parse(settings) as typeof parsed;
		} catch {
			problems.push(".claude/settings.json is not valid JSON");
		}
		const { deny = [], ask = [], allow = [] } = parsed.permissions ?? {};
		if (!deny.includes("Read(./.dev.vars)")) {
			problems.push(".claude/settings.json must deny reading .dev.vars");
		}
		if (!ask.some((rule) => rule.startsWith("Bash(git push"))) {
			problems.push(".claude/settings.json must ask before `git push`");
		}
		if (!ask.some((rule) => rule.includes("wrangler deploy"))) {
			problems.push(".claude/settings.json must ask before `wrangler deploy`");
		}
		for (const rule of allow) {
			if (/push|deploy|publish|secret|rm |curl|wget/.test(rule)) {
				problems.push(`.claude/settings.json allows "${rule}" without asking`);
			}
		}
	}
	return problems;
}

export const check: Check = {
	name: "guidance",
	run() {
		const paths = repoFiles().filter((path) => existsSync(path));
		const wanted = paths.filter(
			(path) =>
				path === "AGENTS.md" ||
				path === "CLAUDE.md" ||
				path === ".claude/settings.json" ||
				/^\.claude\/(?:skills\/[^/]+\/SKILL\.md|agents\/[^/]+\.md|rules\/.*\.md)$/.test(path),
		);
		return guidanceProblems({
			files: new Map(wanted.map((path) => [path, read(path)])),
			paths,
		});
	},
};
