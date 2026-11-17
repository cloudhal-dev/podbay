// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified by the Podbay contributors.

import { Button, Tooltip } from "@cloudflare/kumo";
import {
	ArchiveIcon,
	ClockIcon,
	FileIcon,
	PaperPlaneTiltIcon,
	PencilSimpleIcon,
	SquaresFourIcon,
	StarIcon,
	TrashIcon,
	TrayIcon,
	WarningOctagonIcon,
} from "@phosphor-icons/react";
import { Link, useParams } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Folders } from "shared/folders";
import { useConversationActions } from "~/hooks/useConversationActions";
import { useDropTarget } from "~/hooks/useDropTarget";
import { useUIStore } from "~/hooks/useUIStore";
import { plural, t } from "~/i18n";
import { placeName } from "~/lib/places";
import { useFolders } from "~/queries/folders";
import { useMailbox } from "~/queries/mailboxes";
import RailLabels from "./RailLabels";

const ITEM = "flex items-center gap-4 rounded-full h-9 text-sm transition-colors no-underline";
const ACTIVE = "bg-kumo-fill font-semibold text-kumo-default";
const INACTIVE = "text-kumo-strong hover:bg-kumo-tint";

/** The folders every mailbox has, in the order of the rail. Starred is a search, not a folder. */
const SYSTEM_FOLDERS: { id: string; icon: ReactNode }[] = [
	{ id: Folders.INBOX, icon: <TrayIcon size={18} /> },
	{ id: Folders.SENT, icon: <PaperPlaneTiltIcon size={18} /> },
	{ id: Folders.DRAFT, icon: <FileIcon size={18} /> },
	// What was sent and has not left yet (ADR-0016): under Drafts.
	{ id: Folders.SCHEDULED, icon: <ClockIcon size={18} /> },
	{ id: Folders.ARCHIVE, icon: <ArchiveIcon size={18} /> },
	{ id: Folders.SPAM, icon: <WarningOctagonIcon size={18} /> },
	{ id: Folders.TRASH, icon: <TrashIcon size={18} /> },
];

function Item({
	collapsed,
	icon,
	label,
	count,
	notSent,
	children,
}: {
	collapsed: boolean;
	icon: ReactNode;
	label: string;
	count?: number;
	/** In Drafts: how many messages came back unsent (ADR-0016, decision 9). */
	notSent?: number;
	children: (className: string, content: ReactNode) => ReactNode;
}) {
	const content = (
		<>
			<span className="relative shrink-0">
				{icon}
				{collapsed && (count || notSent) ? (
					<span
						className={`absolute -right-1 -top-1 h-2 w-2 rounded-full ${
							notSent ? "bg-kumo-danger" : "bg-kumo-brand"
						}`}
					/>
				) : null}
			</span>
			{!collapsed && <span className="flex-1 truncate">{label}</span>}
			{!collapsed && notSent ? (
				<span className="rounded-full bg-kumo-danger/10 px-1.5 text-xs font-semibold text-kumo-danger">
					{plural(notSent, "{count} not sent", "{count} not sent")}
				</span>
			) : null}
			{!collapsed && count ? <span className="text-xs font-semibold">{count}</span> : null}
		</>
	);
	const className = `${ITEM} ${collapsed ? "w-9 justify-center mx-auto" : "pl-4 pr-3"}`;
	const node = children(className, content);
	return collapsed ? (
		<Tooltip
			content={
				notSent
					? t("{name} ({count} not sent)", { name: label, count: notSent })
					: count
						? t("{name} ({count} unread)", { name: label, count })
						: label
			}
			side="right"
			asChild
		>
			{node}
		</Tooltip>
	) : (
		node
	);
}

/**
 * Only a real send fills Sent and Scheduled, and drafts are made by writing: nothing is
 * dropped on them.
 */
const NO_DROP: readonly string[] = [Folders.SENT, Folders.DRAFT, Folders.SCHEDULED];

/** One place of the rail. Conversations dragged from a list can be dropped on it. */
function Place({
	id,
	label,
	icon,
	count,
	notSent,
	collapsed,
	mailboxId,
	onNavigate,
}: {
	id: string;
	label: string;
	icon: ReactNode;
	count?: number;
	notSent?: number;
	collapsed: boolean;
	mailboxId: string;
	onNavigate: () => void;
}) {
	const { folder } = useParams({ strict: false });
	const actions = useConversationActions(mailboxId, folder);
	const drop = useDropTarget((conversations) => actions.moveTo(conversations, id));
	const takes = !NO_DROP.includes(id) && id !== folder;
	return (
		<Item collapsed={collapsed} icon={icon} label={label} count={count} notSent={notSent}>
			{(className, content) => (
				<Link
					to="/mailbox/$mailboxId/emails/$folder"
					params={{ mailboxId, folder: id }}
					onClick={onNavigate}
					aria-label={collapsed ? label : undefined}
					className={`${className} ${takes && drop.over ? "ring-2 ring-kumo-brand" : ""}`}
					activeProps={{ className: ACTIVE }}
					inactiveProps={{ className: INACTIVE }}
					{...(takes ? drop.handlers : {})}
				>
					{content}
				</Link>
			)}
		</Item>
	);
}

/**
 * The rail: write a message, then the places mail lives. On a wide screen it collapses to
 * icons; on a phone it slides over the list. Folder names stay reachable as tooltips.
 */
export default function Sidebar() {
	const { mailboxId = "" } = useParams({ strict: false });
	const { data: folders = [] } = useFolders(mailboxId);
	const { startCompose, closeSidebar, isRailCollapsed, isSidebarOpen } = useUIStore();
	const { data: currentMailbox } = useMailbox(mailboxId);
	// The phone overlay always shows the full rail.
	const collapsed = isRailCollapsed && !isSidebarOpen;

	const placeOf = (folderId: string) => folders.find((f) => f.id === folderId);
	/** Beside a place: what is unread in it; beside Scheduled, how many messages wait. */
	const unread = (folderId: string) =>
		(folderId === Folders.SCHEDULED
			? placeOf(folderId)?.waiting
			: placeOf(folderId)?.unreadCount) || 0;

	const folderLink = (id: string, label: string, icon: ReactNode, count?: number) => (
		<Place
			key={id}
			id={id}
			label={label}
			icon={icon}
			count={count}
			notSent={id === Folders.DRAFT ? placeOf(id)?.notSent : undefined}
			collapsed={collapsed}
			mailboxId={mailboxId}
			onNavigate={closeSidebar}
		/>
	);

	return (
		<aside
			className={`h-full bg-kumo-recessed flex flex-col shrink-0 transition-[width] duration-150 ${
				collapsed ? "w-[68px]" : "w-64"
			}`}
		>
			<div className={collapsed ? "px-2 pt-3 pb-3" : "px-3 pt-3 pb-3"}>
				{collapsed ? (
					<Tooltip content={t("Compose")} side="right" asChild>
						<Button
							variant="primary"
							shape="square"
							icon={<PencilSimpleIcon size={18} />}
							onClick={() => startCompose()}
							aria-label={t("Compose")}
							className="mx-auto flex"
						/>
					</Tooltip>
				) : (
					<Button
						variant="primary"
						size="lg"
						icon={<PencilSimpleIcon size={18} />}
						onClick={() => startCompose()}
					>
						{t("Compose")}
					</Button>
				)}
			</div>

			<nav aria-label={t("Folders")} className="flex-1 overflow-y-auto px-2 space-y-0.5">
				{folderLink(
					Folders.INBOX,
					placeName(Folders.INBOX),
					SYSTEM_FOLDERS[0]?.icon,
					unread(Folders.INBOX),
				)}
				<Item collapsed={collapsed} icon={<StarIcon size={18} />} label={t("Starred")}>
					{(className, content) => (
						<Link
							to="/mailbox/$mailboxId/search"
							params={{ mailboxId }}
							search={{ q: "is:starred" }}
							onClick={closeSidebar}
							aria-label={collapsed ? t("Starred") : undefined}
							className={className}
							activeProps={{ className: ACTIVE }}
							inactiveProps={{ className: INACTIVE }}
						>
							{content}
						</Link>
					)}
				</Item>
				{SYSTEM_FOLDERS.slice(1).map((folder) =>
					folderLink(folder.id, placeName(folder.id), folder.icon, unread(folder.id)),
				)}

				{!collapsed && <RailLabels mailboxId={mailboxId} onNavigate={closeSidebar} />}
			</nav>

			<div className={`border-t border-kumo-line ${collapsed ? "p-2" : "p-3"}`}>
				<Item collapsed={collapsed} icon={<SquaresFourIcon size={18} />} label={t("All mailboxes")}>
					{(className, content) => (
						<Link
							to="/"
							onClick={closeSidebar}
							aria-label={collapsed ? t("All mailboxes") : undefined}
							className={`${className} ${INACTIVE}`}
						>
							{content}
						</Link>
					)}
				</Item>
				{!collapsed && (
					<p className="mt-1 truncate pl-4 text-xs text-kumo-subtle">
						{currentMailbox?.email || mailboxId}
					</p>
				)}
			</div>
		</aside>
	);
}
