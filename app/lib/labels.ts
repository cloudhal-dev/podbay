// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import type { LABEL_COLOR_COUNT } from "@podbay/mail/shared";
import { m } from "~/i18n";

/**
 * The palette a label's colour is an index into. The classes are written out in full so the
 * stylesheet holds them: a colour is never built from input and never set as an inline style.
 */
export const LABEL_PALETTE = [
	{ name: m("Grey"), dot: "bg-[#8a8f98]" },
	{ name: m("Red"), dot: "bg-[#d9534f]" },
	{ name: m("Orange"), dot: "bg-[#e8833a]" },
	{ name: m("Yellow"), dot: "bg-[#d4a72c]" },
	{ name: m("Green"), dot: "bg-[#3fa66b]" },
	{ name: m("Teal"), dot: "bg-[#2ba3a3]" },
	{ name: m("Blue"), dot: "bg-[#3b82d6]" },
	{ name: m("Purple"), dot: "bg-[#8e6bd8]" },
] as const satisfies readonly { name: string; dot: string }[] & {
	length: typeof LABEL_COLOR_COUNT;
};

/** The class of a label's dot. An index outside the palette is the first colour. */
export function labelDot(color: number): string {
	return (LABEL_PALETTE[color] ?? LABEL_PALETTE[0])?.dot ?? "";
}

/** The search that lists a label's conversations, as a person could type it. */
export function labelSearch(name: string): string {
	return /\s/.test(name) ? `label:"${name}"` : `label:${name}`;
}
