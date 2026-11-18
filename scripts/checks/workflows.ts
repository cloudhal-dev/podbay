/**
 * S16: the workflows are read like the code. Every file in `.github/workflows/` is held to:
 *
 * - no `pull_request_target` and no `workflow_run`: both run a pull request's work with the
 *   repository's own token and secrets;
 * - a `permissions` block at the top of the file, and no permission that writes (`write`,
 *   `write-all`) anywhere in it;
 * - every action pinned by a full commit id, with its release tag as a comment
 *   (`owner/repo@<40 hex> # v1.2.3`), or a path of this repository; never a Docker image;
 * - every job on a runner GitHub hosts (`ubuntu-…`, `windows-…`, `macos-…`), named as one
 *   label: never `self-hosted`, a list of labels, a group or an expression;
 * - no secret: no `secrets.` in an expression and no `secrets: inherit`;
 * - nothing of an expression inside a `run:` script: a value an event carries reaches a step
 *   through `env`, never by being written into the command;
 * - every checkout with `persist-credentials: false`.
 *
 * The files are read line by line, not as YAML: a workflow written in a shape this check does
 * not read (a flow mapping, an anchor) is refused, so it cannot pass by being unusual.
 */
import { type Check, read, repoFiles } from "./lib.ts";

const WORKFLOW = /^\.github\/workflows\/[^/]+\.ya?ml$/;
const PINNED = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+@[0-9a-f]{40} # v\d+(\.\d+){0,2}$/;
const HOSTED = /^(ubuntu|windows|macos)-[a-z0-9.-]+$/;

interface Line {
	number: number;
	indent: number;
	/** The line without its indentation, or "" for a blank line or a comment. */
	text: string;
	/** The whole line as it is, comment and all. */
	raw: string;
}

function linesOf(text: string): Line[] {
	return text.split("\n").map((raw, index) => {
		const trimmed = raw.trimStart();
		return {
			number: index + 1,
			indent: raw.length - trimmed.length,
			text: trimmed.startsWith("#") ? "" : trimmed,
			raw,
		};
	});
}

/** The value after `key:` on a line, the dash of a list item allowed before it. */
function valueAfter(line: Line, key: string): string | null {
	const match = line.text.match(new RegExp(`^(?:- )?${key}:(?:\\s+(.*))?$`));
	return match === null ? null : (match[1] ?? "").trim();
}

/** The lines after `index` indented deeper than `indent`: the block that belongs to it. */
function deeperThan(lines: Line[], index: number, indent: number): Line[] {
	const block: Line[] = [];
	for (const line of lines.slice(index + 1)) {
		if (line.raw.trim() !== "" && line.indent <= indent) break;
		block.push(line);
	}
	return block;
}

/** The text of a `run: |` script: the lines indented deeper than its key. */
function scriptAfter(lines: Line[], index: number): Line[] {
	const owner = lines[index] as Line;
	// The key of a list item (`- run: |`) stands two columns in from its dash.
	return deeperThan(lines, index, owner.text.startsWith("- ") ? owner.indent + 2 : owner.indent);
}

/** The rest of the step whose first line, `- key: …`, is at `index`. */
function stepAfter(lines: Line[], index: number): Line[] {
	return deeperThan(lines, index, (lines[index] as Line).indent);
}

/** What is wrong with one workflow file, one message per problem. */
export function workflowProblems(file: string, text: string): string[] {
	if (!WORKFLOW.test(file)) return [];
	const lines = linesOf(text);
	const problems: string[] = [];
	const at = (line: Line, what: string) => problems.push(`${file}:${line.number}: ${what}`);

	if (/[{}&*]/.test(lines.map((line) => line.text.replace(/\$\{\{.*?\}\}/g, "")).join("\n"))) {
		const line = lines.find((one) => /[{}&*]/.test(one.text.replace(/\$\{\{.*?\}\}/g, "")));
		if (line) at(line, "a flow mapping, an anchor or an alias: write the workflow in block form");
	}
	if (!lines.some((line) => line.indent === 0 && valueAfter(line, "permissions") !== null)) {
		problems.push(`${file}: no "permissions" block at the top of the file`);
	}

	lines.forEach((line, index) => {
		if (line.text === "") return;
		if (/\b(pull_request_target|workflow_run)\b/.test(line.text)) {
			at(
				line,
				"pull_request_target and workflow_run run a pull request's work with the repository's token",
			);
		}
		if (/(^|[\s:,])write(-all)?\s*$/.test(line.text) || /\bwrite-all\b/.test(line.text)) {
			at(line, "a permission that writes: every job reads only (S16)");
		}
		if (/\$\{\{[^}]*\bsecrets\./.test(line.text) || /^secrets:\s*inherit\b/.test(line.text)) {
			at(line, "a secret: no workflow uses one");
		}

		const uses = valueAfter(line, "uses");
		if (uses !== null) {
			const value = line.raw.slice(line.raw.indexOf("uses:") + "uses:".length).trim();
			if (value.startsWith("./")) {
				// A path of this repository is reviewed with the repository.
			} else if (value.startsWith("docker://")) {
				at(line, "a Docker image as an action");
			} else if (!PINNED.test(value)) {
				at(line, `"${value}" is not pinned by a commit id with its release tag as a comment`);
			}
		}

		const runner = valueAfter(line, "runs-on");
		if (runner !== null && !HOSTED.test(runner)) {
			at(line, `"runs-on: ${runner}" is not one runner GitHub hosts (no self-hosted runner)`);
		}

		const run = valueAfter(line, "run");
		if (run !== null) {
			const script = /^[|>][+-]?$/.test(run)
				? scriptAfter(lines, index).map((one) => one.raw)
				: [run];
			if (script.some((one) => one.includes("${{"))) {
				at(line, "an expression inside a run: script; pass the value through env");
			}
		}

		if (/^(?:- )?uses:\s+actions\/checkout@/.test(line.text)) {
			const step = stepAfter(lines, index);
			if (!step.some((one) => /^persist-credentials:\s+false\s*$/.test(one.text))) {
				at(line, "a checkout without persist-credentials: false");
			}
		}
	});
	return problems;
}

export const check: Check = {
	name: "workflows",
	run() {
		return repoFiles()
			.filter((file) => WORKFLOW.test(file))
			.flatMap((file) => workflowProblems(file, read(file)));
	},
};
