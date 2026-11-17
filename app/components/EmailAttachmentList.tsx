// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified by the Podbay contributors.

import { LayerDialog } from "@cloudflare/kumo";
import { FileIcon, ImageIcon, PaperclipIcon, WarningIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { type AttachmentRisk, attachmentRisk, isShowableImage } from "shared/attachment-risk";
import { plural, t } from "~/i18n";
import { attachmentUrl, downloadAcknowledged } from "~/lib/attachments";
import { inlineImages } from "~/lib/inline-images";
import { formatBytes } from "~/lib/utils";
import type { Attachment } from "~/types";

interface EmailAttachmentListProps {
	mailboxId?: string;
	emailId: string;
	attachments?: Attachment[];
	onPreviewImage?: (url: string, filename: string) => void;
	className?: string;
	showHeading?: boolean;
}

const CHIP =
	"flex items-center gap-2 rounded-md border px-3 py-2 transition-colors hover:bg-kumo-tint text-sm text-left";

function Label({ attachment }: { attachment: Attachment }) {
	return (
		<>
			<span className="text-kumo-default font-medium truncate max-w-[140px]">
				{attachment.filename}
			</span>
			<span className="text-kumo-subtle">{formatBytes(attachment.size)}</span>
		</>
	);
}

/**
 * The files of a message (rule S5). Every one is a download. A file that can do harm when
 * opened is marked, and is handed over only after the reader has read why and asked for it;
 * the Worker refuses a plain link to it.
 */
export default function EmailAttachmentList({
	mailboxId,
	emailId,
	attachments,
	onPreviewImage,
	className,
	showHeading = false,
}: EmailAttachmentListProps) {
	const [asking, setAsking] = useState<{ attachment: Attachment; risk: AttachmentRisk } | null>(
		null,
	);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	if (!mailboxId) return null;

	// Everything but the images the message shows in its own body.
	const embedded = new Set(inlineImages(attachments).map((a) => a.id));
	const files = (attachments ?? []).filter((a) => !embedded.has(a.id));
	if (files.length === 0) return null;

	async function download() {
		if (!asking || !mailboxId) return;
		setBusy(true);
		setError(null);
		try {
			await downloadAcknowledged(mailboxId, emailId, asking.attachment);
			setAsking(null);
		} catch {
			setError(t("The file could not be downloaded."));
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className={className}>
			{showHeading && (
				<div className="flex items-center gap-2 mb-2">
					<PaperclipIcon size={14} className="text-kumo-subtle" />
					<span className="text-sm font-medium text-kumo-default">
						{plural(files.length, "{count} attachment", "{count} attachments")}
					</span>
				</div>
			)}
			<div className="flex flex-wrap gap-2">
				{files.map((attachment) => {
					const url = attachmentUrl(mailboxId, emailId, attachment.id);
					const risk = attachmentRisk(attachment);

					if (risk !== null) {
						return (
							<button
								key={attachment.id}
								type="button"
								title={risk.reason}
								onClick={() => {
									setError(null);
									setAsking({ attachment, risk });
								}}
								className={`${CHIP} border-kumo-danger/50`}
							>
								<WarningIcon size={16} weight="fill" className="text-kumo-danger shrink-0" />
								<Label attachment={attachment} />
								<span className="sr-only">{t("Can do harm when opened")}</span>
							</button>
						);
					}

					if (isShowableImage(attachment.mimetype) && onPreviewImage) {
						return (
							<button
								key={attachment.id}
								type="button"
								onClick={() => onPreviewImage(url, attachment.filename)}
								className={`${CHIP} border-kumo-line`}
							>
								<ImageIcon size={16} className="text-kumo-subtle shrink-0" />
								<Label attachment={attachment} />
							</button>
						);
					}

					return (
						<a
							key={attachment.id}
							href={url}
							download={attachment.filename}
							className={`${CHIP} border-kumo-line no-underline`}
						>
							<FileIcon size={16} className="text-kumo-subtle shrink-0" />
							<Label attachment={attachment} />
						</a>
					);
				})}
			</div>

			<LayerDialog.Alert
				open={asking !== null}
				onOpenChange={(open) => {
					if (!open) setAsking(null);
				}}
			>
				<LayerDialog.Content size="sm">
					<LayerDialog.Title>{t("This file can do harm")}</LayerDialog.Title>
					<LayerDialog.Body>
						<div className="space-y-3">
							<p className="text-sm font-medium text-kumo-default break-all">
								{asking?.attachment.filename}
							</p>
							<p className="text-sm text-kumo-strong">{asking?.risk.reason}</p>
							<p className="text-sm text-kumo-subtle">
								{t(
									"Download it only if you were expecting it from this sender. A familiar name on a message is not proof of who sent it.",
								)}
							</p>
							{error && (
								<p role="alert" className="text-sm text-kumo-danger">
									{error}
								</p>
							)}
						</div>
					</LayerDialog.Body>
					<LayerDialog.Actions dismissLabel={t("Cancel")}>
						<LayerDialog.Action variant="destructive" loading={busy} onClick={download}>
							{t("Download anyway")}
						</LayerDialog.Action>
					</LayerDialog.Actions>
				</LayerDialog.Content>
			</LayerDialog.Alert>
		</div>
	);
}
