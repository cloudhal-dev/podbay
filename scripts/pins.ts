/**
 * Version policy (docs/engineering-rules.md, V1, V3 and V6).
 *
 *   node scripts/pins.ts --check            offline: every dependency is one exact version, and no
 *                                           pre-release is used without an entry in `pinExceptions`
 *   node scripts/pins.ts --resolve [names]  network (read-only): for each dependency (or the given
 *                                           names) print the newest stable version that is at
 *                                           least MIN_AGE_DAYS old
 *   node scripts/pins.ts --outdated         network: list pins that are behind that version;
 *                                           exit 1 when one is a major behind without an exception
 *
 * The registry is only read. Nothing is installed and package.json is never written here.
 */
import { readFileSync } from "node:fs";

export const MIN_AGE_DAYS = 3;
const REGISTRY = "https://registry.npmjs.org";
const EXACT = /^\d+\.\d+\.\d+$/;
const STABLE = /^\d+\.\d+\.\d+$/;

interface Manifest {
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	/** name -> dated reason. A 0.x package or a pre-release needs an entry (V3). */
	pinExceptions?: Record<string, string>;
}

export function readManifest(path = "package.json"): Manifest {
	return JSON.parse(readFileSync(path, "utf8")) as Manifest;
}

export function allPins(m: Manifest): [string, string][] {
	return Object.entries({ ...m.dependencies, ...m.devDependencies });
}

/** V1 and V3, offline. Returns one message per violation. */
export function checkPins(m: Manifest): string[] {
	const problems: string[] = [];
	const exceptions = m.pinExceptions ?? {};
	for (const [name, version] of allPins(m)) {
		if (!EXACT.test(version)) {
			problems.push(`${name}: "${version}" is not one exact stable version`);
			continue;
		}
		if (version.startsWith("0.") && !(name in exceptions)) {
			problems.push(`${name}: ${version} is a 0.x release and has no pinExceptions entry`);
		}
	}
	for (const name of Object.keys(exceptions)) {
		if (!allPins(m).some(([n]) => n === name)) {
			problems.push(`pinExceptions: "${name}" is not a dependency`);
		}
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
	const m = readManifest();
	if (argv.includes("--check")) {
		const problems = checkPins(m);
		for (const p of problems) process.stderr.write(`pins: ${p}\n`);
		if (problems.length === 0) process.stdout.write(`pins ok (${allPins(m).length} exact)\n`);
		return problems.length === 0 ? 0 : 1;
	}
	const now = Date.now();
	if (argv.includes("--resolve")) {
		const names = argv.filter((a) => !a.startsWith("--"));
		const list = names.length > 0 ? names : allPins(m).map(([n]) => n);
		for (const name of list) process.stdout.write(`${name} ${await settled(name, now)}\n`);
		return 0;
	}
	if (argv.includes("--outdated")) {
		let failed = false;
		for (const [name, version] of allPins(m)) {
			const latest = await settled(name, now);
			if (latest === undefined || cmp(latest, version) <= 0) continue;
			const majorBehind = latest.split(".")[0] !== version.split(".")[0];
			const excused = name in (m.pinExceptions ?? {});
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
