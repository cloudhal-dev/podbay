/**
 * S16: the workflows are read like the code. Every file in `.github/workflows/` is held to:
 *
 * - no `pull_request_target` and no `workflow_run`: both run a pull request's work with the
 *   repository's own token and secrets;
 * - a `permissions` block at the top of the file, and no permission anywhere that is not
 *   `read` or `none` (`read-all` or `{}` for a whole block);
 * - every action pinned by a full commit id with its release tag as a comment
 *   (`owner/repo@<40 hex> # v1.2.3`); no action of a path of this repository, which no rule
 *   here would read, and no image (`docker://`, `container:`, `services:`);
 * - every job on a runner of `RUNNERS`: never `self-hosted`, a list, a group or an expression;
 * - no secret: the word `secrets` in no expression, and no `secrets:` key;
 * - nothing of an expression inside a `run:` script: a value an event carries reaches a step
 *   through `env`, never by being written into the command;
 * - every checkout with `persist-credentials: false`.
 *
 * **The reader knows a small part of YAML and refuses the rest.** A line is blank, a comment, a
 * line of a `|` or `>` block, a key (`[A-Za-z0-9_-]+:`, no quotes, no space before the colon)
 * with or without a value, or a list item (`- ` and a key or a value). A value is plain, quoted
 * on one line, a list of plain values in brackets, or `|`/`>`. Anything else (a quoted key, a
 * space before a colon, a value that goes on to the next line, a flow mapping, an anchor, an
 * alias, a tag, a tab) is a line the check does not read, and the file is refused for it: a
 * workflow cannot pass by being written in a way the rules do not look at.
 *
 * What it does not prove: that a pinned id is a commit of the repository it names (GitHub
 * resolves an id across a repository's forks), and that no action given an expression in its
 * `with:` runs it as a script. Both are held by review.
 */
import { type Check, read, repoFiles } from "./lib.ts";

const WORKFLOW = /^\.github\/workflows\/[^/]+\.ya?ml$/;
/** The runners jobs may use; GitHub hosts them. Another one is a reviewed change to this check. */
export const RUNNERS = new Set(["ubuntu-latest"]);
const PINNED = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+@[0-9a-f]{40} # v\d+(\.\d+){0,2}$/;
const KEY = /^([A-Za-z0-9_-]+):(?=\s|$)/;
const DOUBLE = /^"(?:[^"\\]|\\.)*"/;
const SINGLE = /^'(?:[^']|'')*'/;
/** `[a, b]`: plain values only, nothing nested, nothing quoted. */
const FLOW_LIST = /^\[[^[\]{}"'#]*\]/;
const BLOCK = /^[|>][+-]?$/;
const TOKEN_TRIGGERS = /\b(pull_request_target|workflow_run)\b/;

/** A value as written after a key or a dash. */
interface Value {
	/** The value as YAML reads it: quotes and comment taken off. "" for none. */
	text: string;
	/** The value with its comment, as written: an action's tag is in its comment. */
	written: string;
	/** `|` or `>`: the lines that follow, indented deeper, are its text. */
	block: boolean;
}

/** Reads one value, or says why the check does not read it. */
function readValue(raw: string): Value | string {
	const written = raw.trim();
	if (written === "" || written.startsWith("#")) return { text: "", written: "", block: false };
	const nothingAfter = (end: number) => {
		const after = written.slice(end);
		return after.trim() === "" || /^\s+#/.test(after);
	};
	if (written.startsWith('"') || written.startsWith("'")) {
		const quoted = (written.startsWith('"') ? DOUBLE : SINGLE).exec(written);
		if (quoted === null) return "a quoted value that goes on to the next line";
		if (!nothingAfter(quoted[0].length)) return "something after a quoted value";
		const inner = quoted[0].slice(1, -1);
		const text = written.startsWith("'") ? inner.replace(/''/g, "'") : inner;
		return { text, written, block: false };
	}
	if (written.startsWith("[")) {
		const list = FLOW_LIST.exec(written);
		if (list === null || !nothingAfter(list[0].length)) {
			return "a list in brackets the check does not read";
		}
		return { text: list[0], written, block: false };
	}
	if (written === "{}" || /^\{\}\s+#/.test(written)) return { text: "{}", written, block: false };
	if (/^[{&*!?%@`|>]/.test(written) && !BLOCK.test(written.split(/\s+#/)[0] ?? "")) {
		return "a flow mapping, an anchor, an alias or a tag";
	}
	// A plain value ends at its comment: a `#` after a space.
	const hash = written.search(/\s#/);
	const text = (hash === -1 ? written : written.slice(0, hash)).trim();
	if (BLOCK.test(text)) return { text: "", written, block: true };
	if (/:(\s|$)/.test(text)) return "a value with a colon and a space in it: quote it";
	return { text, written, block: false };
}

/** One line of a workflow as the reader knows it. */
type Known =
	| { kind: "skip" }
	/** `key: value`, or `- key: value` when `dash` is the column of the dash. */
	| { kind: "entry"; column: number; dash: number | null; key: string; value: Value }
	/** `- value` */
	| { kind: "item"; dash: number; value: Value };

/** Reads one line that is not in a block, or says why the check does not read it. */
function lineOf(raw: string): Known | string {
	if (/^\s*(#.*)?$/.test(raw)) return { kind: "skip" };
	if (raw.includes("\t")) return "a tab";
	const indent = raw.length - raw.trimStart().length;
	let text = raw.slice(indent);
	let dash: number | null = null;
	if (text === "-" || text.startsWith("- ")) {
		dash = indent;
		text = text.slice(1).trimStart();
		if (text === "") return "a list item with nothing on its line";
	}
	const key = KEY.exec(text);
	if (key === null) {
		if (dash === null) return "a line that is neither a plain key nor a list item";
		const value = readValue(text);
		if (typeof value === "string") return value;
		if (value.block) return "a block as a list item";
		return { kind: "item", dash, value };
	}
	const value = readValue(text.slice(key[0].length));
	if (typeof value === "string") return value;
	return { kind: "entry", column: raw.length - text.length, dash, key: key[1] as string, value };
}

/** Every `${{ … }}` of a text. */
const expressions = (text: string) => text.match(/\$\{\{[\s\S]*?\}\}/g) ?? [];
const namesSecret = (text: string) => expressions(text).some((one) => /\bsecrets\b/.test(one));

interface Step {
	dash: number;
	from: number;
	checkout: boolean;
	kept: boolean;
}

/** What is wrong with one workflow file, one message per problem. */
export function workflowProblems(file: string, text: string): string[] {
	if (!WORKFLOW.test(file)) return [];
	const problems: string[] = [];
	const at = (number: number, what: string) => problems.push(`${file}:${number}: ${what}`);

	/** The keys that hold the current line, outermost first, with the column of each. */
	const path: { column: number; key: string }[] = [];
	/** A `|`/`>` block while its lines are read: the column of its key, and its lines. */
	let block: { column: number; key: string; from: number; lines: string[] } | null = null;
	let step: Step | null = null;
	let topPermissions = false;

	const endStep = () => {
		if (step?.checkout && !step.kept) {
			at(step.from, "a checkout without persist-credentials: false");
		}
		step = null;
	};
	const endBlock = () => {
		if (block === null) return;
		const script = block.lines.join("\n");
		if (block.key === "run" && script.includes("${{")) {
			at(block.from, "an expression inside a run: script; pass the value through env");
		}
		if (namesSecret(script)) at(block.from, "a secret: no workflow uses one");
		block = null;
	};

	text.split("\n").forEach((raw, index) => {
		const number = index + 1;
		if (block !== null) {
			if (raw.trim() === "" || raw.length - raw.trimStart().length > block.column) {
				block.lines.push(raw);
				return;
			}
			endBlock();
		}
		const line = lineOf(raw);
		if (typeof line === "string") {
			at(number, `${line}: a line the check does not read`);
			return;
		}
		if (line.kind === "skip") return;

		// A step ends at the next line that stands at or before its dash.
		const column = line.kind === "item" ? line.dash : (line.dash ?? line.column);
		if (step !== null && column <= step.dash) endStep();

		const value = line.value;
		if (namesSecret(value.written)) at(number, "a secret: no workflow uses one");
		if (TOKEN_TRIGGERS.test(value.text)) {
			at(number, "pull_request_target and workflow_run run a pull request's work with the token");
		}
		if (line.kind === "item") return;

		while (path.length > 0 && (path.at(-1)?.column ?? -1) >= line.column) path.pop();
		const parent = path.at(-1)?.key;
		const inJob = path.length === 2 && path[0]?.key === "jobs";
		const { key } = line;
		if (line.dash !== null && parent === "steps") {
			endStep();
			step = { dash: line.dash, from: number, checkout: false, kept: false };
		}

		if (TOKEN_TRIGGERS.test(key)) {
			at(number, "pull_request_target and workflow_run run a pull request's work with the token");
		}
		if (key === "permissions") {
			if (line.column === 0) topPermissions = true;
			if (!["", "read-all", "{}"].includes(value.text)) {
				at(number, `"permissions: ${value.text}": every job reads only (S16)`);
			}
		} else if (parent === "permissions" && !["read", "none"].includes(value.text)) {
			at(number, `"${key}: ${value.text}" is a permission that is not read (S16)`);
		}
		if (key === "secrets") at(number, "a secret: no workflow uses one");
		if (inJob && (key === "container" || key === "services")) {
			at(number, `"${key}:" runs an image; no job runs one`);
		}
		if (key === "uses") {
			const used = value.written;
			if (used.startsWith("./")) {
				at(number, "an action of a path of this repository: no rule of this check would read it");
			} else if (used.startsWith("docker://")) {
				at(number, "a Docker image as an action");
			} else if (!PINNED.test(used)) {
				at(number, `"${used}" is not pinned by a commit id with its release tag as a comment`);
			}
			if (step !== null && /^actions\/checkout@/.test(used)) step.checkout = true;
		}
		if (key === "persist-credentials" && parent === "with" && step !== null) {
			if (value.text === "false") step.kept = true;
		}
		if (key === "runs-on" && !RUNNERS.has(value.text)) {
			at(number, `"runs-on: ${value.text}" is not a runner of RUNNERS (no self-hosted runner)`);
		}
		if (key === "run" && !value.block && value.text.includes("${{")) {
			at(number, "an expression inside a run: script; pass the value through env");
		}
		if (value.block) block = { column: line.column, key, from: number, lines: [] };
		path.push({ column: line.column, key });
	});
	endBlock();
	endStep();
	if (!topPermissions) problems.push(`${file}: no "permissions" block at the top of the file`);
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
