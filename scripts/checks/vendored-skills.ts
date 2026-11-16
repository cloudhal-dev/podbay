/**
 * S18: Cloudflare's `security-audit` skill is vendored unedited. The `vendored.json` in its
 * directory records where the files came from (source, commit, licence) and a SHA-256 per file.
 * This check fails when
 *
 * - a listed file is missing, or its bytes no longer match the recorded hash;
 * - the directory holds a file the manifest does not list (the manifest itself is the one
 *   exception: a file cannot record its own hash);
 * - the manifest is missing, is not valid, or no longer says where the files came from.
 *
 * The manifest is not covered by a hash. An honest update changes `commit` together with the
 * hashes; a hash that changes while the commit stays the same is what review looks for.
 *
 * The directory is listed the way every other check lists the repository: the files git tracks
 * or would track. An ignored file there never ships and is not reported.
 */
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { type Check, repoFiles } from "./lib.ts";

export const VENDORED_DIR = ".claude/skills/security-audit";
export const MANIFEST = "vendored.json";

const SHA256 = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const LICENCE_FILE = /^(?:LICEN[CS]E|COPYING)(?:\.[A-Za-z]+)?$/;

export interface VendoredManifest {
	readonly source: string;
	readonly commit: string;
	readonly license: string;
	/** File path relative to the vendored directory, mapped to its SHA-256 in lower-case hex. */
	readonly files: Readonly<Record<string, string>>;
}

export interface ParsedManifest {
	/** Null when the list of files cannot be read at all. */
	readonly manifest: VendoredManifest | null;
	readonly problems: string[];
}

export function sha256(bytes: Uint8Array | string): string {
	return createHash("sha256").update(bytes).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A path that stays inside the vendored directory: relative, forward slashes, no dot segments. */
function plainPath(file: string): boolean {
	if (file.length === 0 || file.startsWith("/") || file.includes("\\")) return false;
	return file.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

/** Reads the manifest text. Problems are about the manifest itself, not about the files. */
export function parseManifest(text: string): ParsedManifest {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return { manifest: null, problems: ["is not valid JSON"] };
	}
	if (!isRecord(parsed)) return { manifest: null, problems: ["is not a JSON object"] };

	const problems: string[] = [];
	const source = typeof parsed.source === "string" ? parsed.source : "";
	const commit = typeof parsed.commit === "string" ? parsed.commit : "";
	const license = typeof parsed.license === "string" ? parsed.license : "";
	if (!source.startsWith("https://"))
		problems.push('"source" must be the https URL of the upstream');
	if (!COMMIT.test(commit)) problems.push('"commit" must be the full upstream commit hash');
	if (license.trim() === "") problems.push('"license" must name the upstream licence');

	if (!isRecord(parsed.files)) {
		problems.push('"files" must map each vendored file to its sha256');
		return { manifest: null, problems };
	}
	const files: Record<string, string> = {};
	for (const [file, hash] of Object.entries(parsed.files)) {
		if (typeof hash === "string") files[file] = hash;
		else problems.push(`"files" entry ${file} is not a string`);
	}
	if (Object.keys(files).length === 0) problems.push('"files" lists nothing');
	else if (!Object.keys(files).some((file) => LICENCE_FILE.test(file))) {
		problems.push('"files" lists no licence file; the upstream licence travels with the copy');
	}
	return { manifest: { source, commit, license, files }, problems };
}

/**
 * Compares the vendored directory with its manifest. `present` is every file in the directory,
 * relative to it; `bytesOf` returns a file's bytes, or null when it is missing or not a regular
 * file. File names in the messages are relative to the directory.
 */
export function vendoredProblems(
	manifest: VendoredManifest,
	present: readonly string[],
	bytesOf: (file: string) => Uint8Array | null,
): string[] {
	const problems: string[] = [];
	const listed = Object.keys(manifest.files).sort();

	for (const file of listed) {
		const expected = manifest.files[file] ?? "";
		if (file === MANIFEST) {
			problems.push(`${file}: lists itself; a file cannot record its own hash`);
			continue;
		}
		if (!plainPath(file)) {
			problems.push(`${file}: listed, but not a plain path inside the vendored directory`);
			continue;
		}
		if (!SHA256.test(expected)) {
			problems.push(`${file}: the recorded sha256 is not 64 lower-case hex characters`);
			continue;
		}
		const bytes = bytesOf(file);
		if (bytes === null) {
			problems.push(`${file}: listed in ${MANIFEST} but missing`);
			continue;
		}
		const actual = sha256(bytes);
		if (actual !== expected) {
			problems.push(
				`${file}: sha256 is ${actual}, ${MANIFEST} records ${expected}; the vendored skill is never edited (rule S18)`,
			);
		}
	}

	const known = new Set(listed);
	for (const file of [...new Set(present)].sort()) {
		if (file === MANIFEST || known.has(file)) continue;
		problems.push(
			`${file}: not listed in ${MANIFEST}; nothing is added to the vendored skill (rule S18)`,
		);
	}
	return problems;
}

function regularFile(path: string): boolean {
	return existsSync(path) && lstatSync(path).isFile();
}

export const check: Check = {
	name: "vendored",
	run() {
		const prefix = `${VENDORED_DIR}/`;
		const manifestPath = `${prefix}${MANIFEST}`;
		if (!regularFile(manifestPath)) {
			return [`${manifestPath}: missing; the security-audit skill is vendored with it (rule S18)`];
		}
		const { manifest, problems } = parseManifest(readFileSync(manifestPath, "utf8"));
		const found = problems.map((problem) => `${manifestPath}: ${problem}`);
		if (manifest === null) return found;

		const present = repoFiles()
			.filter((file) => file.startsWith(prefix) && existsSync(file))
			.map((file) => file.slice(prefix.length));
		const bytesOf = (file: string) =>
			regularFile(prefix + file) ? readFileSync(prefix + file) : null;
		for (const problem of vendoredProblems(manifest, present, bytesOf)) {
			found.push(`${prefix}${problem}`);
		}
		return found;
	},
};
