// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * The original of a received message in the app (ADR-0015, decisions 14 to 16): how much of
 * it is shown, and saving the whole of it. How it is drawn is in `./original-text.ts`.
 */
import { ORIGINAL_SHOWN_BYTES, type OriginalAnswer, originalFileName } from "shared/original";
import { t } from "~/i18n";
import { saveBlob } from "~/lib/attachments";
import { formatBytes } from "~/lib/utils";
import { ApiError } from "~/services/api";
import type { Email } from "~/types";

/** How much of the original the screen shows, in words. */
export function originalExtent(answer: Pick<OriginalAnswer, "size" | "shown">): string {
	return answer.shown < answer.size
		? t("The first {shown} of {size}. Download the message to have all of it.", {
				shown: formatBytes(ORIGINAL_SHOWN_BYTES, 0),
				size: formatBytes(answer.size),
			})
		: t("The whole message as it arrived: {size}.", { size: formatBytes(answer.size) });
}

/**
 * Saves the original of a message as a file. The request is a POST from the app's own page
 * that says the reader asked for it, which is what the Worker hands the bytes over to; a link
 * cannot make it. The name is the one Podbay makes: nothing of the subject or the sender.
 */
export async function downloadOriginal(
	mailboxId: string,
	email: Pick<Email, "id" | "date">,
): Promise<void> {
	const res = await fetch(
		`/api/v1/mailboxes/${encodeURIComponent(mailboxId)}/emails/${encodeURIComponent(email.id)}/original/download`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ acknowledged: true }),
		},
	);
	if (!res.ok) {
		const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
		throw new ApiError(res.status, body);
	}
	saveBlob(await res.blob(), originalFileName(email.date, email.id));
}
