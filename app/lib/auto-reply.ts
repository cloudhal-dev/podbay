// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import type { AutoReply } from "@podbay/mail/shared";
/**
 * What the settings screen of the automatic reply shows and what it saves (ADR-0008).
 *
 * The screen shows words. A reply can also be saved with an HTML body, through the API, and
 * that markup is what would leave; the screen does not show it. So the screen never saves it
 * back: whoever presses Save becomes the person on whose standing the reply leaves, and they
 * are made that only for what they saw. A reply with HTML is saved here as its words.
 */
import { plainTextOf } from "@podbay/mail/shared";

/**
 * The words the screen shows: the text of the reply, or the text of its HTML when it has only
 * HTML. The server keeps the two in agreement.
 */
export const shownText = (reply: Pick<AutoReply, "textBody" | "htmlBody">): string =>
	reply.textBody ?? (reply.htmlBody === null ? "" : plainTextOf(reply.htmlBody));

/** What the person filled in on the screen. Dates are instants in UTC, or `null` for none. */
export interface AutoReplyForm {
	enabled: boolean;
	fromDate: string | null;
	toDate: string | null;
	subject: string;
	text: string;
}

/** The reply the screen saves: what it shows, and never a body it does not show. */
export function replyToSave(form: AutoReplyForm): AutoReply {
	return {
		isEnabled: form.enabled,
		fromDate: form.fromDate,
		toDate: form.toDate,
		subject: form.subject.trim() === "" ? null : form.subject.trim(),
		textBody: form.text.trim() === "" ? null : form.text,
		htmlBody: null,
	};
}
