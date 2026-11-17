// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * What a session calls the browser it came from, in two plain words. A user agent is text
 * the browser chose; it is read to help a person recognise their own sessions, never to
 * decide anything.
 */
export interface Device {
	/** The browser's name, or `null` when the text names none this knows. */
	browser: string | null;
	/** The system's name, or `null`. */
	system: string | null;
}

/** Order matters: most browsers also name the ones they descend from. */
const BROWSERS: readonly (readonly [RegExp, string])[] = [
	[/\bEdg(?:e|A|iOS)?\//, "Edge"],
	[/\b(?:OPR|Opera)\//, "Opera"],
	[/\b(?:Firefox|FxiOS)\//, "Firefox"],
	[/\b(?:Chrome|CriOS|Chromium)\//, "Chrome"],
	[/\bSafari\//, "Safari"],
];
const SYSTEMS: readonly (readonly [RegExp, string])[] = [
	[/\b(?:iPhone|iPod)\b/, "iPhone"],
	[/\biPad\b/, "iPad"],
	[/\bAndroid\b/, "Android"],
	[/\bWindows\b/, "Windows"],
	[/\bCrOS\b/, "ChromeOS"],
	[/\bMac OS X\b|\bMacintosh\b/, "macOS"],
	[/\bLinux\b|\bX11\b/, "Linux"],
];

export function deviceOf(userAgent: string | null | undefined): Device {
	const text = userAgent ?? "";
	return {
		browser: BROWSERS.find(([pattern]) => pattern.test(text))?.[1] ?? null,
		system: SYSTEMS.find(([pattern]) => pattern.test(text))?.[1] ?? null,
	};
}
