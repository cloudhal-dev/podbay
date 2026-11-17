// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { createElement, Fragment, type ReactNode } from "react";
import { t } from "./index";

/**
 * A message with elements inside it: `rich("You were invited as {email}.", { email: <b>…</b> })`.
 * The sentence stays one message, so a language can put the element where its grammar wants it.
 */
export function rich(text: string, parts: Readonly<Record<string, ReactNode>>): ReactNode {
	const pieces = t(text).split(/\{(\w+)\}/);
	return pieces.map((piece, index) => {
		// The split puts the names at the odd places.
		const node = index % 2 === 1 ? (parts[piece] ?? `{${piece}}`) : piece;
		// The pieces of one sentence never move, so their place is their key.
		return createElement(Fragment, { key: index }, node);
	});
}
