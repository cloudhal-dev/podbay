/**
 * The workspace as the version rules read it (V1, V3; ADR-0018, decision 4): its packages, the
 * catalog that holds every version of the workspace in one place, and the written exceptions,
 * which stay in the root `package.json` under `pinExceptions`: a pnpm that the project pins
 * refuses a setting it does not know in `pnpm-workspace.yaml` (ERR_PNPM_UNRECOGNIZED_WORKSPACE_SETTINGS).
 *
 * `pnpm-workspace.yaml` is read line by line, not as YAML, and only in the shape this repository
 * writes it: top-level keys; under `packages`, list items; under `catalog` and `allowBuilds`, one
 * `name: value` per line. A line in another shape is refused, so a version
 * cannot hide in a form the rules do not read (a second, named catalog, say). A package is a
 * directory listed under `packages` as itself (`.`) or as the directories of one folder
 * (`packages/*`).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface Workspace {
	/** The directories of the workspace's packages, relative to its root. */
	packages: string[];
	/** Every version of the workspace, by package name. */
	catalog: Record<string, string>;
	/** A 0.x package, or one held back on purpose, with the dated reason. */
	pinExceptions: Record<string, string>;
}

export interface Manifest {
	name?: string;
	/** In the root manifest only: name -> dated reason (V3). */
	pinExceptions?: Record<string, string>;
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	optionalDependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
}

/** Keys whose lines are `name: value`; the others are settings of one line. */
const MAPS = new Set(["catalog", "allowBuilds"]);
const unquote = (text: string) => text.trim().replace(/^(["'])(.*)\1$/, "$2");

/** Reads the workspace file's text, or says what in it is not read. */
export function readWorkspace(text: string): Workspace | { problems: string[] } {
	const workspace: Workspace = { packages: [], catalog: {}, pinExceptions: {} };
	const problems: string[] = [];
	let section: string | null = null;
	text.split("\n").forEach((raw, index) => {
		const at = `pnpm-workspace.yaml:${index + 1}`;
		const line = raw.replace(/\s+#.*$/, "");
		if (line.trim() === "" || line.trimStart().startsWith("#")) return;
		const top = /^([A-Za-z][A-Za-z0-9]*):(?:\s+(\S.*))?$/.exec(line);
		if (top) {
			section = top[1] as string;
			if (section === "catalogs")
				problems.push(`${at}: named catalogs are not read; use the one catalog`);
			if (top[2] !== undefined && (section === "packages" || MAPS.has(section))) {
				problems.push(`${at}: "${section}" written on one line is not read`);
			}
			return;
		}
		if (section === "packages") {
			const item = /^ {2}- (\S.*)$/.exec(line);
			if (item) workspace.packages.push(unquote(item[1] as string));
			else problems.push(`${at}: not a list item of "packages"`);
			return;
		}
		if (section !== null && MAPS.has(section)) {
			const entry = /^ {2}("[^"]+"|'[^']+'|[^\s:'"][^:]*?):\s+(\S.*)$/.exec(line);
			if (!entry) {
				problems.push(`${at}: not one "name: value" line of "${section}"`);
				return;
			}
			const name = unquote(entry[1] as string);
			const value = unquote(entry[2] as string);
			if (section === "catalog") workspace.catalog[name] = value;
			return;
		}
		problems.push(`${at}: a line the version rules do not read`);
	});
	return problems.length > 0 ? { problems } : workspace;
}

/** The directories `packages` names, under `root`: `.`, a directory, or `dir/*`. */
export function packageDirs(workspace: Workspace, root: string): string[] {
	const dirs: string[] = [];
	for (const pattern of workspace.packages) {
		if (pattern.endsWith("/*") && !pattern.slice(0, -2).includes("*")) {
			const base = pattern.slice(0, -2);
			if (!existsSync(join(root, base))) continue;
			for (const name of readdirSync(join(root, base)).sort()) {
				if (existsSync(join(root, base, name, "package.json"))) dirs.push(`${base}/${name}`);
			}
		} else if (!pattern.includes("*")) {
			dirs.push(pattern);
		} else {
			throw new Error(`pnpm-workspace.yaml: the package pattern "${pattern}" is not read`);
		}
	}
	return dirs;
}

/** Every package's manifest, by its directory. */
export function manifests(workspace: Workspace, root: string): Map<string, Manifest> {
	const found = new Map<string, Manifest>();
	for (const dir of packageDirs(workspace, root)) {
		const file = join(root, dir, "package.json");
		found.set(dir, JSON.parse(readFileSync(file, "utf8")) as Manifest);
	}
	// The exceptions are the root manifest's, as pnpm takes no setting of ours beside the catalog.
	workspace.pinExceptions = { ...found.get(".")?.pinExceptions };
	return found;
}
