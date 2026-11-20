/**
 * D5: dependency direction.
 *
 * - Worker-reachable code (`workers/`, `shared/`, `packages/`, a module's `worker/` and
 *   `shared/`) imports no Node-only module;
 * - the UI (`app/`) never imports Worker code, and the Worker never imports the UI;
 * - nothing shipped imports from `scripts/` or `test/`;
 * - the app's code takes its words from `~/i18n`, which hands the app's catalogs to the runtime,
 *   and never from the runtime by its own name, which would read words before they are handed in.
 *   Only `app/i18n/` imports `@podbay/i18n`; its dates (`@podbay/i18n/dates`) are open to all.
 *
 * **What a package or a module may import is decided from the file's own path and its own
 * manifest** (ADR-0018, decision 2), and anything else is refused:
 *
 * - a file of `packages/<p>/` imports its own package's files, other packages by name
 *   (`@podbay/<p>`), and what its own `package.json` declares;
 * - a file of `modules/<m>/` imports its own side and its module's `shared/` (`worker/` and
 *   `app/` take `shared/`; `shared/` takes only itself), packages by name, another module only by
 *   an entry that module exports for its side (`@podbay/<m>/worker`, `/app`, `/shared`), and what
 *   its own `package.json` declares. A module's `worker/` may also use the platform's own
 *   modules (`cloudflare:`);
 * - the shell reaches a module only by an entry it exports for the shell's own side (`workers/`
 *   takes `./worker` and `./shared`, `app/` takes `./app` and `./shared`, `shared/` takes
 *   `./shared`), never by a path into it, however the path is written;
 * - no import names a package or an alias and then climbs out of it with `..`;
 * - in shipped code an `import(…)` takes one plain string, so this check can read it.
 *
 * Every package and module is named `@podbay/<its folder>`: the rule reads a name as a folder.
 *
 * One debt is let through, by name and count: the files of the shell's sign-in and access code
 * (`workers/auth/`) that mail's Worker side imports until that code is a package of its own
 * (ADR-0018, step 2.5). `AUTH_DEBT` gives, for each such file, how many of a module's files import
 * it. A count above its number is refused, and so is one below it until the number is lowered;
 * a file not listed is refused. The list only shrinks.
 */
import { existsSync, readdirSync } from "node:fs";
import { posix } from "node:path";
import { type Check, read, readJson, repoFiles } from "./lib.ts";

/**
 * Two readings, chosen by what a mistake costs.
 *
 * - **The whole text** (`wideSpecs`): every `from "…"`, `import "…"` and `import("…")`, in code,
 *   strings and comments alike. Every rule where a miss is the danger reads this: a path into a
 *   module or the shell, the wrong side's entry, a climb out of a name, the Node-only modules,
 *   the UI and the Worker apart, and the counted debt. Words that only look like an import cost
 *   a false alarm, which costs a line; nothing that is an import can hide from it.
 * - **Statements** (`importSpecs`): the source of an import or export statement, with comments
 *   taken out. Only the question "is this bare name declared in the manifest" reads this, since
 *   prose in a string (the assistant's prompt says 'from "…"') would otherwise be read as an
 *   import of an undeclared package. It reads a statement wherever it starts on its line and
 *   whatever its names are written in, but it does not know a string from code: a string holding
 *   a comment's opening can hide what follows it. A miss there lets an undeclared package pass
 *   the manifest rule, never a path past the boundaries, which the whole text holds.
 */
const WIDE = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;

/** What the whole text names as an import, strings and comments included. */
export function wideSpecs(source: string): string[] {
	return [...source.matchAll(WIDE)].map((match) => match[1] ?? "");
}

/** An import or export statement's source: default, named, namespace or type, over lines. */
const STATEMENT =
	/(?<![\w$.])(?:import|export)\s+(?:type\s+)?(?:[^\s,{}*"'`;]+\s*,?\s*)?(?:\{[^}]*\}\s*)?(?:\*\s*(?:as\s+[^\s,{}*"'`;]+\s*)?)?from\s*["']([^"']+)["']/g;
/** An import for its effect alone: `import "x";`. */
const BARE = /^[ \t]*import\s*["']([^"']+)["']/gm;
/** A dynamic import of one plain string. */
const DYNAMIC = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

/** What a file imports, read from its statements only: words in a string or a comment are not. */
export function importSpecs(source: string): string[] {
	const code = withoutComments(source);
	return [STATEMENT, BARE, DYNAMIC].flatMap((pattern) =>
		[...code.matchAll(pattern)].map((match) => match[1] ?? ""),
	);
}
/** The message runtime itself, by its name or its path, but not its dates. */
const RUNTIME = /^(@podbay\/i18n|.*\bpackages\/i18n)(\/index(\.ts)?)?$/;

/** For each file of the shell's sign-in and access code a module imports: how many of its files do. */
export const AUTH_DEBT: Readonly<Record<string, number>> = {};

interface Manifest {
	dependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
	exports?: Record<string, string>;
}

/** What the rule needs to know of the repository: given so a test can give another one. */
export interface World {
	/** The manifest of `packages/<name>` or `modules/<name>`, or null when there is none. */
	manifest(root: string): Manifest | null;
}

export const repository: World = {
	manifest(root) {
		const path = `${root}/package.json`;
		return existsSync(path) ? readJson<Manifest>(path) : null;
	},
};

type Side = "worker" | "app" | "shared";
/** Where a file stands: in a package, in a side of a module, or in the shell. */
type Place =
	| { kind: "package"; root: string }
	| { kind: "module"; root: string; name: string; side: Side | null }
	| { kind: "shell" };

function placeOf(file: string): Place {
	const parts = file.split("/");
	if (parts[0] === "packages" && parts.length > 2) {
		return { kind: "package", root: `packages/${parts[1]}` };
	}
	if (parts[0] === "modules" && parts.length > 2) {
		const side =
			parts[2] === "worker" || parts[2] === "app" || parts[2] === "shared" ? parts[2] : null;
		return { kind: "module", root: `modules/${parts[1]}`, name: parts[1] ?? "", side };
	}
	return { kind: "shell" };
}

/** The name a bare specifier installs: `zod` of `zod/v4`, `@scope/name` of `@scope/name/x`. */
function packageName(spec: string): string {
	const parts = spec.split("/");
	return spec.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? spec);
}

/** The entries of another module a file of this side may take. */
const ENTRIES: Readonly<Record<Side, readonly string[]>> = {
	worker: ["./worker", "./shared"],
	app: ["./app", "./shared"],
	shared: ["./shared"],
};
/** The side of the shell a file stands on: its Worker, its app, or the code both run. */
const SHELL_SIDES: Readonly<Record<string, Side>> = {
	workers: "worker",
	app: "app",
	shared: "shared",
};

/** What a package or a module imports that its path and its manifest do not allow. */
export function boundaryProblems(
	file: string,
	source: string,
	world: World = repository,
): string[] {
	const problems: string[] = [];
	const place = placeOf(file);
	const refuse = (spec: string, why: string) => problems.push(`${file}: ${why} (${spec})`);
	for (const spec of wideSpecs(source)) {
		const relative = spec.startsWith(".");
		const target = relative ? posix.normalize(posix.join(posix.dirname(file), spec)) : "";
		const named = /^@podbay\/([^/]+)(\/.*)?$/.exec(spec);
		const moduleName = named?.[1] ?? "";
		const isModule = named !== null && world.manifest(`modules/${moduleName}`) !== null;
		const entry = named ? `.${named[2] ?? ""}` : "";

		if (!relative && spec.split("/").includes("..")) {
			refuse(spec, "an import names a package or an alias and then climbs out of it");
			continue;
		}
		if (place.kind === "shell") {
			const side = SHELL_SIDES[file.split("/")[0] ?? ""];
			const intoModule = relative
				? target.startsWith("modules/")
				: !named && /(^|\/)modules\//.test(spec);
			if (intoModule) refuse(spec, "the shell reaches a module only by an entry it exports");
			else if (isModule && (side === undefined || !ENTRIES[side].includes(entry))) {
				refuse(spec, "the shell takes a module's entry for its own side only");
			}
			continue;
		}

		if (relative) {
			if (place.kind === "package") {
				if (!target.startsWith(`${place.root}/`))
					refuse(spec, "a package imports only its own files by path");
				continue;
			}
			const own =
				place.side === null ? [] : place.side === "shared" ? ["shared"] : [place.side, "shared"];
			if (own.some((side) => target.startsWith(`${place.root}/${side}/`))) continue;
			const debt = target.startsWith("workers/auth/") && place.side === "worker";
			if (debt) continue; // counted, by file, in `debtProblems`
			refuse(
				spec,
				`a module's ${place.side ?? "file"} imports only its own side and its shared code by path`,
			);
			continue;
		}
		if (named) {
			if (world.manifest(`packages/${moduleName}`) !== null) continue;
			if (!isModule) {
				refuse(spec, "no package or module of this repository has that name");
				continue;
			}
			if (place.kind === "package") refuse(spec, "a package imports no module");
			else if (moduleName === place.name)
				refuse(spec, "a module imports its own files by path, not by its name");
			else if (place.side === null || !ENTRIES[place.side].includes(entry)) {
				refuse(spec, "a module takes another module only by an entry it exports for its side");
			}
			continue;
		}
		if (spec.startsWith("cloudflare:")) {
			if (place.kind !== "module" || place.side !== "worker") {
				refuse(spec, "only a module's Worker side uses the platform's own modules");
			}
			continue;
		}
		if (spec.startsWith("~/") || spec.startsWith("node:") || spec === "fs" || spec === "path") {
			refuse(spec, "not a package, a module's entry or a declared dependency");
		}
		// A bare name: whether it is declared is read from statements, below.
	}
	if (place.kind === "shell") return problems;
	const manifest = world.manifest(place.root) ?? {};
	for (const spec of importSpecs(source)) {
		if (/^(\.|@podbay\/|cloudflare:|~\/|node:)/.test(spec) || spec === "fs" || spec === "path")
			continue;
		const name = packageName(spec);
		if (
			manifest.dependencies?.[name] === undefined &&
			manifest.peerDependencies?.[name] === undefined
		) {
			refuse(spec, `${name} is not declared in ${place.root}/package.json`);
		}
	}
	return problems;
}

/** Comments are prose about the code, not code. */
function withoutComments(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

/** Every `import(` whose argument is not one plain string, which this check could not read. */
export function unreadImports(file: string, source: string): string[] {
	// The whole text: a miss here would let any import past every rule.
	const code = source;
	const problems: string[] = [];
	for (const call of code.matchAll(/\bimport\s*\(/g)) {
		const rest = code.slice((call.index ?? 0) + call[0].length);
		if (/^\s*(["'])[^"'`\n]*\1\s*\)/.test(rest)) continue;
		problems.push(`${file}: an import() this check cannot read; give it one plain string`);
	}
	return problems;
}

/** Every package and module named `@podbay/<its folder>`, since the rule reads a name as a folder. */
export function manifestNameProblems(manifests: readonly [string, string | undefined][]): string[] {
	const problems: string[] = [];
	for (const [root, name] of manifests) {
		const folder = root.split("/").pop() ?? "";
		if (name !== `@podbay/${folder}`) {
			problems.push(
				`${root}/package.json: is named ${JSON.stringify(name)}, not "@podbay/${folder}"`,
			);
		}
	}
	return problems;
}

/** For each file of `workers/auth/` the given module files import, how many of them import it. */
export function authImports(files: readonly [string, string][]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const [file, source] of files) {
		const place = placeOf(file);
		if (place.kind !== "module") continue;
		const reached = new Set<string>();
		for (const spec of wideSpecs(source)) {
			if (!spec.startsWith(".")) continue;
			const target = posix.normalize(posix.join(posix.dirname(file), spec)).replace(/\.ts$/, "");
			if (target.startsWith("workers/auth/")) reached.add(`${target}.ts`);
		}
		for (const target of reached) counts.set(target, (counts.get(target) ?? 0) + 1);
	}
	return counts;
}

/** The counts held to the debt: none above it, none below it until it is lowered, none not on it. */
export function debtProblems(
	counts: ReadonlyMap<string, number>,
	debt: Readonly<Record<string, number>> = AUTH_DEBT,
): string[] {
	const problems: string[] = [];
	for (const [target, count] of counts) {
		const allowed = debt[target];
		if (allowed === undefined) {
			problems.push(`${target}: imported by ${count} file(s) of a module, and not in AUTH_DEBT`);
		} else if (count > allowed) {
			problems.push(
				`${target}: imported by ${count} file(s) of a module, more than AUTH_DEBT's ${allowed}`,
			);
		}
	}
	for (const [target, allowed] of Object.entries(debt)) {
		const count = counts.get(target) ?? 0;
		if (count < allowed) {
			problems.push(
				`${target}: imported by ${count} file(s) of a module; lower AUTH_DEBT from ${allowed}`,
			);
		}
	}
	return problems;
}

export function importProblems(file: string, source: string, world: World = repository): string[] {
	const problems: string[] = [];
	const place = placeOf(file);
	const worker =
		/^(workers|shared|packages)\//.test(file) ||
		(place.kind === "module" && (place.side === "worker" || place.side === "shared"));
	const ui = file.startsWith("app/") || (place.kind === "module" && place.side === "app");
	const shipped = place.kind !== "shell" || /^(workers|app|shared)\//.test(file);
	if (shipped) {
		problems.push(...boundaryProblems(file, source, world));
		problems.push(...unreadImports(file, source));
	}
	if (!worker && !ui) return problems;
	for (const spec of wideSpecs(source)) {
		if (worker && (spec.startsWith("node:") || spec === "fs" || spec === "path")) {
			problems.push(`${file}: imports the Node-only module "${spec}"`);
		}
		if (ui && /(^|\/)workers\//.test(spec))
			problems.push(`${file}: the UI imports Worker code (${spec})`);
		if (worker && (spec.startsWith("~/") || /(^|\/)app\//.test(spec))) {
			problems.push(`${file}: the Worker imports UI code (${spec})`);
		}
		if (file.startsWith("app/") && !file.startsWith("app/i18n/") && RUNTIME.test(spec)) {
			problems.push(`${file}: takes its words from the runtime, not from ~/i18n (${spec})`);
		}
		if (/(^|\/)(scripts|test)\//.test(spec)) {
			problems.push(`${file}: shipped code imports from tooling or tests (${spec})`);
		}
	}
	return problems;
}

export const check: Check = {
	name: "imports",
	run() {
		const problems: string[] = [];
		const modules: [string, string][] = [];
		for (const file of repoFiles()) {
			if (!/\.(ts|tsx)$/.test(file) || !existsSync(file)) continue;
			const source = read(file);
			problems.push(...importProblems(file, source));
			if (file.startsWith("modules/")) modules.push([file, source]);
		}
		problems.push(...debtProblems(authImports(modules)));
		const manifests: [string, string | undefined][] = [];
		for (const kind of ["packages", "modules"]) {
			if (!existsSync(kind)) continue;
			for (const folder of readdirSync(kind)) {
				const manifest = repository.manifest(`${kind}/${folder}`) as { name?: string } | null;
				if (manifest !== null) manifests.push([`${kind}/${folder}`, manifest.name]);
			}
		}
		problems.push(...manifestNameProblems(manifests));
		return problems;
	},
};
