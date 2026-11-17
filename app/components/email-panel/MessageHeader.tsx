// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { Badge, Button, DropdownMenu } from "@cloudflare/kumo";
import {
	ArrowBendUpLeftIcon,
	ArrowBendUpRightIcon,
	CaretDownIcon,
	ChatCircleIcon,
	CodeIcon,
	DotsThreeVerticalIcon,
	EnvelopeSimpleIcon,
	MagnifyingGlassIcon,
	PrinterIcon,
	StarIcon,
	TrashIcon,
	WarningOctagonIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import { formatDetailDate } from "shared/dates";
import IconButton from "~/components/IconButton";
import { useDisplay } from "~/hooks/useDisplay";
import { splitEmailList } from "~/lib/utils";
import type { Email } from "~/types";

/** What can be done to one message of a conversation, as opposed to the whole conversation. */
export interface MessageActions {
	onReply: () => void;
	onReplyAll: () => void;
	onForward: () => void;
	/** Moves this message to Trash, or deletes it for good when it is already there. */
	onDelete: () => void;
	onMarkUnread: () => void;
	/** Left out where it makes no sense (the message is already in Spam). */
	onSpam?: () => void;
	onStar: () => void;
	onPrint: () => void;
	onFindFromSender: () => void;
	onShowHeaders: () => void;
}

interface MessageHeaderProps {
	email: Email;
	/** The address of the mailbox on screen, to say "me" and "You". */
	mailboxEmail?: string;
	isDraft?: boolean;
	/** The message is in Trash: deleting it is for good. */
	inTrash?: boolean;
	/** Leave out for a draft: a draft has its own buttons. */
	actions?: MessageActions;
	/** In a conversation of several messages, the avatar folds the message away. */
	onCollapse?: () => void;
}

function Detail({ name, value }: { name: string; value?: string | null }) {
	if (!value) return null;
	return (
		<>
			<dt className="text-kumo-subtle">{name}</dt>
			<dd className="m-0 break-words text-kumo-default">{value}</dd>
		</>
	);
}

/**
 * The top of one message: who wrote it and to whom, when, a star, Reply, and a menu of what can
 * be done to this message alone. "To" opens the full details, as a mail client shows them.
 */
export default function MessageHeader({
	email,
	mailboxEmail,
	isDraft,
	inTrash,
	actions,
	onCollapse,
}: MessageHeaderProps) {
	const [detailsOpen, setDetailsOpen] = useState(false);
	const replyToAll = useDisplay((state) => state.defaultReply) === "reply-all";
	const isSelf = email.sender === mailboxEmail;
	const sender = isDraft ? "Draft" : isSelf ? "You" : email.sender;
	const recipients = splitEmailList(email.recipient).map((address) =>
		address.toLowerCase() === mailboxEmail?.toLowerCase() ? "me" : address,
	);
	const others = splitEmailList(email.cc).length;
	const to =
		recipients.length === 0
			? "no recipient"
			: `${recipients.slice(0, 2).join(", ")}${
					recipients.length + others > 2 ? ` and ${recipients.length + others - 2} more` : ""
				}`;
	const avatar = (
		<span
			className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
				isDraft
					? "bg-kumo-fill text-kumo-subtle"
					: isSelf
						? "bg-kumo-brand text-kumo-inverse"
						: "bg-kumo-fill text-kumo-default"
			}`}
		>
			{isDraft ? "D" : email.sender.charAt(0).toUpperCase()}
		</span>
	);

	return (
		<div className="flex items-start gap-3">
			{onCollapse ? (
				<button
					type="button"
					onClick={onCollapse}
					aria-label="Collapse message"
					className="shrink-0 cursor-pointer rounded-full border-0 bg-transparent p-0 hover:ring-2 hover:ring-kumo-brand/30 print:hidden"
				>
					{avatar}
				</button>
			) : (
				avatar
			)}

			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					<span className="truncate text-sm font-semibold text-kumo-default">{sender}</span>
					{isDraft && <Badge variant="outline">Draft</Badge>}
				</div>
				<button
					type="button"
					onClick={() => setDetailsOpen(!detailsOpen)}
					aria-expanded={detailsOpen}
					aria-label={detailsOpen ? "Hide details" : "Show details"}
					className="flex max-w-full cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-left text-xs text-kumo-subtle hover:text-kumo-default"
				>
					<span className="truncate">to {to}</span>
					<CaretDownIcon size={10} className={detailsOpen ? "rotate-180" : ""} />
				</button>
				{detailsOpen && (
					<dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg border border-kumo-line p-3 text-xs">
						<Detail name="From" value={email.sender} />
						<Detail name="To" value={email.recipient} />
						<Detail name="Cc" value={email.cc} />
						<Detail name="Bcc" value={email.bcc} />
						<Detail name="Date" value={new Date(email.date).toLocaleString()} />
						<Detail name="Subject" value={email.subject || "(no subject)"} />
					</dl>
				)}
			</div>

			<div className="flex shrink-0 items-center gap-0.5">
				<span className="mr-1 text-xs text-kumo-subtle">{formatDetailDate(email.date)}</span>
				{actions && (
					<span className="flex items-center gap-0.5 print:hidden">
						<IconButton
							label={email.starred ? "Unstar this message" : "Star this message"}
							icon={
								<StarIcon
									size={16}
									weight={email.starred ? "fill" : "regular"}
									className={email.starred ? "text-kumo-warning" : ""}
								/>
							}
							onClick={actions.onStar}
						/>
						<IconButton
							label={replyToAll ? "Reply to all of this message" : "Reply to this message"}
							icon={replyToAll ? <ChatCircleIcon size={16} /> : <ArrowBendUpLeftIcon size={16} />}
							onClick={replyToAll ? actions.onReplyAll : actions.onReply}
						/>
						<DropdownMenu>
							<DropdownMenu.Trigger
								render={
									<Button
										variant="ghost"
										shape="square"
										size="sm"
										icon={<DotsThreeVerticalIcon size={16} weight="bold" />}
										aria-label="More for this message"
										title="More"
									/>
								}
							/>
							<DropdownMenu.Content>
								<DropdownMenu.Item icon={ArrowBendUpLeftIcon} onClick={actions.onReply}>
									Reply
								</DropdownMenu.Item>
								<DropdownMenu.Item icon={ChatCircleIcon} onClick={actions.onReplyAll}>
									Reply to all
								</DropdownMenu.Item>
								<DropdownMenu.Item icon={ArrowBendUpRightIcon} onClick={actions.onForward}>
									Forward
								</DropdownMenu.Item>
								<DropdownMenu.Separator />
								<DropdownMenu.Item icon={TrashIcon} onClick={actions.onDelete}>
									{inTrash ? "Delete this message forever" : "Delete this message"}
								</DropdownMenu.Item>
								<DropdownMenu.Item icon={EnvelopeSimpleIcon} onClick={actions.onMarkUnread}>
									Mark as unread
								</DropdownMenu.Item>
								{actions.onSpam && (
									<DropdownMenu.Item icon={WarningOctagonIcon} onClick={actions.onSpam}>
										Report spam
									</DropdownMenu.Item>
								)}
								<DropdownMenu.Separator />
								<DropdownMenu.Item icon={MagnifyingGlassIcon} onClick={actions.onFindFromSender}>
									Find messages from this sender
								</DropdownMenu.Item>
								<DropdownMenu.Item icon={PrinterIcon} onClick={actions.onPrint}>
									Print
								</DropdownMenu.Item>
								<DropdownMenu.Item icon={CodeIcon} onClick={actions.onShowHeaders}>
									Show headers
								</DropdownMenu.Item>
							</DropdownMenu.Content>
						</DropdownMenu>
					</span>
				)}
			</div>
		</div>
	);
}
