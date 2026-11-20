// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * The pure parts of keeping and showing an original (ADR-0015): the key an original is stored
 * under, the text its first bytes become, and what is taken from the platform's
 * `Authentication-Results` field. Nothing here touches a binding.
 */
import {
	AUTHENTICATION_METHODS,
	type Authentication,
	type AuthenticationMethod,
	type OriginalAnswer,
} from "../../shared/original";

/** The shape of an original's key: `raw/` and 32 lower-case hexadecimal characters. */
export const RAW_KEY = /^raw\/[0-9a-f]{32}$/;

/**
 * A key for a new original, made from 16 random bytes. It is not the message's id and says
 * nothing of the mailbox, the sender or the time. It is written whole into the row and read
 * from the row; no code builds the key of an original from anything (decision 2).
 */
export function newRawKey(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(16));
	return `raw/${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

// ── The platform's statement about SPF, DKIM and DMARC (decisions 18 and 19) ──

/** The identifier Email Routing writes into its own field (docs/cloudflare/ledger.json). */
export const PLATFORM_IDENTIFIER = "mx.cloudflare.net";
/** The stored field is cut to this many characters. */
export const AUTH_RESULTS_MAX = 2048;

/**
 * For each character of a header value, whether it stands outside every quoted string and
 * every comment (RFC 5322: `"…"` with `\` escapes, `(…)` nested). `unclosedFrom` is where a
 * quoted string or a comment begins that never closes: nothing from there on can be told apart.
 */
function scanPlain(value: string): { mask: boolean[]; unclosedFrom: number | null } {
	const mask: boolean[] = [];
	let quoted = false;
	let depth = 0;
	let opened = 0;
	for (let at = 0; at < value.length; at++) {
		const char = value[at];
		if ((quoted || depth > 0) && char === "\\") {
			mask.push(false, false);
			at += 1;
			continue;
		}
		if (quoted) {
			mask.push(false);
			if (char === '"') quoted = false;
		} else if (depth > 0) {
			mask.push(false);
			if (char === "(") depth += 1;
			else if (char === ")") depth -= 1;
		} else if (char === '"' || char === "(") {
			mask.push(false);
			opened = at;
			if (char === '"') quoted = true;
			else depth = 1;
		} else mask.push(true);
	}
	return { mask: mask.slice(0, value.length), unclosedFrom: quoted || depth > 0 ? opened : null };
}

/** The parts of a value between the separators that stand outside quoted strings and comments. */
function splitPlain(value: string, mask: readonly boolean[], separator: string): string[] {
	const parts: string[] = [];
	let from = 0;
	for (let at = 0; at < value.length; at++) {
		if (value[at] === separator && mask[at]) {
			parts.push(value.slice(from, at));
			from = at + 1;
		}
	}
	parts.push(value.slice(from));
	return parts;
}

/** A part of a field with its comments taken out and its edges trimmed. */
function withoutComments(part: string): string {
	let out = "";
	let quoted = false;
	let depth = 0;
	for (let at = 0; at < part.length; at++) {
		const char = part[at] ?? "";
		if ((quoted || depth > 0) && char === "\\") {
			if (quoted) out += char + (part[at + 1] ?? "");
			at += 1;
		} else if (quoted) {
			out += char;
			if (char === '"') quoted = false;
		} else if (depth > 0) {
			if (char === "(") depth += 1;
			else if (char === ")") depth -= 1;
			if (depth === 0) out += " ";
		} else if (char === "(") depth = 1;
		else {
			out += char;
			if (char === '"') quoted = true;
		}
	}
	return out.trim();
}

/**
 * The first `Authentication-Results` field of a message, when it is the platform's.
 *
 * The platform puts its own field in front of the message; any other field of that name may
 * be the sender's. Its page does not say how `headers` gives a field that occurs more than
 * once, so the value is cut at the first comma outside a quoted string or a comment, which
 * the field's grammar never has. When that cannot be told (a quoted string or a comment that
 * never closes), or the identifier is not exactly the platform's, nothing is kept.
 */
export function platformStatement(headers: Headers | undefined): string | null {
	const value = headers?.get("authentication-results") ?? null;
	if (value === null) return null;
	const whole = scanPlain(value);
	if (whole.unclosedFrom !== null) return null;
	const first = (splitPlain(value, whole.mask, ",")[0] ?? "").trim();
	// The identifier is what stands before the first semicolon, with an optional version.
	const identifier = withoutComments(splitPlain(first, scanPlain(first).mask, ";")[0] ?? "").split(
		/\s+/,
	);
	if (identifier[0] !== PLATFORM_IDENTIFIER) return null;
	if (identifier.length > 2 || (identifier.length === 2 && !/^\d+$/.test(identifier[1] ?? ""))) {
		return null;
	}
	return first.slice(0, AUTH_RESULTS_MAX);
}

const RESULT = /^(\S+?)\s*=\s*([a-z]+)(?=\s|$)/;

/**
 * What a stored field says, for the answer of "Show original": the identifier and each result
 * written for `spf`, `dkim` and `dmarc`, in the field's order, when the result is a plain
 * lower-case word. `null` when nothing was kept. Nothing is judged here.
 */
export function authenticationOf(stored: string | null | undefined): Authentication | null {
	if (stored === null || stored === undefined || stored === "") return null;
	// A stored field that was cut inside a quoted string is read up to where that string begins.
	const cut = scanPlain(stored).unclosedFrom;
	const field = cut === null ? stored : stored.slice(0, cut);
	const parts = splitPlain(field, scanPlain(field).mask, ";");
	const identifier = withoutComments(parts[0] ?? "").split(/\s+/)[0] ?? "";
	if (identifier !== PLATFORM_IDENTIFIER) return null;
	const results: Authentication["results"] = [];
	for (const part of parts.slice(1)) {
		const found = RESULT.exec(withoutComments(part));
		if (found === null) continue;
		const method = found[1] as AuthenticationMethod;
		if (!AUTHENTICATION_METHODS.includes(method)) continue;
		results.push({ method, result: found[2] ?? "" });
	}
	return { identifier, results };
}

// ── The first bytes of an original as text (decision 14) ──

/**
 * Where the last whole UTF-8 character of a cut ends: a sequence that the cut went through is
 * left out, so a character is never shown as broken only because the answer stops there.
 */
function wholeCharacters(bytes: Uint8Array): number {
	for (let back = 1; back <= 3 && back <= bytes.length; back++) {
		const byte = bytes[bytes.length - back] ?? 0;
		if (byte < 0x80) return bytes.length;
		if (byte >= 0xc0) {
			const needs = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : 2;
			return needs > back ? bytes.length - back : bytes.length;
		}
	}
	return bytes.length;
}

/** The lines up to the first empty one, and what follows it. */
export function splitOriginal(text: string): { header: string; rest: string } {
	const lead = /^\r?\n/.exec(text);
	if (lead !== null) return { header: "", rest: text.slice(lead[0].length) };
	const gap = /\r?\n\r?\n/.exec(text);
	if (gap === null) return { header: text, rest: "" };
	return { header: text.slice(0, gap.index), rest: text.slice(gap.index + gap[0].length) };
}

/**
 * The answer of "Show original" from the first bytes of the object. The bytes become text as
 * JMAP's raw form does: UTF-8, U+FFFD for what is not, NUL dropped. `authentication` is in
 * the answer only when `withAuthentication` says so (`AUTHENTICATION_SHOWN`).
 */
export function originalAnswer(
	bytes: Uint8Array,
	size: number,
	authResults: string | null | undefined,
	withAuthentication: boolean,
): OriginalAnswer {
	const shown = bytes.length < size ? wholeCharacters(bytes) : bytes.length;
	const text = new TextDecoder("utf-8", { fatal: false, ignoreBOM: true })
		.decode(bytes.subarray(0, shown))
		.replaceAll("\u0000", "");
	return {
		size,
		shown,
		...splitOriginal(text),
		...(withAuthentication ? { authentication: authenticationOf(authResults) } : {}),
	};
}
