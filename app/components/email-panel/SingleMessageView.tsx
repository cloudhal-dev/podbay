// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified by the Podbay contributors.

import EmailAttachmentList from "~/components/EmailAttachmentList";
import MessageBody from "~/components/MessageBody";
import type { Email } from "~/types";
import MessageHeader, { type MessageActions } from "./MessageHeader";
import UnreadMessage from "./UnreadMessage";

interface SingleMessageViewProps {
	email: Email;
	mailboxId?: string;
	mailboxEmail?: string;
	isDraft?: boolean;
	inTrash?: boolean;
	actions?: MessageActions;
	onPreviewImage: (url: string, filename: string) => void;
}

/** A conversation of one message: its header, its body, its attachments. */
export default function SingleMessageView({
	email,
	mailboxId,
	mailboxEmail,
	isDraft,
	inTrash,
	actions,
	onPreviewImage,
}: SingleMessageViewProps) {
	return (
		<div className="flex flex-col">
			<div className="border-b border-kumo-line px-4 py-4 md:px-6">
				<MessageHeader
					email={email}
					mailboxEmail={mailboxEmail}
					isDraft={isDraft}
					inTrash={inTrash}
					actions={actions}
				/>
			</div>

			{/* As tall as the message: the conversation scrolls, never the message inside it */}
			<div className="px-4 py-4 md:px-6">
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

			<EmailAttachmentList
				mailboxId={mailboxId}
				emailId={email.id}
				attachments={email.attachments}
				onPreviewImage={onPreviewImage}
				className="px-4 py-3 border-t border-kumo-line shrink-0 md:px-6"
				showHeading
			/>
		</div>
	);
}
