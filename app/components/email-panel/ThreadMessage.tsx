// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified by the Podbay contributors.

import { Button } from "@cloudflare/kumo";
import {
	CaretDownIcon,
	PaperPlaneTiltIcon,
	PencilSimpleIcon,
	TrashIcon,
} from "@phosphor-icons/react";
import EmailAttachmentList from "~/components/EmailAttachmentList";
import MessageBody from "~/components/MessageBody";
import { dateLanguage, t } from "~/i18n";
import { formatDetailDate, stripHtml } from "~/lib/utils";
import type { Email } from "~/types";
import MessageHeader, { type MessageActions } from "./MessageHeader";
import UnreadMessage from "./UnreadMessage";

interface ThreadMessageProps {
	email: Email;
	mailboxId?: string;
	mailboxEmail?: string;
	isLast: boolean;
	isDraft?: boolean;
	isSending?: boolean;
	isExpanded: boolean;
	onToggleExpand: () => void;
	onSendDraft?: () => void;
	onEditDraft?: () => void;
	onDeleteDraft?: () => void;
	/** What can be done to this message alone. Left out for a draft. */
	actions?: MessageActions;
	inTrash?: boolean;
	/** Left out of a print of another message of the conversation. */
	hiddenInPrint?: boolean;
	onPreviewImage?: (url: string, filename: string) => void;
}

function Avatar({
	isDraft,
	isSelf,
	sender,
}: {
	isDraft?: boolean;
	isSelf: boolean;
	sender: string;
}) {
	return (
		<div
			className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
				isDraft
					? "bg-kumo-fill text-kumo-subtle"
					: isSelf
						? "bg-kumo-brand text-kumo-inverse"
						: "bg-kumo-fill text-kumo-default"
			}`}
		>
			{isDraft ? t("Draft").charAt(0) : sender.charAt(0).toUpperCase()}
		</div>
	);
}

export default function ThreadMessage({
	email,
	mailboxId,
	mailboxEmail,
	isLast,
	isDraft,
	isSending,
	isExpanded,
	onToggleExpand,
	onSendDraft,
	onEditDraft,
	onDeleteDraft,
	actions,
	inTrash,
	hiddenInPrint,
	onPreviewImage,
}: ThreadMessageProps) {
	const isSelf = email.sender === mailboxEmail;
	const containerClassName = `${!isLast ? "border-b border-kumo-line" : ""} ${isDraft ? "border-l-2 border-l-kumo-warning bg-kumo-warning/[0.02]" : ""} ${hiddenInPrint ? "print:hidden" : ""}`;
	const senderLabel = isDraft ? t("Draft reply") : isSelf ? t("You") : email.sender;

	if (!isExpanded) {
		return (
			<div className={containerClassName}>
				<button
					type="button"
					onClick={onToggleExpand}
					className="flex w-full cursor-pointer items-center gap-3 border-0 bg-transparent px-4 py-3 text-left hover:bg-kumo-tint md:px-6"
				>
					<Avatar isDraft={isDraft} isSelf={isSelf} sender={email.sender} />
					<div className="flex-1 min-w-0">
						<div className="flex items-center justify-between">
							<span className="text-sm font-medium text-kumo-default truncate">{senderLabel}</span>
							<span className="text-xs text-kumo-subtle shrink-0">
								{formatDetailDate(email.date, dateLanguage())}
							</span>
						</div>
						<p className="text-xs text-kumo-subtle truncate">
							{stripHtml(email.body || "").slice(0, 80)}
						</p>
					</div>
					<CaretDownIcon size={14} className="text-kumo-subtle shrink-0" />
				</button>
			</div>
		);
	}

	return (
		<div className={`group/thread-msg ${containerClassName}`}>
			<div className="px-4 py-4 md:px-6">
				<div className="mb-3">
					<MessageHeader
						email={email}
						mailboxEmail={mailboxEmail}
						isDraft={isDraft}
						inTrash={inTrash}
						actions={actions}
						onCollapse={onToggleExpand}
					/>
				</div>

				<div className="md:ml-[52px]">
					{email.unparsed ? (
						<UnreadMessage
							why={email.unparsed}
							onShowOriginal={actions?.onShowOriginal}
							onDownloadOriginal={actions?.onDownloadOriginal}
						/>
					) : (
						<MessageBody email={email} mailboxId={mailboxId} autoSize />
					)}
				</div>

				{isDraft && (onSendDraft || onEditDraft || onDeleteDraft) && (
					<div className="flex gap-2 mt-3 md:ml-[52px]">
						{onSendDraft && (
							<Button
								variant="primary"
								size="sm"
								icon={<PaperPlaneTiltIcon size={14} />}
								onClick={onSendDraft}
								loading={isSending}
								disabled={isSending}
							>
								{isSending ? t("Sending...") : t("Send")}
							</Button>
						)}
						{onEditDraft && (
							<Button
								variant="secondary"
								size="sm"
								icon={<PencilSimpleIcon size={14} />}
								onClick={onEditDraft}
								disabled={isSending}
							>
								{t("Edit")}
							</Button>
						)}
						{onDeleteDraft && (
							<Button
								variant="ghost"
								size="sm"
								icon={<TrashIcon size={14} />}
								onClick={onDeleteDraft}
								disabled={isSending}
							>
								{t("Discard")}
							</Button>
						)}
					</div>
				)}

				<EmailAttachmentList
					mailboxId={mailboxId}
					emailId={email.id}
					attachments={email.attachments}
					onPreviewImage={onPreviewImage}
					className="mt-3 md:ml-[52px]"
				/>
			</div>
		</div>
	);
}
