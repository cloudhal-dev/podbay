// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * What a message being sent may hold. The sending service takes 25 MiB for the whole message and
 * 50 recipients (docs/cloudflare/ledger.json). The Worker checks both before it stores or sends
 * anything; the app checks them first so the person is told while writing.
 */

/** The sending service's limit for the whole message, attachments included. */
export const MAX_MESSAGE_BYTES = 25 * 1024 * 1024;

/**
 * The attached files of one message, together, as they are on disk. They travel as base64,
 * which is a third larger, so this leaves room for the text and the headers under the limit.
 */
export const MAX_ATTACHMENTS_BYTES = 18 * 1024 * 1024;

/** To, Cc and Bcc together. */
export const MAX_RECIPIENTS = 50;

/** The size of what a base64 string holds, without decoding it. */
export function base64Bytes(content: string): number {
	const padding = content.endsWith("==") ? 2 : content.endsWith("=") ? 1 : 0;
	return Math.floor((content.length * 3) / 4) - padding;
}
