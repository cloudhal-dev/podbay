// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * The original message (ADR-0015), as far as pure code goes: the text that is shown, the name
 * of the file, what is taken from the platform's `Authentication-Results` field, and the
 * condition under which the line about it is shown.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { setLanguage } from "../../app/i18n/index.ts";
import { authenticationWords, markOriginal } from "../../app/lib/original-text.ts";
import {
	AUTHENTICATION_SHOWN,
	MAX_ORIGINAL_BYTES,
	ORIGINAL_SHOWN_BYTES,
	originalFileName,
} from "../../modules/mail/shared/original.ts";
import {
	AUTH_RESULTS_MAX,
	authenticationOf,
	newRawKey,
	originalAnswer,
	platformStatement,
	RAW_KEY,
	splitOriginal,
} from "../../modules/mail/worker/lib/original.ts";

const bytes = (text: string) => new TextEncoder().encode(text);

describe("the text of an original on the screen", () => {
	it("leaves plain text as it is, markup and all", () => {
		const hostile = '<script>alert(1)</script>\n<a href="https://evil.test">click</a>\t&amp;';
		expect(markOriginal(hostile)).toEqual([{ text: hostile }]);
		expect(markOriginal("")).toEqual([]);
	});

	it("ends a line where the message ends it, and marks a carriage return that stands alone", () => {
		expect(markOriginal("one\r\ntwo\nthree")).toEqual([{ text: "one\ntwo\nthree" }]);
		expect(markOriginal("over\rwritten")).toEqual([
			{ text: "over" },
			{ mark: "U+000D", count: 1 },
			{ text: "written" },
		]);
	});

	it("draws every control character as a mark with its code point", () => {
		const controls = [0x01, 0x07, 0x08, 0x0b, 0x0c, 0x1b, 0x1f, 0x7f, 0x80, 0x85, 0x9f];
		for (const code of controls) {
			const mark = `U+${code.toString(16).toUpperCase().padStart(4, "0")}`;
			expect(markOriginal(`a${String.fromCodePoint(code)}b`), mark).toEqual([
				{ text: "a" },
				{ mark, count: 1 },
				{ text: "b" },
			]);
		}
		// A tab and a line feed are what they are.
		expect(markOriginal("a\tb\nc")).toEqual([{ text: "a\tb\nc" }]);
	});

	it("draws every character that changes the direction of text as a mark", () => {
		const direction = [
			0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068,
			0x2069,
		];
		for (const code of direction) {
			const pieces = markOriginal(`invoice${String.fromCodePoint(code)}fdp.exe`);
			expect(pieces, code.toString(16)).toHaveLength(3);
			expect(pieces[1]).toEqual({
				mark: `U+${code.toString(16).toUpperCase().padStart(4, "0")}`,
				count: 1,
			});
		}
		// What is drawn holds no such character any more: the line reads in the order of its bytes.
		const drawn = markOriginal("Subject: ‮gnp.exe‬ ⁦x⁩")
			.map((piece) => ("text" in piece ? piece.text : piece.mark))
			.join("");
		expect(drawn).toBe("Subject: U+202Egnp.exeU+202C U+2066xU+2069");
		expect(drawn).not.toMatch(/[؜‎‏‪-‮⁦-⁩]/);
	});

	it("marks what takes no room or breaks a line, and counts a run as one mark", () => {
		for (const code of [0x00ad, 0x200b, 0x200c, 0x200d, 0x2028, 0x2029, 0x2060, 0xfeff]) {
			expect(markOriginal(String.fromCodePoint(code))).toEqual([
				{ mark: `U+${code.toString(16).toUpperCase().padStart(4, "0")}`, count: 1 },
			]);
		}
		expect(markOriginal(`a${"‮".repeat(5000)}b`)).toEqual([
			{ text: "a" },
			{ mark: "U+202E", count: 5000 },
			{ text: "b" },
		]);
		// Other writing is text: letters of any script, and a character outside the first plane.
		expect(markOriginal("Çağrı שלום 😀 �")).toEqual([{ text: "Çağrı שלום 😀 �" }]);
	});
});

describe("the name of the file", () => {
	it("is the day it arrived and the start of the message's id, and nothing else", () => {
		expect(
			originalFileName("2026-11-17T21:04:05.678Z", "3f2a9c1e-7b4d-4e2a-9c1e-aabbccddeeff"),
		).toBe("message-20261117-3f2a9c1e.eml");
		// The day is the day in UTC, as the date is stored.
		expect(originalFileName("2026-01-01T00:30:00+02:00", "abcdef0123456789")).toBe(
			"message-20251231-abcdef01.eml",
		);
	});

	it("never holds a path, whatever the id and the date are", () => {
		const names = [
			originalFileName("not a date", "../../etc/passwd"),
			originalFileName("", ""),
			originalFileName("2026-11-17T00:00:00Z", '"><script>.exe'),
			originalFileName("2026-11-17T00:00:00Z", "ab"),
			originalFileName("../../2026", "..\\..\\x‮gnp"),
		];
		expect(names).toEqual([
			"message-00000000-etcpassw.eml",
			"message-00000000-00000000.eml",
			"message-20261117-scriptex.eml",
			"message-20261117-ab000000.eml",
			"message-00000000-xgnp0000.eml",
		]);
		for (const name of names) expect(name).toMatch(/^message-\d{8}-[a-z0-9]{8}\.eml$/);
	});
});

describe("the key of an original", () => {
	it("is `raw/` and 32 hexadecimal characters from random bytes", () => {
		const made = new Set(Array.from({ length: 200 }, () => newRawKey()));
		expect(made.size).toBe(200);
		for (const key of made) {
			expect(key).toMatch(RAW_KEY);
			expect(key).toHaveLength(36);
		}
		expect("raw/../attachments/x").not.toMatch(RAW_KEY);
		expect("raw/0123456789ABCDEF0123456789ABCDEF").not.toMatch(RAW_KEY);
	});
});

describe("the first bytes of an original as text", () => {
	it("splits the header block from what follows the first empty line", () => {
		expect(splitOriginal("A: 1\r\nB: 2\r\n\r\nbody\r\n\r\nmore")).toEqual({
			header: "A: 1\r\nB: 2",
			rest: "body\r\n\r\nmore",
		});
		expect(splitOriginal("A: 1\nB: 2\n\nbody")).toEqual({ header: "A: 1\nB: 2", rest: "body" });
		expect(splitOriginal("A: 1\r\nB: 2")).toEqual({ header: "A: 1\r\nB: 2", rest: "" });
		expect(splitOriginal("\r\nno header at all")).toEqual({ header: "", rest: "no header at all" });
		expect(splitOriginal("")).toEqual({ header: "", rest: "" });
	});

	it("decodes as UTF-8, with U+FFFD for what is not and NUL dropped", () => {
		const raw = new Uint8Array([...bytes("S: é\r\n\r\n"), 0x41, 0x00, 0xff, 0x42, 0xc3]);
		expect(originalAnswer(raw, raw.length, null, false)).toEqual({
			size: raw.length,
			shown: raw.length,
			header: "S: é",
			// The whole of it is there, so a sequence that never ends is shown as broken.
			rest: "A�B�",
		});
	});

	it("leaves out a character the cut went through, and says how many bytes it covers", () => {
		for (const [character, length] of [
			["é", 2],
			["€", 3],
			["😀", 4],
		] as const) {
			const whole = bytes(`x\r\n\r\nab${character}`);
			for (let cut = 1; cut < length; cut++) {
				const part = whole.subarray(0, whole.length - cut);
				const answer = originalAnswer(part, whole.length, null, false);
				expect(answer.rest, `${character} cut by ${cut}`).toBe("ab");
				expect(answer.shown).toBe(whole.length - length);
				expect(answer.size).toBe(whole.length);
			}
			// A cut after the character keeps it.
			expect(originalAnswer(whole, whole.length + 10, null, false).rest).toBe(`ab${character}`);
		}
	});

	it("covers 256 KiB, of a message of at most 25 MiB", () => {
		expect(ORIGINAL_SHOWN_BYTES).toBe(262_144);
		expect(MAX_ORIGINAL_BYTES).toBe(26_214_400);
	});
});

describe("the platform's statement about SPF, DKIM and DMARC", () => {
	const PLATFORM = "mx.cloudflare.net; spf=fail smtp.mailfrom=evil.test; dkim=none; dmarc=fail";
	const FORGED = "mx.cloudflare.net; spf=pass; dkim=pass; dmarc=pass";
	const from = (...fields: string[]) => {
		const headers = new Headers();
		for (const field of fields) headers.append("Authentication-Results", field);
		return platformStatement(headers);
	};

	it("is the first field, cut at the first comma outside a quoted string or a comment", () => {
		expect(from(PLATFORM)).toBe(PLATFORM);
		expect(from(PLATFORM, FORGED)).toBe(PLATFORM);
		expect(
			platformStatement(new Headers({ "authentication-results": `${PLATFORM},${FORGED}` })),
		).toBe(PLATFORM);
		const quoted = 'mx.cloudflare.net; dkim=fail reason="a, \\" b" (c, (d, e)); dmarc=fail';
		expect(from(quoted, FORGED)).toBe(quoted);
		expect(from("mx.cloudflare.net 1; dmarc=none")).toBe("mx.cloudflare.net 1; dmarc=none");
		expect(from("mx.cloudflare.net; none")).toBe("mx.cloudflare.net; none");
	});

	it("is nothing without the field, or without the headers", () => {
		expect(platformStatement(new Headers())).toBeNull();
		expect(platformStatement(undefined)).toBeNull();
		expect(from("")).toBeNull();
	});

	it("is nothing when the identifier is not exactly the platform's", () => {
		for (const first of [
			"mx.evil.test; dmarc=pass",
			"mx.cloudflare.net.evil.test; dmarc=pass",
			"xmx.cloudflare.net; dmarc=pass",
			"MX.CLOUDFLARE.NET; dmarc=pass",
			'"mx.cloudflare.net"; dmarc=pass',
			"(mx.cloudflare.net) mx.evil.test; dmarc=pass",
			"mx.cloudflare.net mx.evil.test; dmarc=pass",
			"mx.cloudflare.net 1 2; dmarc=pass",
			"mx.cloudflare.net x; dmarc=pass",
			"; mx.cloudflare.net; dmarc=pass",
			"dmarc=pass",
		]) {
			expect(from(first), first).toBeNull();
			expect(from(first, PLATFORM), first).toBeNull();
		}
	});

	it("is nothing when a quoted string or a comment of the first field never closes", () => {
		expect(from('mx.cloudflare.net; dkim=fail reason="open', FORGED)).toBeNull();
		expect(from("mx.cloudflare.net; dkim=fail (open", FORGED)).toBeNull();
		expect(from('mx.cloudflare.net; dkim=fail reason="open \\"', FORGED)).toBeNull();
	});

	it("is cut to 2,048 characters", () => {
		const kept = from(`mx.cloudflare.net; dmarc=pass ${"x".repeat(9000)}`) ?? "";
		expect(kept).toHaveLength(AUTH_RESULTS_MAX);
		expect(AUTH_RESULTS_MAX).toBe(2048);
	});

	it("is read back as the identifier and each result, in the field's order", () => {
		expect(authenticationOf(PLATFORM)).toEqual({
			identifier: "mx.cloudflare.net",
			results: [
				{ method: "spf", result: "fail" },
				{ method: "dkim", result: "none" },
				{ method: "dmarc", result: "fail" },
			],
		});
		// Two signatures are two results; another mechanism, a result that is no plain lower-case
		// word, and what stands inside a comment or a quoted string are not given.
		expect(
			authenticationOf(
				'mx.cloudflare.net 1; dkim=pass header.d=a.test; dkim=fail (dmarc=pass) reason="x; spf=pass"; arc=pass; dmarc=PASS; spf=soft-fail; iprev=pass; dmarc = temperror',
			)?.results,
		).toEqual([
			{ method: "dkim", result: "pass" },
			{ method: "dkim", result: "fail" },
			{ method: "dmarc", result: "temperror" },
		]);
		expect(authenticationOf("mx.cloudflare.net; none")).toEqual({
			identifier: "mx.cloudflare.net",
			results: [],
		});
		expect(authenticationOf(null)).toBeNull();
		expect(authenticationOf("")).toBeNull();
		expect(authenticationOf("mx.evil.test; dmarc=pass")).toBeNull();
		// A stored field that was cut inside a quoted string is read up to where that string begins.
		expect(
			authenticationOf('mx.cloudflare.net; spf=pass; dkim=fail reason="cut; dmarc=pass'),
		).toEqual({
			identifier: "mx.cloudflare.net",
			results: [
				{ method: "spf", result: "pass" },
				{ method: "dkim", result: "fail" },
			],
		});
	});

	it("is in the answer only when it is asked for", () => {
		const raw = bytes("A: 1\r\n\r\nx");
		expect("authentication" in originalAnswer(raw, raw.length, PLATFORM, false)).toBe(false);
		expect(originalAnswer(raw, raw.length, PLATFORM, true).authentication?.results).toHaveLength(3);
		expect(originalAnswer(raw, raw.length, null, true).authentication).toBeNull();
	});

	it("is said as the platform's statement: no word of Podbay's own about the results", () => {
		setLanguage("en");
		const said = authenticationWords(authenticationOf(PLATFORM));
		expect(said).toBe(
			"Cloudflare Email Routing recorded these results when this message arrived: spf=fail, dkim=none, dmarc=fail. Podbay did not check them itself.",
		);
		const all = [
			said,
			authenticationWords(null),
			authenticationWords({ identifier: "mx.cloudflare.net", results: [] }),
		];
		expect(all[1]).toBe("Nothing was recorded about SPF, DKIM or DMARC when this message arrived.");
		for (const sentence of all) {
			expect(sentence).not.toMatch(/verified|authentic\b|trusted|genuine|safe|✓|✔|sender|wrote/i);
		}
		setLanguage("tr");
		expect(authenticationWords(authenticationOf(PLATFORM))).toContain(
			"spf=fail, dkim=none, dmarc=fail",
		);
		setLanguage("en");
	});

	it("is shown only once the live check of decision 19 is recorded in the ledger", () => {
		const ledger = JSON.parse(readFileSync("docs/cloudflare/ledger.json", "utf8")) as {
			entries: { id: string; verifiedAt: string | null; evidence: string }[];
		};
		const check = ledger.entries.find(
			(entry) => entry.id === "runtime.email.authentication_results.forged",
		);
		expect(check, "the ledger entry for the live check").toBeDefined();
		// The line is built behind this: it appears when what arrived at a real domain is written
		// down, and not before.
		expect(AUTHENTICATION_SHOWN).toBe(check?.verifiedAt !== null);
	});
});
