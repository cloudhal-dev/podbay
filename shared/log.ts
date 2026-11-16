// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * The only module that writes logs (rule S7). A log line is one JSON object with a level, an
 * event name and a few fields. It never carries mail: no body, no subject, no address. Callers
 * pass opaque ids; anything that looks like an address in a string field is masked here as well,
 * because error messages from libraries can quote one.
 */

export type LogValue = string | number | boolean | null | undefined;
export type LogFields = Record<string, LogValue>;
export type LogLevel = "info" | "warn" | "error";

const MAX_STRING = 500;
const ADDRESS = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;

/** A string with addresses masked and its length capped. */
export function redact(value: string): string {
	const masked = value.replace(ADDRESS, "<address>");
	return masked.length > MAX_STRING ? `${masked.slice(0, MAX_STRING)}…` : masked;
}

/** The line that is written: stable key order, strings redacted, undefined fields dropped. */
export function logLine(level: LogLevel, event: string, fields: LogFields = {}): string {
	const line: Record<string, LogValue> = { level, event };
	for (const [key, value] of Object.entries(fields)) {
		if (value === undefined || key === "level" || key === "event") continue;
		line[key] = typeof value === "string" ? redact(value) : value;
	}
	return JSON.stringify(line);
}

/** What is safe to log about a caught value: its name and its (redacted) message. */
export function errorFields(error: unknown): LogFields {
	if (error instanceof Error) return { error: error.name, message: error.message };
	return { error: "non-error", message: String(error) };
}

export const log = {
	info(event: string, fields?: LogFields): void {
		// biome-ignore lint/suspicious/noConsole: the log module is where logs are written
		console.log(logLine("info", event, fields));
	},
	warn(event: string, fields?: LogFields): void {
		// biome-ignore lint/suspicious/noConsole: the log module is where logs are written
		console.warn(logLine("warn", event, fields));
	},
	error(event: string, fields?: LogFields): void {
		// biome-ignore lint/suspicious/noConsole: the log module is where logs are written
		console.error(logLine("error", event, fields));
	},
};
