// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { DropdownMenu } from "@cloudflare/kumo";
import {
	ArchiveIcon,
	ArrowBendUpLeftIcon,
	ArrowBendUpRightIcon,
	ArrowSquareOutIcon,
	ChatCircleIcon,
	EnvelopeOpenIcon,
	EnvelopeSimpleIcon,
	FolderSimpleIcon,
	MagnifyingGlassIcon,
	StarIcon,
	TagIcon,
	TrashIcon,
	TrayIcon,
	WarningOctagonIcon,
} from "@phosphor-icons/react";
import { useMemo } from "react";
import { Folders } from "shared/folders";
import type { ConversationActions } from "~/hooks/useConversationActions";
import { t } from "~/i18n";
import { labelDot } from "~/lib/labels";
import { placeName } from "~/lib/places";
import type { Email } from "~/types";

export interface MenuPoint {
	x: number;
	y: number;
}

/**
 * The menu of a line in a list, opened where the pointer is (a right click) or where the line
 * is (the menu key). It offers what the toolbar and an open conversation offer, without opening
 * anything first. When the line is part of a selection the menu acts on the selection.
 */
export default function ConversationMenu({
	at,
	email,
	targets,
	unread,
	folder,
	actions,
	onClose,
	onOpen,
	onAnswer,
	onFindFromSender,
	href,
}: {
	at: MenuPoint;
	/** The line the menu was opened on. */
	email: Email;
	/** What the menu acts on: that line, or the selection it belongs to. */
	targets: Email[];
	unread: boolean;
	folder?: string;
	actions: ConversationActions;
	onClose: () => void;
	onOpen: () => void;
	onAnswer: (mode: "reply" | "reply-all" | "forward") => void;
	onFindFromSender: () => void;
	/** The address of the conversation, to open it in a new tab. */
	href: string;
}) {
	const anchor = useMemo(
		() => ({
			getBoundingClientRect: () => DOMRect.fromRect({ x: at.x, y: at.y, width: 0, height: 0 }),
		}),
		[at.x, at.y],
	);
	const one = targets.length === 1;
	const onAll = (labelId: string) => targets.every((target) => target.labels?.includes(labelId));

	return (
		<DropdownMenu
			open
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<DropdownMenu.Content anchor={anchor} side="bottom" align="start" sideOffset={2}>
				{one && (
					<>
						<DropdownMenu.Item onClick={onOpen}>{t("Open")}</DropdownMenu.Item>
						<DropdownMenu.Item icon={ArrowBendUpLeftIcon} onClick={() => onAnswer("reply")}>
							{t("Reply")}
						</DropdownMenu.Item>
						<DropdownMenu.Item icon={ChatCircleIcon} onClick={() => onAnswer("reply-all")}>
							{t("Reply to all")}
						</DropdownMenu.Item>
						<DropdownMenu.Item icon={ArrowBendUpRightIcon} onClick={() => onAnswer("forward")}>
							{t("Forward")}
						</DropdownMenu.Item>
						<DropdownMenu.Separator />
					</>
				)}
				{folder !== Folders.ARCHIVE && (
					<DropdownMenu.Item icon={ArchiveIcon} onClick={() => actions.archive(targets)}>
						{t("Archive")}
					</DropdownMenu.Item>
				)}
				<DropdownMenu.Item icon={TrashIcon} onClick={() => void actions.remove(targets)}>
					{actions.inTrash ? t("Delete forever") : t("Delete")}
				</DropdownMenu.Item>
				<DropdownMenu.Item
					icon={unread ? EnvelopeOpenIcon : EnvelopeSimpleIcon}
					onClick={() => actions.setRead(targets, unread)}
				>
					{unread ? t("Mark as read") : t("Mark as unread")}
				</DropdownMenu.Item>
				{one && (
					<DropdownMenu.Item icon={StarIcon} onClick={() => actions.star(email)}>
						{email.starred ? t("Remove the star") : t("Add a star")}
					</DropdownMenu.Item>
				)}
				{folder === Folders.SPAM ? (
					<DropdownMenu.Item icon={TrayIcon} onClick={() => actions.notSpam(targets)}>
						{t("Not spam")}
					</DropdownMenu.Item>
				) : (
					<DropdownMenu.Item icon={WarningOctagonIcon} onClick={() => actions.reportSpam(targets)}>
						{t("Report spam")}
					</DropdownMenu.Item>
				)}
				<DropdownMenu.Separator />
				<DropdownMenu.Sub>
					<DropdownMenu.SubTrigger icon={FolderSimpleIcon}>{t("Move to")}</DropdownMenu.SubTrigger>
					<DropdownMenu.SubContent>
						{actions.moveTargets.map((place) => (
							<DropdownMenu.Item key={place.id} onClick={() => actions.moveTo(targets, place.id)}>
								{placeName(place.id)}
							</DropdownMenu.Item>
						))}
						{actions.labels.length > 0 && <DropdownMenu.Separator />}
						{actions.labels.map((label) => (
							<DropdownMenu.Item key={label.id} onClick={() => actions.moveToLabel(targets, label)}>
								<span
									className={`mr-2 inline-block h-2 w-2 rounded-full ${labelDot(label.color)}`}
									aria-hidden="true"
								/>
								{label.name}
							</DropdownMenu.Item>
						))}
					</DropdownMenu.SubContent>
				</DropdownMenu.Sub>
				<DropdownMenu.Sub>
					<DropdownMenu.SubTrigger icon={TagIcon}>{t("Label as")}</DropdownMenu.SubTrigger>
					<DropdownMenu.SubContent>
						{actions.labels.length === 0 && (
							<DropdownMenu.Item disabled>
								{t("No labels yet. Make one in the rail.")}
							</DropdownMenu.Item>
						)}
						{actions.labels.map((label) => (
							<DropdownMenu.CheckboxItem
								key={label.id}
								checked={onAll(label.id)}
								onCheckedChange={(give) => actions.label(targets, label.id, give)}
							>
								<span
									className={`mr-2 inline-block h-2 w-2 rounded-full ${labelDot(label.color)}`}
									aria-hidden="true"
								/>
								{label.name}
							</DropdownMenu.CheckboxItem>
						))}
					</DropdownMenu.SubContent>
				</DropdownMenu.Sub>
				{one && (
					<>
						<DropdownMenu.Separator />
						<DropdownMenu.Item icon={MagnifyingGlassIcon} onClick={onFindFromSender}>
							{t("Find messages from this sender")}
						</DropdownMenu.Item>
						<DropdownMenu.LinkItem
							icon={ArrowSquareOutIcon}
							href={href}
							target="_blank"
							rel="noopener"
						>
							{t("Open in a new tab")}
						</DropdownMenu.LinkItem>
					</>
				)}
			</DropdownMenu.Content>
		</DropdownMenu>
	);
}
