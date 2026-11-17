// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { Button, DropdownMenu } from "@cloudflare/kumo";
import {
	ArchiveIcon,
	ArrowsClockwiseIcon,
	CaretDownIcon,
	CaretLeftIcon,
	CaretRightIcon,
	DotsThreeVerticalIcon,
	EnvelopeOpenIcon,
	EnvelopeSimpleIcon,
	TrashIcon,
	TrayIcon,
	WarningOctagonIcon,
} from "@phosphor-icons/react";
import { useEffect, useRef } from "react";
import { Folders } from "shared/folders";
import type { ConversationActions } from "~/hooks/useConversationActions";
import type { Email } from "~/types";
import IconButton from "./IconButton";
import MoveMenu from "./MoveMenu";

interface MessageListToolbarProps {
	emails: Email[];
	chosen: Email[];
	onSelect: (ids: string[]) => void;
	isUnread: (email: Email) => boolean;
	actions: ConversationActions;
	folder?: string;
	page: number;
	setPage: (page: number) => void;
	pageSize: number;
	totalCount: number;
	isRefreshing?: boolean;
	onRefresh?: () => void;
}

/**
 * The bar above a list of conversations. With nothing selected it refreshes and pages; with a
 * selection it acts on it. The box at the left selects the page, and its menu selects by kind.
 */
export default function MessageListToolbar({
	emails,
	chosen,
	onSelect,
	isUnread,
	actions,
	folder,
	page,
	setPage,
	pageSize,
	totalCount,
	isRefreshing,
	onRefresh,
}: MessageListToolbarProps) {
	const selectAll = useRef<HTMLInputElement>(null);
	const allSelected = emails.length > 0 && chosen.length === emails.length;
	useEffect(() => {
		if (selectAll.current) selectAll.current.indeterminate = chosen.length > 0 && !allSelected;
	}, [chosen.length, allSelected]);

	const pick = (keep: (email: Email) => boolean) => onSelect(emails.filter(keep).map((e) => e.id));
	const anyUnread = chosen.some(isUnread);
	const first = (page - 1) * pageSize + 1;
	const last = Math.min(page * pageSize, totalCount);

	return (
		<div className="flex h-12 shrink-0 items-center gap-1 border-b border-kumo-line px-3">
			<input
				ref={selectAll}
				type="checkbox"
				aria-label="Select all conversations on this page"
				className="ml-1.5 h-4 w-4 cursor-pointer"
				checked={allSelected}
				disabled={emails.length === 0}
				onChange={() => pick(() => !allSelected)}
			/>
			<DropdownMenu>
				<DropdownMenu.Trigger
					render={
						<Button
							variant="ghost"
							shape="square"
							size="xs"
							icon={<CaretDownIcon size={12} />}
							aria-label="Select by kind"
							title="Select"
							disabled={emails.length === 0}
						/>
					}
				/>
				<DropdownMenu.Content>
					<DropdownMenu.Item onClick={() => pick(() => true)}>All</DropdownMenu.Item>
					<DropdownMenu.Item onClick={() => pick(() => false)}>None</DropdownMenu.Item>
					<DropdownMenu.Item onClick={() => pick((e) => !isUnread(e))}>Read</DropdownMenu.Item>
					<DropdownMenu.Item onClick={() => pick(isUnread)}>Unread</DropdownMenu.Item>
					<DropdownMenu.Item onClick={() => pick((e) => e.starred)}>Starred</DropdownMenu.Item>
					<DropdownMenu.Item onClick={() => pick((e) => !e.starred)}>Unstarred</DropdownMenu.Item>
				</DropdownMenu.Content>
			</DropdownMenu>

			{chosen.length === 0 ? (
				<>
					{onRefresh && (
						<IconButton
							label={isRefreshing ? "Refreshing" : "Refresh"}
							icon={
								<ArrowsClockwiseIcon size={18} className={isRefreshing ? "animate-spin" : ""} />
							}
							onClick={onRefresh}
							disabled={isRefreshing}
						/>
					)}
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
									disabled={emails.length === 0}
								/>
							}
						/>
						<DropdownMenu.Content>
							<DropdownMenu.Item
								icon={EnvelopeOpenIcon}
								onClick={() => actions.setRead(emails.filter(isUnread), true)}
							>
								Mark this page as read
							</DropdownMenu.Item>
						</DropdownMenu.Content>
					</DropdownMenu>
				</>
			) : (
				<>
					{folder !== Folders.ARCHIVE && (
						<IconButton
							label="Archive"
							icon={<ArchiveIcon size={18} />}
							onClick={() => actions.archive(chosen)}
						/>
					)}
					{folder === Folders.SPAM ? (
						<IconButton
							label="Not spam"
							icon={<TrayIcon size={18} />}
							onClick={() => actions.notSpam(chosen)}
						/>
					) : (
						<IconButton
							label="Report spam"
							icon={<WarningOctagonIcon size={18} />}
							onClick={() => actions.reportSpam(chosen)}
						/>
					)}
					<IconButton
						label={actions.inTrash ? "Delete forever" : "Delete"}
						icon={<TrashIcon size={18} />}
						onClick={() => void actions.remove(chosen)}
					/>
					<span className="mx-1 h-5 w-px bg-kumo-line" aria-hidden="true" />
					<IconButton
						label={anyUnread ? "Mark as read" : "Mark as unread"}
						icon={anyUnread ? <EnvelopeOpenIcon size={18} /> : <EnvelopeSimpleIcon size={18} />}
						onClick={() => actions.setRead(chosen, anyUnread)}
					/>
					<MoveMenu
						folders={actions.moveTargets}
						onMove={(target) => actions.moveTo(chosen, target)}
					/>
					<span
						className="sr-only ml-2 text-sm text-kumo-subtle @xl:not-sr-only"
						aria-live="polite"
					>
						{chosen.length} selected
					</span>
				</>
			)}

			<div className="ml-auto flex items-center gap-1">
				{totalCount > 0 && (
					<span className="mr-1 text-xs text-kumo-subtle whitespace-nowrap">
						{first}–{last} of {totalCount}
					</span>
				)}
				<IconButton
					label="Newer"
					icon={<CaretLeftIcon size={16} />}
					onClick={() => setPage(page - 1)}
					disabled={page <= 1}
				/>
				<IconButton
					label="Older"
					icon={<CaretRightIcon size={16} />}
					onClick={() => setPage(page + 1)}
					disabled={last >= totalCount}
				/>
			</div>
		</div>
	);
}
