import { describe, expect, it } from "vitest";
import {
	headerFilename,
	STORAGE_NAME_BYTES,
	storageFilename,
} from "../../modules/mail/worker/lib/filenames.ts";

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

	it("cuts a name that a storage key could not hold, and keeps its extension", () => {
		const bytes = (text: string) => new TextEncoder().encode(text).length;
		const long = storageFilename(`${"a".repeat(5000)}.pdf`);
		expect(bytes(long)).toBe(STORAGE_NAME_BYTES);
		expect(long.endsWith(".pdf")).toBe(true);
		expect(long.startsWith("aaaa")).toBe(true);

		// Never inside a character, whatever its width.
		const wide = storageFilename(`${"ş".repeat(400)}.docx`);
		expect(bytes(wide)).toBeLessThanOrEqual(STORAGE_NAME_BYTES);
		expect(wide).toMatch(/^ş+\.docx$/);
		const emoji = storageFilename("📎".repeat(300));
		expect(bytes(emoji)).toBeLessThanOrEqual(STORAGE_NAME_BYTES);
		expect([...emoji].every((char) => char === "📎")).toBe(true);

		// A name without an ordinary extension is cut all the same, and a short one is left alone.
		expect(bytes(storageFilename(`a.${"b".repeat(3000)}`))).toBe(STORAGE_NAME_BYTES);
		const exact = `${"a".repeat(STORAGE_NAME_BYTES - 4)}.txt`;
		expect(storageFilename(exact)).toBe(exact);
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
