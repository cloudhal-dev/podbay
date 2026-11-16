import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	check,
	MANIFEST,
	parseManifest,
	sha256,
	VENDORED_DIR,
	type VendoredManifest,
	vendoredProblems,
} from "../../scripts/checks/vendored-skills.ts";

const encoder = new TextEncoder();

/** A vendored directory held in memory: file name to content. */
function directory(files: Record<string, string>) {
	const bytesOf = (file: string) => {
		const content = files[file];
		return content === undefined ? null : encoder.encode(content);
	};
	return { present: Object.keys(files), bytesOf };
}

const CONTENT = {
	"SKILL.md": "# The skill\n",
	LICENSE: "MIT License\n",
	"notes/DETAIL.md": "Detail.\n",
};

function manifestFor(files: Record<string, string>): VendoredManifest {
	return {
		source: "https://example.test/upstream",
		commit: "0123456789abcdef0123456789abcdef01234567",
		license: "MIT",
		files: Object.fromEntries(
			Object.entries(files).map(([file, content]) => [file, sha256(content)]),
		),
	};
}

describe("sha256", () => {
	it("hashes bytes and text alike", () => {
		const empty = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
		expect(sha256("")).toBe(empty);
		expect(sha256(new Uint8Array())).toBe(empty);
		expect(sha256("abc")).toBe(sha256(encoder.encode("abc")));
	});
});

describe("vendoredProblems", () => {
	it("passes when every listed file matches and nothing else is there", () => {
		const { present, bytesOf } = directory(CONTENT);
		expect(vendoredProblems(manifestFor(CONTENT), present, bytesOf)).toEqual([]);
	});

	it("does not count the manifest itself as an unlisted file", () => {
		const { present, bytesOf } = directory({ ...CONTENT, [MANIFEST]: "{}" });
		expect(vendoredProblems(manifestFor(CONTENT), present, bytesOf)).toEqual([]);
	});

	it("reports a changed file with both hashes", () => {
		const edited = "# The skill, improved\n";
		const { present, bytesOf } = directory({ ...CONTENT, "SKILL.md": edited });
		expect(vendoredProblems(manifestFor(CONTENT), present, bytesOf)).toEqual([
			`SKILL.md: sha256 is ${sha256(edited)}, vendored.json records ${sha256(CONTENT["SKILL.md"])}; the vendored skill is never edited (rule S18)`,
		]);
	});

	it("notices a change of a single byte", () => {
		const { present, bytesOf } = directory({ ...CONTENT, LICENSE: "MIT License \n" });
		expect(vendoredProblems(manifestFor(CONTENT), present, bytesOf)).toHaveLength(1);
	});

	it("reports a listed file that is missing", () => {
		const { "notes/DETAIL.md": _removed, ...rest } = CONTENT;
		const { present, bytesOf } = directory(rest);
		expect(vendoredProblems(manifestFor(CONTENT), present, bytesOf)).toEqual([
			"notes/DETAIL.md: listed in vendored.json but missing",
		]);
	});

	it("reports a file that the manifest does not list", () => {
		const { present, bytesOf } = directory({ ...CONTENT, "EXTRA.md": "Our own advice.\n" });
		expect(vendoredProblems(manifestFor(CONTENT), present, bytesOf)).toEqual([
			"EXTRA.md: not listed in vendored.json; nothing is added to the vendored skill (rule S18)",
		]);
	});

	it("gives one message per problem, in a stable order", () => {
		const { LICENSE: _removed, ...rest } = CONTENT;
		const { present, bytesOf } = directory({
			...rest,
			"SKILL.md": "edited",
			"b-extra.md": "x",
			"a-extra.md": "x",
		});
		const problems = vendoredProblems(manifestFor(CONTENT), present, bytesOf);
		expect(problems.map((problem) => problem.split(":")[0])).toEqual([
			"LICENSE",
			"SKILL.md",
			"a-extra.md",
			"b-extra.md",
		]);
	});

	it("rejects a manifest that lists itself", () => {
		const manifest = manifestFor({ ...CONTENT, [MANIFEST]: "{}" });
		const { present, bytesOf } = directory({ ...CONTENT, [MANIFEST]: "{}" });
		expect(vendoredProblems(manifest, present, bytesOf)).toEqual([
			"vendored.json: lists itself; a file cannot record its own hash",
		]);
	});

	it.each(["../outside.md", "/etc/hosts", "a/../../b.md", "a\\b.md", "./SKILL.md", ""])(
		"never reads the listed path %j",
		(file) => {
			const manifest: VendoredManifest = {
				...manifestFor(CONTENT),
				files: { ...manifestFor(CONTENT).files, [file]: sha256("x") },
			};
			const { present } = directory(CONTENT);
			const read: string[] = [];
			const problems = vendoredProblems(manifest, present, (name) => {
				read.push(name);
				return encoder.encode(CONTENT[name as keyof typeof CONTENT] ?? "x");
			});
			expect(problems).toEqual([
				`${file}: listed, but not a plain path inside the vendored directory`,
			]);
			expect(read).not.toContain(file);
		},
	);

	it("rejects a recorded hash that is not a sha256", () => {
		const manifest: VendoredManifest = {
			...manifestFor(CONTENT),
			files: { ...manifestFor(CONTENT).files, LICENSE: "ABC123" },
		};
		const { present, bytesOf } = directory(CONTENT);
		expect(vendoredProblems(manifest, present, bytesOf)).toEqual([
			"LICENSE: the recorded sha256 is not 64 lower-case hex characters",
		]);
	});
});

describe("parseManifest", () => {
	const valid = JSON.stringify({ $comment: "why", ...manifestFor(CONTENT) });

	it("reads a complete manifest", () => {
		const { manifest, problems } = parseManifest(valid);
		expect(problems).toEqual([]);
		expect(manifest?.files).toEqual(manifestFor(CONTENT).files);
		expect(manifest?.commit).toBe("0123456789abcdef0123456789abcdef01234567");
	});

	it.each(["", "{", "[]", "null", '"text"'])("rejects %j", (text) => {
		const { manifest, problems } = parseManifest(text);
		expect(manifest).toBeNull();
		expect(problems).toHaveLength(1);
	});

	it("requires the source, the full commit and the licence", () => {
		const { manifest, problems } = parseManifest(
			JSON.stringify({
				source: "git@example.test:upstream",
				commit: "0123456",
				files: manifestFor(CONTENT).files,
			}),
		);
		expect(manifest).not.toBeNull();
		expect(problems).toEqual([
			'"source" must be the https URL of the upstream',
			'"commit" must be the full upstream commit hash',
			'"license" must name the upstream licence',
		]);
	});

	it("requires the list of files", () => {
		const { files: _files, ...rest } = manifestFor(CONTENT);
		expect(parseManifest(JSON.stringify(rest)).manifest).toBeNull();
		expect(parseManifest(JSON.stringify({ ...rest, files: [] })).manifest).toBeNull();
		expect(parseManifest(JSON.stringify({ ...rest, files: {} })).problems).toEqual([
			'"files" lists nothing',
		]);
	});

	it("requires the licence file to travel with the copy", () => {
		const { LICENSE: _licence, ...withoutLicence } = CONTENT;
		expect(parseManifest(JSON.stringify(manifestFor(withoutLicence))).problems).toEqual([
			'"files" lists no licence file; the upstream licence travels with the copy',
		]);
	});

	it("reports an entry whose hash is not a string", () => {
		const manifest = { ...manifestFor(CONTENT), files: { ...manifestFor(CONTENT).files, x: 1 } };
		expect(parseManifest(JSON.stringify(manifest)).problems).toEqual([
			'"files" entry x is not a string',
		]);
	});
});

describe("the repository's vendored security-audit skill", () => {
	it("matches its manifest", async () => {
		expect(check.name).toBe("vendored");
		expect(await check.run()).toEqual([]);
	});

	it("is the skill the rule names, with its licence", () => {
		const { manifest, problems } = parseManifest(
			readFileSync(`${VENDORED_DIR}/${MANIFEST}`, "utf8"),
		);
		expect(problems).toEqual([]);
		expect(manifest?.source).toBe("https://github.com/cloudflare/security-audit-skill");
		expect(manifest?.license).toBe("MIT");
		expect(Object.keys(manifest?.files ?? {})).toEqual(
			expect.arrayContaining(["SKILL.md", "LICENSE"]),
		);
	});
});
