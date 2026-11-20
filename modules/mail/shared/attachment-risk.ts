// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Which attachments can do harm when opened (rule S5), in one place: the app shows the warning
 * and the Worker enforces it. A risky attachment is not handed over by a plain link; the reader
 * has to say they want it.
 *
 * The file name and the type are written by the sender, so this never decides that a file is
 * safe. It only names the kinds that are dangerous by design: programs, scripts, documents
 * that carry macros, files a browser runs, and containers that hide any of those.
 */

export type AttachmentRiskKind =
	| "program"
	| "script"
	| "macro"
	| "active"
	| "shortcut"
	| "container"
	| "deceptive";

export interface AttachmentRisk {
	readonly kind: AttachmentRiskKind;
	/** One sentence for the reader, in plain words. */
	readonly reason: string;
}

const REASONS: Record<AttachmentRiskKind, string> = {
	program: "This is a program. Opening it runs it on your computer.",
	script: "This is a script. Opening it can run commands on your computer.",
	macro: "This document can contain macros, which are programs that run when it is opened.",
	active: "A browser treats this file as a page and runs what is inside it.",
	shortcut: "This is a shortcut or a settings file. Opening it can start other programs.",
	container: "This is an archive or a disk image. It can hide a program inside.",
	deceptive: "The name of this file is written to look like another kind of file.",
};

const EXTENSIONS: Record<Exclude<AttachmentRiskKind, "deceptive">, readonly string[]> = {
	program: [
		"exe",
		"com",
		"scr",
		"pif",
		"msi",
		"msp",
		"msix",
		"appx",
		"appxbundle",
		"cpl",
		"dll",
		"sys",
		"drv",
		"ocx",
		"jar",
		"apk",
		"ipa",
		"app",
		"pkg",
		"deb",
		"rpm",
		"appimage",
		"run",
		"bin",
		"gadget",
		"xbe",
		"action",
		"workflow",
		"command",
	],
	script: [
		"bat",
		"cmd",
		"ps1",
		"psm1",
		"psd1",
		"vbs",
		"vbe",
		"js",
		"jse",
		"wsf",
		"wsh",
		"hta",
		"sh",
		"bash",
		"zsh",
		"csh",
		"ksh",
		"fish",
		"py",
		"pyc",
		"pyw",
		"rb",
		"pl",
		"php",
		"scpt",
		"applescript",
		"ahk",
		"au3",
		"sct",
		"ws",
	],
	macro: ["docm", "dotm", "xlsm", "xltm", "xlam", "xlsb", "pptm", "potm", "ppam", "ppsm", "sldm"],
	active: [
		"html",
		"htm",
		"xhtml",
		"xht",
		"shtml",
		"mht",
		"mhtml",
		"svg",
		"svgz",
		"xml",
		"xsl",
		"xslt",
	],
	shortcut: [
		"lnk",
		"url",
		"webloc",
		"desktop",
		"inetloc",
		"scf",
		"reg",
		"inf",
		"library-ms",
		"settingcontent-ms",
		"appref-ms",
		"website",
		"terminal",
		"chm",
		"hlp",
		"mobileconfig",
	],
	container: [
		"zip",
		"rar",
		"7z",
		"tar",
		"gz",
		"tgz",
		"bz2",
		"xz",
		"zst",
		"cab",
		"ace",
		"arj",
		"lzh",
		"iso",
		"img",
		"dmg",
		"vhd",
		"vhdx",
		"vmdk",
		"udf",
	],
};

const BY_EXTENSION = new Map<string, Exclude<AttachmentRiskKind, "deceptive">>();
for (const [kind, extensions] of Object.entries(EXTENSIONS)) {
	for (const extension of extensions) {
		BY_EXTENSION.set(extension, kind as Exclude<AttachmentRiskKind, "deceptive">);
	}
}

/** Types that say the same as a risky extension, for a file whose name hides it. */
const BY_TYPE: readonly [RegExp, Exclude<AttachmentRiskKind, "deceptive">][] = [
	[
		/^text\/html\b|^application\/xhtml\+xml\b|^image\/svg\+xml\b|^(?:text|application)\/xml\b/,
		"active",
	],
	[
		/^application\/(?:x-msdownload|x-msdos-program|x-dosexec|vnd\.microsoft\.portable-executable|x-msi|java-archive|vnd\.android\.package-archive|x-executable|x-mach-binary|x-sharedlib)\b/,
		"program",
	],
	[
		/^(?:text|application)\/(?:javascript|x-javascript|ecmascript|x-sh|x-shellscript|x-bat|x-msdos-batch|x-powershell|x-python|vbscript|hta)\b/,
		"script",
	],
	[/macroenabled/, "macro"],
	[
		/^application\/(?:zip|x-zip-compressed|x-rar-compressed|vnd\.rar|x-7z-compressed|x-tar|gzip|x-gzip|x-bzip2|x-xz|zstd|x-iso9660-image|x-apple-diskimage|vnd\.ms-cab-compressed)\b/,
		"container",
	],
];

/**
 * Characters that change how a name is displayed without being visible: text-direction marks
 * (the right-to-left override turns "gpj.exe" into what reads as "exe.jpg") and zero-width ones.
 */
const INVISIBLE = /[​-‏‪-‮⁦-⁩﻿]/;

function lastExtension(filename: string): string {
	// Trailing dots and spaces are dropped by some systems, which then use the part before them.
	const name = filename.trim().replace(/[. ]+$/, "");
	const dot = name.lastIndexOf(".");
	return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
}

/** The risk of an attachment, or null when it is not one of the kinds dangerous by design. */
export function attachmentRisk(attachment: {
	readonly filename?: string | null;
	readonly mimetype?: string | null;
}): AttachmentRisk | null {
	const filename = attachment.filename ?? "";
	const risk = (kind: AttachmentRiskKind): AttachmentRisk => ({ kind, reason: REASONS[kind] });
	if (INVISIBLE.test(filename)) return risk("deceptive");
	const byName = BY_EXTENSION.get(lastExtension(filename));
	if (byName !== undefined) return risk(byName);
	const type = (attachment.mimetype ?? "").trim().toLowerCase();
	for (const [pattern, kind] of BY_TYPE) if (pattern.test(type)) return risk(kind);
	return null;
}

/**
 * The types an attachment is served as. Everything else leaves as `application/octet-stream`:
 * the sender's own word for the type is never passed on, and with `nosniff` a browser does not
 * guess. These few cannot run anything, and the app shows the images among them.
 */
const SERVED_AS_IS: ReadonlySet<string> = new Set([
	"image/png",
	"image/jpeg",
	"image/gif",
	"image/webp",
	"image/avif",
	"image/bmp",
	"application/pdf",
	"text/plain",
]);

export function servedContentType(declared: string | null | undefined): string {
	const type = (declared ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
	if (type === "text/plain") return "text/plain; charset=utf-8";
	return SERVED_AS_IS.has(type) ? type : "application/octet-stream";
}

/** Image types the app may show, in a preview or inline in a message. Never SVG. */
export function isShowableImage(mimetype: string | null | undefined): boolean {
	const type = (mimetype ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
	return type.startsWith("image/") && SERVED_AS_IS.has(type);
}

/** The code of the answer that asks for an acknowledgement, and the field that gives it. */
export const NEEDS_ACKNOWLEDGEMENT_CODE = "ATTACHMENT_NEEDS_ACKNOWLEDGEMENT";
