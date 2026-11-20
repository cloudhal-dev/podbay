/**
 * Which attachments can do harm when opened, and what type a file leaves the Worker with
 * (rule S5). The routes that enforce it are tested in test/workerd/attachments.test.ts.
 */
import { describe, expect, it } from "vitest";
import {
	attachmentRisk,
	isShowableImage,
	servedContentType,
} from "../../modules/mail/shared/attachment-risk.ts";

const kind = (filename: string, mimetype = "application/octet-stream") =>
	attachmentRisk({ filename, mimetype })?.kind ?? null;

describe("attachmentRisk", () => {
	it.each([
		["setup.exe", "program"],
		["Invoice.PDF.EXE", "program"],
		["tool.msi", "program"],
		["game.apk", "program"],
		["library.jar", "program"],
		["run.bat", "script"],
		["deploy.ps1", "script"],
		["macro.vbs", "script"],
		["page.js", "script"],
		["install.sh", "script"],
		["report.docm", "macro"],
		["budget.xlsm", "macro"],
		["slides.pptm", "macro"],
		["invoice.html", "active"],
		["logo.svg", "active"],
		["feed.xml", "active"],
		["archive.mht", "active"],
		["Document.lnk", "shortcut"],
		["site.url", "shortcut"],
		["settings.reg", "shortcut"],
		["photos.zip", "container"],
		["backup.7z", "container"],
		["disk.iso", "container"],
		["App.dmg", "container"],
	])("%s is a %s", (filename, expected) => {
		expect(kind(filename)).toBe(expected);
	});

	it.each([
		"report.pdf",
		"photo.jpg",
		"notes.txt",
		"sheet.xlsx",
		"letter.docx",
		"slides.pptx",
		"data.csv",
		"song.mp3",
		"README",
		"",
	])("%s is not flagged", (filename) => {
		expect(kind(filename)).toBeNull();
	});

	it("goes by the last extension, also behind trailing dots and spaces", () => {
		expect(kind("holiday.jpg.exe")).toBe("program");
		expect(kind("holiday.exe.jpg")).toBeNull();
		expect(kind("setup.exe. ")).toBe("program");
		expect(kind("setup.exe...")).toBe("program");
		expect(kind(".exe")).toBeNull();
	});

	it("flags a name with invisible characters that change how it reads", () => {
		// With a right-to-left override this displays as "invoice-exe.pdf".
		expect(kind("invoice-‮fdp.exe")).toBe("deceptive");
		expect(kind("report​.pdf")).toBe("deceptive");
		expect(kind("report.pdf")).toBeNull();
	});

	it("goes by the type when the name hides what the file is", () => {
		expect(kind("invoice", "text/html; charset=utf-8")).toBe("active");
		expect(kind("picture.png", "image/svg+xml")).toBe("active");
		expect(kind("download", "application/x-msdownload")).toBe("program");
		expect(kind("notes.txt", "application/javascript")).toBe("script");
		expect(kind("files", "application/zip")).toBe("container");
		expect(kind("sheet", "application/vnd.ms-excel.sheet.macroEnabled.12")).toBe("macro");
	});

	it("gives the reader a reason in plain words", () => {
		const risk = attachmentRisk({ filename: "setup.exe", mimetype: "" });
		expect(risk?.reason).toMatch(/program/i);
		expect(attachmentRisk({ filename: null, mimetype: null })).toBeNull();
	});
});

describe("servedContentType", () => {
	it("passes on a short list of types that cannot run anything", () => {
		expect(servedContentType("image/png")).toBe("image/png");
		expect(servedContentType("IMAGE/JPEG")).toBe("image/jpeg");
		expect(servedContentType("application/pdf")).toBe("application/pdf");
		expect(servedContentType("text/plain; charset=iso-8859-1")).toBe("text/plain; charset=utf-8");
	});

	it.each([
		"text/html",
		"image/svg+xml",
		"application/xhtml+xml",
		"text/javascript",
		"application/xml",
		"text/css",
		"application/x-msdownload",
		"made/up",
		"",
	])("never passes on %s", (declared) => {
		expect(servedContentType(declared)).toBe("application/octet-stream");
	});

	it("takes no parameter from the sender's type", () => {
		expect(servedContentType('image/png; name="x.html"')).toBe("image/png");
		expect(servedContentType(null)).toBe("application/octet-stream");
	});
});

describe("isShowableImage", () => {
	it("is for plain image kinds, never for one that can carry script", () => {
		expect(isShowableImage("image/png")).toBe(true);
		expect(isShowableImage("image/webp")).toBe(true);
		expect(isShowableImage("image/svg+xml")).toBe(false);
		expect(isShowableImage("application/pdf")).toBe(false);
		expect(isShowableImage("text/html")).toBe(false);
		expect(isShowableImage(undefined)).toBe(false);
	});
});
