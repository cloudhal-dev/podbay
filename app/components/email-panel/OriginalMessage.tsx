// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { LayerDialog, Loader } from "@cloudflare/kumo";
import { attachmentRisk, NO_ORIGINAL_CODE, ORIGINAL_MISSING_CODE } from "@podbay/mail/shared";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { t } from "~/i18n";
import { downloadOriginal, originalExtent } from "~/lib/original";
import { authenticationWords, markOriginal } from "~/lib/original-text";
import { queryKeys } from "~/queries/keys";
import api, { ApiError } from "~/services/api";
import type { Email } from "~/types";

/**
 * A part of an original on the screen (ADR-0015, decision 17). It is text and only text: each
 * piece goes into a text node of one preformatted block. It is never HTML, never in the mail
 * frame, and nothing in it becomes a link. A control character, and a character that changes
 * the direction of text, is drawn as a mark with its code point; the block itself is laid out
 * left to right whatever it holds, so a line reads in the order of its bytes.
 */
function OriginalText({ text, heading }: { text: string; heading: string }) {
	return (
		<section>
			<h3 className="mb-1 text-xs font-medium text-kumo-subtle">{heading}</h3>
			<pre
				dir="ltr"
				className="m-0 whitespace-pre-wrap break-all rounded-lg border border-kumo-line bg-kumo-recessed/40 p-3 font-mono text-xs leading-5 text-kumo-default [unicode-bidi:bidi-override]"
			>
				{markOriginal(text).map((piece, index) =>
					"text" in piece ? (
						piece.text
					) : (
						<span
							// biome-ignore lint/suspicious/noArrayIndexKey: the pieces of one text never move
							key={index}
							className="mx-px rounded-sm border border-kumo-line bg-kumo-fill px-0.5 text-kumo-danger"
						>
							{piece.count > 1 ? `${piece.mark}×${piece.count}` : piece.mark}
						</span>
					),
				)}
			</pre>
		</section>
	);
}

/** Why the original cannot be shown, in the app's words. */
function failure(error: unknown): string {
	const code = error instanceof ApiError ? error.body.code : undefined;
	if (code === NO_ORIGINAL_CODE) return t("This message has no original.");
	if (code === ORIGINAL_MISSING_CODE) {
		return t("The original of this message is no longer in storage.");
	}
	return t("The original could not be loaded.");
}

interface OriginalMessageProps {
	mailboxId?: string;
	/** The message whose original is shown, or `null` while nothing is. */
	showing: Email | null;
	/** The message whose original is about to be saved, or `null`. */
	saving: Email | null;
	onCloseShowing: () => void;
	onCloseSaving: () => void;
	/** Asked from inside "Show original": the same question as from a message's menu. */
	onAskToSave: (email: Email) => void;
}

/**
 * "Show original" and "Download message" (ADR-0015). The first shows the bytes a message
 * arrived as, the first 256 KB of them, as text. The second saves all of them as a file, after
 * the app has said what the file is: the whole message with every attachment, which another
 * program will open without Podbay's protections.
 */
export default function OriginalMessage({
	mailboxId,
	showing,
	saving,
	onCloseShowing,
	onCloseSaving,
	onAskToSave,
}: OriginalMessageProps) {
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const original = useQuery({
		queryKey: queryKeys.emails.original(mailboxId ?? "", showing?.id ?? ""),
		queryFn: ({ signal }) => api.getOriginal(mailboxId ?? "", showing?.id ?? "", { signal }),
		enabled: mailboxId !== undefined && showing !== null,
		// The bytes of an original never change.
		staleTime: Number.POSITIVE_INFINITY,
		gcTime: 60_000,
		retry: false,
	});
	const answer = original.data;
	// The files the reader is warned about one by one are inside the file as well.
	const risky = (saving?.attachments ?? []).filter((file) => attachmentRisk(file) !== null);

	async function save() {
		if (!saving || !mailboxId) return;
		setBusy(true);
		setError(null);
		try {
			await downloadOriginal(mailboxId, saving);
			onCloseSaving();
		} catch (failed) {
			const code = failed instanceof ApiError ? failed.body.code : undefined;
			setError(
				code === ORIGINAL_MISSING_CODE
					? t("The original of this message is no longer in storage.")
					: t("The file could not be downloaded."),
			);
		} finally {
			setBusy(false);
		}
	}

	return (
		<>
			<LayerDialog.Root
				open={showing !== null}
				onOpenChange={(open) => {
					if (!open) onCloseShowing();
				}}
			>
				<LayerDialog.Content size="xl">
					<LayerDialog.Title>{t("Original message")}</LayerDialog.Title>
					<LayerDialog.Description>
						{answer
							? originalExtent(answer)
							: t("The message as it arrived, before Podbay read it.")}
					</LayerDialog.Description>
					<LayerDialog.Body>
						{original.isPending && (
							<div className="flex justify-center py-8">
								<Loader size="base" aria-label={t("Loading the original")} />
							</div>
						)}
						{original.isError && (
							<p role="alert" className="py-8 text-center text-sm text-kumo-danger">
								{failure(original.error)}
							</p>
						)}
						{answer && (
							<div className="space-y-3">
								{/* Only when the Worker gives it: see AUTHENTICATION_SHOWN in shared/original.ts. */}
								{answer.authentication !== undefined && (
									<p className="text-sm text-kumo-subtle">
										{authenticationWords(answer.authentication)}
									</p>
								)}
								<OriginalText text={answer.header} heading={t("Header")} />
								{answer.rest !== "" && (
									<OriginalText text={answer.rest} heading={t("What follows the header")} />
								)}
							</div>
						)}
					</LayerDialog.Body>
					<LayerDialog.Actions dismissLabel={t("Close")}>
						<LayerDialog.Action
							disabled={showing === null}
							onClick={() => {
								if (showing) onAskToSave(showing);
							}}
						>
							{t("Download message")}
						</LayerDialog.Action>
					</LayerDialog.Actions>
				</LayerDialog.Content>
			</LayerDialog.Root>

			<LayerDialog.Alert
				open={saving !== null}
				onOpenChange={(open) => {
					if (!open) {
						setError(null);
						onCloseSaving();
					}
				}}
			>
				<LayerDialog.Content size="sm">
					<LayerDialog.Title>{t("Download this message?")}</LayerDialog.Title>
					<LayerDialog.Body>
						<div className="space-y-3 text-sm text-kumo-strong">
							<p>
								{t(
									"The file holds the whole message as it arrived, with every attachment. Another program will open it without Podbay's protections.",
								)}
							</p>
							{risky.length > 0 && (
								<div>
									<p className="font-medium text-kumo-default">
										{t("These attachments in it can do harm when opened:")}
									</p>
									<ul className="mt-1 list-disc pl-5">
										{risky.map((file) => (
											<li key={file.id} className="break-all">
												{file.filename}
											</li>
										))}
									</ul>
								</div>
							)}
							{error && (
								<p role="alert" className="text-kumo-danger">
									{error}
								</p>
							)}
						</div>
					</LayerDialog.Body>
					<LayerDialog.Actions dismissLabel={t("Cancel")}>
						<LayerDialog.Action loading={busy} onClick={save}>
							{t("Download")}
						</LayerDialog.Action>
					</LayerDialog.Actions>
				</LayerDialog.Content>
			</LayerDialog.Alert>
		</>
	);
}
