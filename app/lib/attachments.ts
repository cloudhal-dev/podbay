// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { servedContentType } from "@podbay/mail/shared";
/**
 * Attachments in the app (rule S5): downloading one the reader has acknowledged, and showing
 * the images a message embeds.
 */
import { useQuery } from "@tanstack/react-query";
import { ApiError } from "~/services/api";
import type { Attachment } from "~/types";
import {
	contentId,
	embedInlineImages,
	inlineImages,
	MAX_INLINE_IMAGE_BYTES,
} from "./inline-images";

export function attachmentUrl(mailboxId: string, emailId: string, attachmentId: string): string {
	return `/api/v1/mailboxes/${encodeURIComponent(mailboxId)}/emails/${encodeURIComponent(emailId)}/attachments/${encodeURIComponent(attachmentId)}`;
}

/** Hands bytes the app holds to the browser as a file to save, under a name the app gives. */
export function saveBlob(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = filename;
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
	setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/**
 * Download an attachment the reader said they want. The request is a POST from the app's own
 * page, which is the acknowledgement the Worker asks for; a link cannot make it.
 */
export async function downloadAcknowledged(
	mailboxId: string,
	emailId: string,
	attachment: Pick<Attachment, "id" | "filename">,
): Promise<void> {
	const res = await fetch(`${attachmentUrl(mailboxId, emailId, attachment.id)}/download`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ acknowledged: true }),
	});
	if (!res.ok) {
		const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
		throw new ApiError(res.status, body);
	}
	saveBlob(await res.blob(), attachment.filename);
}

function base64(bytes: Uint8Array): string {
	let binary = "";
	for (let i = 0; i < bytes.length; i += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	}
	return btoa(binary);
}

async function loadInlineImages(
	mailboxId: string,
	emailId: string,
	attachments: readonly Attachment[],
): Promise<Map<string, string>> {
	const images = new Map<string, string>();
	await Promise.all(
		attachments.map(async (attachment) => {
			const res = await fetch(attachmentUrl(mailboxId, emailId, attachment.id));
			if (!res.ok) return;
			const bytes = new Uint8Array(await res.arrayBuffer());
			if (bytes.length > MAX_INLINE_IMAGE_BYTES) return;
			// The type is one of the app's own short list, never the sender's text.
			const type = servedContentType(attachment.mimetype);
			images.set(contentId(attachment.content_id ?? ""), `data:${type};base64,${base64(bytes)}`);
		}),
	);
	return images;
}

/** A message body with its embedded images in place. The plain body until they have loaded. */
export function useBodyWithInlineImages(
	body: string,
	mailboxId: string | undefined,
	emailId: string,
	attachments: readonly Attachment[] | undefined,
): string {
	const wanted = inlineImages(attachments);
	const { data } = useQuery({
		queryKey: ["inline-images", mailboxId, emailId, wanted.map((a) => a.id).join(",")],
		queryFn: () => loadInlineImages(mailboxId ?? "", emailId, wanted),
		enabled: mailboxId !== undefined && wanted.length > 0,
		staleTime: Number.POSITIVE_INFINITY,
		gcTime: 5 * 60_000,
		retry: false,
	});
	return data ? embedInlineImages(body, data) : body;
}
