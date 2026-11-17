// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * The original of a received message as it is drawn (ADR-0015, decisions 17 and 18).
 *
 * The original is every byte a stranger sent. On the screen it is text and only text: this
 * module turns it into pieces of plain text and marks, and the one component that draws them
 * puts each into a text node. Nothing here makes markup, a link or an address to load.
 */
import type { Authentication } from "shared/original";
import { t } from "../i18n";

/** A run of the original as it is drawn: plain text, or a mark that stands for characters. */
export type OriginalPiece =
	| { text: string }
	| {
			/** What is drawn in place of the character: its code point, as `U+202E`. */
			mark: string;
			/** How many of that character stood there in a row. */
			count: number;
	  };

/**
 * Whether a character is drawn as a mark and never as itself: a control character (a tab and
 * a line feed aside), a character that changes the direction of text, a separator that would
 * break the line, or a character that takes no room at all. Each of them makes a line read
 * otherwise than its bytes stand.
 */
function isMarked(code: number): boolean {
	if (code === 0x09 || code === 0x0a) return false;
	if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return true;
	if (code === 0x061c || code === 0x00ad || code === 0xfeff) return true;
	// Zero-width characters and the marks, embeddings and overrides of direction.
	if (code >= 0x200b && code <= 0x200f) return true;
	// Line and paragraph separators, and more embeddings and overrides.
	if (code >= 0x2028 && code <= 0x202e) return true;
	// The word joiner, invisible operators, isolates and the deprecated format characters.
	return code >= 0x2060 && code <= 0x206f;
}

const label = (code: number): string => `U+${code.toString(16).toUpperCase().padStart(4, "0")}`;

/**
 * The text of an original as pieces to draw. A line ends where the message ends it: CR LF and
 * a bare LF are one line break, and a CR that stands alone is a mark. Every other control
 * character, and every character that changes the direction of text, is a mark with its code
 * point, so a line reads in the order of its bytes (decision 17).
 */
export function markOriginal(text: string): OriginalPiece[] {
	const pieces: OriginalPiece[] = [];
	let plain = "";
	const flush = () => {
		if (plain !== "") pieces.push({ text: plain });
		plain = "";
	};
	const characters = Array.from(text.replaceAll("\r\n", "\n"));
	for (const character of characters) {
		const code = character.codePointAt(0) ?? 0;
		if (!isMarked(code)) {
			plain += character;
			continue;
		}
		flush();
		const mark = label(code);
		const last = pieces[pieces.length - 1];
		if (last !== undefined && "mark" in last && last.mark === mark) last.count += 1;
		else pieces.push({ mark, count: 1 });
	}
	flush();
	return pieces;
}

/**
 * What the platform recorded about SPF, DKIM and DMARC, as a sentence (decision 18). It is the
 * platform's statement and is said as that: no tick, no colour, no word of Podbay's own about
 * the results, and nothing about who wrote the message. The results are the platform's words
 * and are written as it wrote them.
 */
export function authenticationWords(authentication: Authentication | null): string {
	if (authentication === null) {
		return t("Nothing was recorded about SPF, DKIM or DMARC when this message arrived.");
	}
	if (authentication.results.length === 0) {
		return t(
			"Cloudflare Email Routing recorded no result for SPF, DKIM or DMARC when this message arrived. Podbay did not check them itself.",
		);
	}
	return t(
		"Cloudflare Email Routing recorded these results when this message arrived: {results}. Podbay did not check them itself.",
		{ results: authentication.results.map((one) => `${one.method}=${one.result}`).join(", ") },
	);
}
