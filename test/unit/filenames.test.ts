import { describe, expect, it } from "vitest";
import { headerFilename, storageFilename } from "../../workers/lib/filenames.ts";

describe("storageFilename", () => {
	it("keeps an ordinary name", () => {
		expect(storageFilename("Invoice 2026-11.pdf")).toBe("Invoice 2026-11.pdf");
	});

	it("keeps non-ASCII letters", () => {
		expect(storageFilename("fatura şubat.pdf")).toBe("fatura şubat.pdf");
	});

	it.each([
		["../../etc/passwd", ".._.._etc_passwd"],
		["..\\..\\boot.ini", ".._.._boot.ini"],
		["a/b", "a_b"],
		['we"ird<name>|x?.txt', "we_ird_name__x_.txt"],
		["line\nbreak\r.txt", "line_break_.txt"],
		["nul\u0000byte.txt", "nul_byte.txt"],
		["del\u007f.txt", "del_.txt"],
	])("neutralises %j", (name, expected) => {
		const safe = storageFilename(name);
		expect(safe).toBe(expected);
		expect(safe).not.toMatch(/[/\\]/);
	});

	it.each([undefined, null, "", "   ", ".", ".."])("falls back for %j", (name) => {
		expect(storageFilename(name)).toBe("untitled");
	});
});

describe("headerFilename", () => {
	it("cannot break out of the quoted header value", () => {
		const safe = headerFilename('x".txt\r\nSet-Cookie: a=b');
		expect(safe).not.toContain('"');
		expect(safe).not.toContain("\r");
		expect(safe).not.toContain("\n");
	});

	it("keeps an ordinary name", () => {
		expect(headerFilename("report.pdf")).toBe("report.pdf");
	});
});
