// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { encode } from "uqr";

/**
 * A QR code drawn in the page, from data the browser already has. Nothing is sent anywhere to
 * make it: the text here is an authenticator secret.
 */
export default function QrCode({ text, label }: { text: string; label: string }) {
	const { data, size } = encode(text, { border: 2 });
	let path = "";
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			if (data[y]?.[x]) path += `M${x} ${y}h1v1h-1z`;
		}
	}
	return (
		<svg
			role="img"
			aria-label={label}
			viewBox={`0 0 ${size} ${size}`}
			className="h-44 w-44 rounded-md bg-white"
			shapeRendering="crispEdges"
		>
			<path d={path} fill="#000" />
		</svg>
	);
}
