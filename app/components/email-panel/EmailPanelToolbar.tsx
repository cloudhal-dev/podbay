// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified by the Podbay contributors.

import { Button, DropdownMenu } from "@cloudflare/kumo";
import {
	ArchiveIcon,
	ArrowLeftIcon,
	CodeIcon,
	DotsThreeVerticalIcon,
	EnvelopeSimpleIcon,
	PaperPlaneTiltIcon,
	PencilSimpleIcon,
	StarIcon,
	TrashIcon,
	TrayIcon,
	WarningOctagonIcon,
} from "@phosphor-icons/react";
import { Folders } from "shared/folders";
import IconButton from "~/components/IconButton";
import MoveMenu from "~/components/MoveMenu";
import type { Email, Folder } from "~/types";

interface EmailPanelToolbarProps {
	email: Email;
	/** The folder the conversation is in; it decides which actions make sense. */
	folder?: string;
	isDraftFolder: boolean;
	isSending: boolean;
	moveToFolders: Folder[];
	onBack: () => void;
	onSendDraft: () => void;
	onEditDraft: () => void;
	onArchive: () => void;
	onSpam: () => void;
	onNotSpam: () => void;
	onDelete: () => void;
	onMarkUnread: () => void;
	onToggleStar: () => void;
	onMove: (folderId: string) => void;
	onViewSource: () => void;
}

/**
 * The bar above an open conversation, in the order a mail client keeps it: back; then what
 * removes the conversation from here (archive, spam, delete); then what files it (unread, move).
 */
export default function EmailPanelToolbar({
	email,
	folder,
	isDraftFolder,
	isSending,
	moveToFolders,
	onBack,
	onSendDraft,
	onEditDraft,
	onArchive,
	onSpam,
	onNotSpam,
	onDelete,
	onMarkUnread,
	onToggleStar,
	onMove,
	onViewSource,
}: EmailPanelToolbarProps) {
	return (
		<div className="flex h-12 shrink-0 items-center gap-1 border-b border-kumo-line px-3">
			<IconButton label="Back to list" icon={<ArrowLeftIcon size={18} />} onClick={onBack} />
			<span className="w-2" aria-hidden="true" />

			{isDraftFolder ? (
				<>
					<Button
						variant="primary"
						size="sm"
						icon={<PaperPlaneTiltIcon size={16} />}
						onClick={onSendDraft}
						loading={isSending}
					>
						{isSending ? "Sending" : "Send"}
					</Button>
					<Button
						variant="secondary"
						size="sm"
						icon={<PencilSimpleIcon size={16} />}
						onClick={onEditDraft}
					>
						Edit
					</Button>
				</>
			) : (
				<>
					{folder !== Folders.ARCHIVE && (
						<IconButton label="Archive" icon={<ArchiveIcon size={18} />} onClick={onArchive} />
					)}
					{folder === Folders.SPAM ? (
						<IconButton label="Not spam" icon={<TrayIcon size={18} />} onClick={onNotSpam} />
					) : (
						<IconButton
							label="Report spam"
							icon={<WarningOctagonIcon size={18} />}
							onClick={onSpam}
						/>
					)}
				</>
			)}
			<IconButton
				label={folder === Folders.TRASH ? "Delete forever" : "Delete"}
				icon={<TrashIcon size={18} />}
				onClick={onDelete}
			/>
			<span className="mx-1 h-5 w-px bg-kumo-line" aria-hidden="true" />
			{!isDraftFolder && (
				<IconButton
					label="Mark as unread"
					icon={<EnvelopeSimpleIcon size={18} />}
					onClick={onMarkUnread}
				/>
			)}
			<MoveMenu folders={moveToFolders} onMove={onMove} />
			<IconButton
				label={email.starred ? "Unstar" : "Star"}
				icon={
					<StarIcon
						size={18}
						weight={email.starred ? "fill" : "regular"}
						className={email.starred ? "text-kumo-warning" : ""}
					/>
				}
				onClick={onToggleStar}
			/>

			<div className="ml-auto">
				<DropdownMenu>
					<DropdownMenu.Trigger
						render={
							<Button
								variant="ghost"
								shape="square"
								size="sm"
								icon={<DotsThreeVerticalIcon size={18} weight="bold" />}
								aria-label="More"
								title="More"
							/>
						}
					/>
					<DropdownMenu.Content>
						<DropdownMenu.Item icon={CodeIcon} onClick={onViewSource}>
							Show message headers
						</DropdownMenu.Item>
					</DropdownMenu.Content>
				</DropdownMenu>
			</div>
		</div>
	);
}
