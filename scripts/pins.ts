/**
 * Version policy (docs/engineering-rules.md, V1, V3 and V6; ADR-0018, decision 4).
 *
 *   node scripts/pins.ts --check            offline: every package of the workspace takes its
 *                                           versions from the catalog of pnpm-workspace.yaml, and
 *                                           the catalog holds one exact stable version for each,
 *                                           a 0.x one only with an entry in `pinExceptions`
 *   node scripts/pins.ts --resolve [names]  network (read-only): for each catalog entry (or the
 *                                           given names) print the newest stable version that is
 *                                           at least MIN_AGE_DAYS old
 *   node scripts/pins.ts --outdated         network: list entries that are behind that version;
 *                                           exit 1 when one is a major behind without an exception
 *
 * The registry is only read. Nothing is installed and no file is written here.
 */
import { readFileSync } from "node:fs";
import { type Manifest, manifests, readWorkspace, type Workspace } from "./workspace.ts";

export const MIN_AGE_DAYS = 3;
const REGISTRY = "https://registry.npmjs.org";
const EXACT = /^\d+\.\d+\.\d+$/;
const STABLE = /^\d+\.\d+\.\d+$/;
const FIELDS = [
	"dependencies",
	"devDependencies",
	"optionalDependencies",
	"peerDependencies",
] as const;

/** The workspace at `root` and every package's manifest, or what in it is not read. */
export function readAll(
	root = ".",
): { workspace: Workspace; packages: Map<string, Manifest> } | { problems: string[] } {
	const workspace = readWorkspace(readFileSync(`${root}/pnpm-workspace.yaml`, "utf8"));
	if ("problems" in workspace) return workspace;
	return { workspace, packages: manifests(workspace, root) };
}

/** Every catalog entry, as [name, version]. */
export function allPins(workspace: Workspace): [string, string][] {
	return Object.entries(workspace.catalog);
}

/** V1 and V3, offline. Returns one message per violation. */
export function checkPins(workspace: Workspace, packages: ReadonlyMap<string, Manifest>): string[] {
	const problems: string[] = [];
	const names = new Set([...packages.values()].map((one) => one.name).filter(Boolean));
	const used = new Set<string>();
	for (const [dir, manifest] of packages) {
		for (const field of FIELDS) {
			for (const [name, spec] of Object.entries(manifest[field] ?? {})) {
				if (spec.startsWith("workspace:")) {
					if (!names.has(name))
						problems.push(`${dir}: "${name}" is not a package of the workspace`);
					continue;
				}
				if (field === "peerDependencies") continue;
				if (spec !== "catalog:") {
					problems.push(
						`${dir}: ${name} is "${spec}"; a version is written once, in the catalog of pnpm-workspace.yaml, and the package says "catalog:"`,
					);
					continue;
				}
				if (!(name in workspace.catalog)) problems.push(`${dir}: ${name} is not in the catalog`);
				used.add(name);
			}
		}
	}
	for (const [name, version] of allPins(workspace)) {
		if (!EXACT.test(version)) {
			problems.push(`catalog: ${name} "${version}" is not one exact stable version`);
		} else if (version.startsWith("0.") && !(name in workspace.pinExceptions)) {
			problems.push(`catalog: ${name} ${version} is a 0.x release and has no pinExceptions entry`);
		}
		if (!used.has(name)) problems.push(`catalog: ${name} is used by no package`);
	}
	for (const name of Object.keys(workspace.pinExceptions)) {
		if (!(name in workspace.catalog))
			problems.push(`pinExceptions: "${name}" is not in the catalog`);
	}
	return problems;
}

function cmp(a: string, b: string): number {
	const x = a.split(".").map(Number);
	const y = b.split(".").map(Number);
	for (let i = 0; i < 3; i++) {
		const d = (x[i] ?? 0) - (y[i] ?? 0);
		if (d !== 0) return d;
	}
	return 0;
}

/** The newest stable version published at least `minAgeDays` before `now`. */
export function newestSettled(
	times: Record<string, string>,
	now: number,
	minAgeDays = MIN_AGE_DAYS,
): string | undefined {
	const cutoff = now - minAgeDays * 86_400_000;
	let best: string | undefined;
	for (const [version, at] of Object.entries(times)) {
		if (!STABLE.test(version)) continue;
		if (Date.parse(at) > cutoff) continue;
		if (best === undefined || cmp(version, best) > 0) best = version;
	}
	return best;
}

async function settled(name: string, now: number): Promise<string | undefined> {
	const res = await fetch(`${REGISTRY}/${name.replaceAll("/", "%2F")}`, {
		headers: { accept: "application/json" },
	});
	if (!res.ok) throw new Error(`${name}: registry answered ${res.status}`);
	const body = (await res.json()) as { time?: Record<string, string>; versions?: object };
	const published = new Set(Object.keys(body.versions ?? {}));
	const times = Object.fromEntries(
		Object.entries(body.time ?? {}).filter(([v]) => published.has(v)),
	);
	return newestSettled(times, now);
}

async function main(argv: string[]): Promise<number> {
	const read = readAll();
	if ("problems" in read) {
		for (const p of read.problems) process.stderr.write(`pins: ${p}\n`);
		return 1;
	}
	const { workspace, packages } = read;
	if (argv.includes("--check")) {
		const problems = checkPins(workspace, packages);
		for (const p of problems) process.stderr.write(`pins: ${p}\n`);
		if (problems.length === 0) {
			process.stdout.write(
				`pins ok (${allPins(workspace).length} exact, ${packages.size} package(s))\n`,
			);
		}
		return problems.length === 0 ? 0 : 1;
	}
	const now = Date.now();
	if (argv.includes("--resolve")) {
		const names = argv.filter((a) => !a.startsWith("--"));
		const list = names.length > 0 ? names : allPins(workspace).map(([n]) => n);
		for (const name of list) process.stdout.write(`${name} ${await settled(name, now)}\n`);
		return 0;
	}
	if (argv.includes("--outdated")) {
		let failed = false;
		for (const [name, version] of allPins(workspace)) {
			const latest = await settled(name, now);
			if (latest === undefined || cmp(latest, version) <= 0) continue;
			const majorBehind = latest.split(".")[0] !== version.split(".")[0];
			const excused = name in workspace.pinExceptions;
			if (majorBehind && !excused) failed = true;
			process.stdout.write(`${name} ${version} -> ${latest}${majorBehind ? " (major)" : ""}\n`);
		}
		return failed ? 1 : 0;
	}
	process.stderr.write("usage: node scripts/pins.ts --check | --resolve [names] | --outdated\n");
	return 2;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	process.exitCode = await main(process.argv.slice(2));
}
