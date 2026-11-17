// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * What a message being sent may hold. The sending service takes 25 MiB for the whole message,
 * 32 files and 50 recipients (docs/cloudflare/ledger.json). The Worker checks both before it stores or sends
 * anything; the app checks them first so the person is told while writing.
 */

/** The sending service's limit for the whole message, attachments included. */
export const MAX_MESSAGE_BYTES = 25 * 1024 * 1024;

/**
 * The attached files of one message, together, as they are on disk. They travel as base64,
 * which is a third larger, so this leaves room for the text and the headers under the limit.
 */
export const MAX_ATTACHMENTS_BYTES = 18 * 1024 * 1024;

/** The files of one message, by count: the sending service takes no more. */
export const MAX_ATTACHMENTS = 32;

/** To, Cc and Bcc together. */
export const MAX_RECIPIENTS = 50;

/**
 * What a message weighs on its way to the sending service, near enough to refuse one that
 * cannot go: its text in both forms, and its files as the base64 they travel as.
 */
export function messageBytes(message: {
	html?: string;
	text?: string;
	attachments?: readonly { content: string }[];
}): number {
	const encoder = new TextEncoder();
	const text =
		encoder.encode(message.html ?? "").length + encoder.encode(message.text ?? "").length;
	return (message.attachments ?? []).reduce((sum, file) => sum + file.content.length, text);
}

/** The size of what a base64 string holds, without decoding it. */
export function base64Bytes(content: string): number {
	const padding = content.endsWith("==") ? 2 : content.endsWith("=") ? 1 : 0;
	return Math.floor((content.length * 3) / 4) - padding;
}
