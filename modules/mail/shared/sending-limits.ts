// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * What a message being sent may hold. The sending service takes 25 MiB for the whole message,
 * 32 files and 50 recipients (docs/cloudflare/ledger.json). The files of a message are the
 * files of its draft, so the Worker holds a draft to these limits when a file is declared
 * (ADR-0011) and asks them again when the message is sent; the app says so while writing.
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

/** A file's name, in bytes, and its declared type, in characters (ADR-0011). */
export const MAX_FILENAME_BYTES = 255;
export const MAX_FILE_TYPE_CHARS = 255;

/**
 * Files copied into a draft by one request (a forward). Each is a read and a write to the
 * bucket, and a request on the Free plan makes 50 calls at most.
 */
export const MAX_COPIED_AT_ONCE = 16;

/** To, Cc and Bcc together. */
export const MAX_RECIPIENTS = 50;

/**
 * What the text of a message weighs on its way to the sending service, in both its forms.
 * Its files are counted beside it, as the base64 they travel as (`workers/lib/outgoing.ts`).
 */
export function messageBytes(message: { html?: string; text?: string }): number {
	const encoder = new TextEncoder();
	return encoder.encode(message.html ?? "").length + encoder.encode(message.text ?? "").length;
}
