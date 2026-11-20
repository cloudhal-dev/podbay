// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { Button, Checkbox, DropdownMenu } from "@cloudflare/kumo";
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
import { Folders } from "@podbay/mail/shared";
import type { ConversationActions } from "~/hooks/useConversationActions";
import { t } from "~/i18n";
import type { Email } from "~/types";
import IconButton from "./IconButton";
import LabelMenu from "./LabelMenu";
import MoveMenu from "./MoveMenu";

interface MessageListToolbarProps {
	emails: Email[];
	chosen: Email[];
	onSelect: (ids: string[]) => void;
	isUnread: (email: Email) => boolean;
	actions: ConversationActions;
	/** Whether everything of the place or the search is chosen, and not only this page. */
	all?: boolean;
	/** Whether "Move to" offers the labels. */
	moveToLabel?: boolean;
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
	all = false,
	moveToLabel = true,
	folder,
	page,
	setPage,
	pageSize,
	totalCount,
	isRefreshing,
	onRefresh,
}: MessageListToolbarProps) {
	const allSelected = emails.length > 0 && chosen.length === emails.length;

	const pick = (keep: (email: Email) => boolean) => onSelect(emails.filter(keep).map((e) => e.id));
	const anyUnread = chosen.some(isUnread);
	const first = (page - 1) * pageSize + 1;
	const last = Math.min(page * pageSize, totalCount);

	return (
		<div className="flex h-12 shrink-0 items-center gap-1 border-b border-kumo-line px-3">
			<Checkbox
				aria-label={t("Select all conversations on this page")}
				// Kumo's box takes clicks 12 px around it; this keeps them off the menu's button beside it.
				className="ml-1.5 mr-2"
				checked={allSelected}
				indeterminate={chosen.length > 0 && !allSelected}
				disabled={emails.length === 0}
				onCheckedChange={() => pick(() => !allSelected)}
			/>
			<DropdownMenu>
				<DropdownMenu.Trigger
					render={
						<Button
							variant="ghost"
							shape="square"
							size="xs"
							icon={<CaretDownIcon size={12} />}
							aria-label={t("Select by kind")}
							title={t("Select")}
							disabled={emails.length === 0}
						/>
					}
				/>
				<DropdownMenu.Content>
					<DropdownMenu.Item onClick={() => pick(() => true)}>{t("All")}</DropdownMenu.Item>
					<DropdownMenu.Item onClick={() => pick(() => false)}>{t("None")}</DropdownMenu.Item>
					<DropdownMenu.Item onClick={() => pick((e) => !isUnread(e))}>
						{t("Read")}
					</DropdownMenu.Item>
					<DropdownMenu.Item onClick={() => pick(isUnread)}>{t("Unread")}</DropdownMenu.Item>
					<DropdownMenu.Item onClick={() => pick((e) => e.starred)}>
						{t("Starred")}
					</DropdownMenu.Item>
					<DropdownMenu.Item onClick={() => pick((e) => !e.starred)}>
						{t("Unstarred")}
					</DropdownMenu.Item>
				</DropdownMenu.Content>
			</DropdownMenu>

			{chosen.length === 0 ? (
				<>
					{onRefresh && (
						<IconButton
							label={isRefreshing ? t("Refreshing") : t("Refresh")}
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
									aria-label={t("More")}
									title={t("More")}
									disabled={emails.length === 0}
								/>
							}
						/>
						<DropdownMenu.Content>
							<DropdownMenu.Item
								icon={EnvelopeOpenIcon}
								onClick={() => actions.setRead(emails.filter(isUnread), true)}
							>
								{t("Mark this page as read")}
							</DropdownMenu.Item>
						</DropdownMenu.Content>
					</DropdownMenu>
				</>
			) : (
				<>
					{folder !== Folders.ARCHIVE && !actions.fromSent && (
						<IconButton
							label={t("Archive")}
							icon={<ArchiveIcon size={18} />}
							onClick={() => actions.archive(chosen)}
						/>
					)}
					{folder === Folders.SPAM ? (
						<IconButton
							label={t("Not spam")}
							icon={<TrayIcon size={18} />}
							onClick={() => actions.notSpam(chosen)}
						/>
					) : (
						!actions.fromSent && (
							<IconButton
								label={t("Report spam")}
								icon={<WarningOctagonIcon size={18} />}
								onClick={() => actions.reportSpam(chosen)}
							/>
						)
					)}
					{/* Everything in Trash is deleted for good by emptying it, not from here. */}
					{!(all && actions.inTrash) && (
						<IconButton
							label={actions.inTrash ? t("Delete forever") : t("Delete")}
							icon={<TrashIcon size={18} />}
							onClick={() => void actions.remove(chosen)}
						/>
					)}
					<span className="mx-1 h-5 w-px bg-kumo-line" aria-hidden="true" />
					<IconButton
						label={anyUnread ? t("Mark as read") : t("Mark as unread")}
						icon={anyUnread ? <EnvelopeOpenIcon size={18} /> : <EnvelopeSimpleIcon size={18} />}
						onClick={() => actions.setRead(chosen, anyUnread)}
					/>
					<MoveMenu
						folders={actions.moveTargets}
						labels={actions.labels}
						onMove={(target) => actions.moveTo(chosen, target)}
						onMoveToLabel={moveToLabel ? (label) => actions.moveToLabel(chosen, label) : undefined}
					/>
					<LabelMenu
						labels={actions.labels}
						targets={chosen}
						onChange={(labelId, give) => actions.label(chosen, labelId, give)}
					/>
					<span
						className="sr-only ml-2 text-sm text-kumo-subtle @xl:not-sr-only"
						aria-live="polite"
					>
						{all ? t("Everything selected") : t("{count} selected", { count: chosen.length })}
					</span>
				</>
			)}

			<div className="ml-auto flex items-center gap-1">
				{totalCount > 0 && (
					<span className="mr-1 text-xs text-kumo-subtle whitespace-nowrap">
						{t("{first}–{last} of {total}", { first, last, total: totalCount })}
					</span>
				)}
				<IconButton
					label={t("Newer")}
					icon={<CaretLeftIcon size={16} />}
					onClick={() => setPage(page - 1)}
					disabled={page <= 1}
				/>
				<IconButton
					label={t("Older")}
					icon={<CaretRightIcon size={16} />}
					onClick={() => setPage(page + 1)}
					disabled={last >= totalCount}
				/>
			</div>
		</div>
	);
}
