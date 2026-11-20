// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * The images a message embeds (`cid:` references). Pure functions: which attachments count, and
 * putting them into the body. Loading them is in `attachments.ts`.
 */
import { isShowableImage } from "@podbay/mail/shared";

/** What these functions need to know about an attachment. */
export interface EmbeddedPart {
	readonly id: string;
	readonly mimetype: string;
	readonly size: number;
	readonly content_id?: string;
	readonly disposition?: string;
}

/** One embedded image may be this large, and all of a message's together four times that. */
export const MAX_INLINE_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_INLINE_TOTAL_BYTES = 4 * MAX_INLINE_IMAGE_BYTES;

/** The attachments a message embeds that the app may show: images of a plain kind, not too large. */
export function inlineImages<T extends EmbeddedPart>(attachments: readonly T[] | undefined): T[] {
	let total = 0;
	const out: T[] = [];
	for (const attachment of attachments ?? []) {
		if (attachment.disposition !== "inline" || !attachment.content_id) continue;
		if (!isShowableImage(attachment.mimetype)) continue;
		if (attachment.size > MAX_INLINE_IMAGE_BYTES) continue;
		if (total + attachment.size > MAX_INLINE_TOTAL_BYTES) continue;
		total += attachment.size;
		out.push(attachment);
	}
	return out;
}

/** `<abc@host>` and `abc@host` name the same embedded part. */
export function contentId(raw: string): string {
	return raw.replace(/^<|>$/g, "");
}

/**
 * Replace the `cid:` references of a message body with the images themselves, as `data:` URLs.
 * The mail frame loads nothing from the network, not even from Podbay; an embedded image
 * reaches it as part of the document. A reference with no image in `images` is left alone.
 */
export function embedInlineImages(body: string, images: ReadonlyMap<string, string>): string {
	let result = body;
	for (const [cid, dataUrl] of images) {
		const escaped = cid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		result = result.replace(new RegExp(`cid:${escaped}`, "gi"), () => dataUrl);
	}
	return result;
}
