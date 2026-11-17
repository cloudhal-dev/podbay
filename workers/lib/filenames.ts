// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * File names from mail are attacker-controlled. These helpers are the only place that decides
 * which characters of a name may reach a storage key or a response header.
 */

const STORAGE_FORBIDDEN = new Set(["/", "\\", ":", "*", "?", '"', "<", ">", "|"]);
const HEADER_FORBIDDEN = new Set(['"', "\\"]);

function replaceUnsafe(name: string, forbidden: ReadonlySet<string>): string {
	let out = "";
	for (const char of name) {
		const code = char.codePointAt(0) ?? 0;
		// C0 controls and DEL never survive, whatever the target is.
		out += code < 0x20 || code === 0x7f || forbidden.has(char) ? "_" : char;
	}
	return out;
}

/**
 * A name that is safe as the last segment of an R2 key: no path separators, no control
 * characters, never empty and never a dot segment.
 */
export function storageFilename(name: string | null | undefined): string {
	const cleaned = shortened(replaceUnsafe(name ?? "", STORAGE_FORBIDDEN).trim());
	if (cleaned === "" || cleaned === "." || cleaned === "..") return "untitled";
	return cleaned;
}

/**
 * A storage key holds 1,024 bytes and the name is its last part. A longer name would make the
 * write fail, and with it the delivery of the message that carries the file. So a name keeps
 * this many bytes at most: its beginning, and its extension when it has an ordinary one.
 */
export const STORAGE_NAME_BYTES = 255;
const LONGEST_EXTENSION = 16;
const encoder = new TextEncoder();

function shortened(name: string): string {
	if (encoder.encode(name).length <= STORAGE_NAME_BYTES) return name;
	const dot = name.lastIndexOf(".");
	const extension = dot > 0 && name.length - dot <= LONGEST_EXTENSION ? name.slice(dot) : "";
	let room = STORAGE_NAME_BYTES - encoder.encode(extension).length;
	let kept = "";
	// Whole characters only: a name is never cut inside one.
	for (const char of name.slice(0, name.length - extension.length)) {
		room -= encoder.encode(char).length;
		if (room < 0) break;
		kept += char;
	}
	return `${kept.trimEnd()}${extension}`;
}

/** A name that is safe inside the quoted `filename="..."` of a Content-Disposition header. */
export function headerFilename(name: string): string {
	return replaceUnsafe(name, HEADER_FORBIDDEN);
}
