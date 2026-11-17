// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified by the Podbay contributors.

import { Button, Input, LayerDialog, Tooltip } from "@cloudflare/kumo";
import {
	ArchiveIcon,
	FileIcon,
	FolderIcon,
	PaperPlaneTiltIcon,
	PencilSimpleIcon,
	PlusIcon,
	SquaresFourIcon,
	StarIcon,
	TrashIcon,
	TrayIcon,
	WarningOctagonIcon,
} from "@phosphor-icons/react";
import { Link, useParams } from "@tanstack/react-router";
import { type ReactNode, useMemo, useState } from "react";
import { Folders, SYSTEM_FOLDER_IDS } from "shared/folders";
import { useUIStore } from "~/hooks/useUIStore";
import { useCreateFolder, useFolders } from "~/queries/folders";
import { useMailbox } from "~/queries/mailboxes";

const ITEM = "flex items-center gap-4 rounded-full h-9 text-sm transition-colors no-underline";
const ACTIVE = "bg-kumo-fill font-semibold text-kumo-default";
const INACTIVE = "text-kumo-strong hover:bg-kumo-tint";

/** The folders every mailbox has, in the order of the rail. Starred is a search, not a folder. */
const SYSTEM_FOLDERS: { id: string; label: string; icon: ReactNode }[] = [
	{ id: Folders.INBOX, label: "Inbox", icon: <TrayIcon size={18} /> },
	{ id: Folders.SENT, label: "Sent", icon: <PaperPlaneTiltIcon size={18} /> },
	{ id: Folders.DRAFT, label: "Drafts", icon: <FileIcon size={18} /> },
	{ id: Folders.ARCHIVE, label: "Archive", icon: <ArchiveIcon size={18} /> },
	{ id: Folders.SPAM, label: "Spam", icon: <WarningOctagonIcon size={18} /> },
	{ id: Folders.TRASH, label: "Trash", icon: <TrashIcon size={18} /> },
];

function Item({
	collapsed,
	icon,
	label,
	count,
	children,
}: {
	collapsed: boolean;
	icon: ReactNode;
	label: string;
	count?: number;
	children: (className: string, content: ReactNode) => ReactNode;
}) {
	const content = (
		<>
			<span className="relative shrink-0">
				{icon}
				{collapsed && count ? (
					<span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-kumo-brand" />
				) : null}
			</span>
			{!collapsed && <span className="flex-1 truncate">{label}</span>}
			{!collapsed && count ? <span className="text-xs font-semibold">{count}</span> : null}
		</>
	);
	const className = `${ITEM} ${collapsed ? "w-9 justify-center mx-auto" : "pl-4 pr-3"}`;
	const node = children(className, content);
	return collapsed ? (
		<Tooltip content={count ? `${label} (${count} unread)` : label} side="right" asChild>
			{node}
		</Tooltip>
	) : (
		node
	);
}

/**
 * The rail: write a message, then the places mail lives. On a wide screen it collapses to
 * icons; on a phone it slides over the list. Folder names stay reachable as tooltips.
 */
export default function Sidebar() {
	const { mailboxId = "" } = useParams({ strict: false });
	const { data: folders = [] } = useFolders(mailboxId);
	const createFolderMutation = useCreateFolder();
	const { startCompose, closeSidebar, isRailCollapsed, isSidebarOpen } = useUIStore();
	const { data: currentMailbox } = useMailbox(mailboxId);
	const [isCreateFolderOpen, setIsCreateFolderOpen] = useState(false);
	const [newFolderName, setNewFolderName] = useState("");
	// The phone overlay always shows the full rail.
	const collapsed = isRailCollapsed && !isSidebarOpen;

	const customFolders = useMemo(
		() =>
			folders.filter(
				(f) => !(SYSTEM_FOLDER_IDS as readonly string[]).includes(f.id) && f.id !== Folders.SPAM,
			),
		[folders],
	);
	const unread = (folderId: string) => folders.find((f) => f.id === folderId)?.unreadCount || 0;

	const handleCreateFolder = (e: React.FormEvent) => {
		e.preventDefault();
		if (newFolderName.trim() && mailboxId) {
			createFolderMutation.mutate({ mailboxId, name: newFolderName.trim() });
			setNewFolderName("");
			setIsCreateFolderOpen(false);
		}
	};

	const folderLink = (id: string, label: string, icon: ReactNode, count?: number) => (
		<Item key={id} collapsed={collapsed} icon={icon} label={label} count={count}>
			{(className, content) => (
				<Link
					to="/mailbox/$mailboxId/emails/$folder"
					params={{ mailboxId, folder: id }}
					onClick={closeSidebar}
					aria-label={collapsed ? label : undefined}
					className={className}
					activeProps={{ className: ACTIVE }}
					inactiveProps={{ className: INACTIVE }}
				>
					{content}
				</Link>
			)}
		</Item>
	);

	return (
		<aside
			className={`h-full bg-kumo-recessed flex flex-col shrink-0 transition-[width] duration-150 ${
				collapsed ? "w-[68px]" : "w-64"
			}`}
		>
			<div className={collapsed ? "px-2 pt-3 pb-3" : "px-3 pt-3 pb-3"}>
				{collapsed ? (
					<Tooltip content="Compose" side="right" asChild>
						<Button
							variant="primary"
							shape="square"
							icon={<PencilSimpleIcon size={18} />}
							onClick={() => startCompose()}
							aria-label="Compose"
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
						Compose
					</Button>
				)}
			</div>

			<nav aria-label="Folders" className="flex-1 overflow-y-auto px-2 space-y-0.5">
				{folderLink(Folders.INBOX, "Inbox", SYSTEM_FOLDERS[0]?.icon, unread(Folders.INBOX))}
				<Item collapsed={collapsed} icon={<StarIcon size={18} />} label="Starred">
					{(className, content) => (
						<Link
							to="/mailbox/$mailboxId/search"
							params={{ mailboxId }}
							search={{ q: "is:starred" }}
							onClick={closeSidebar}
							aria-label={collapsed ? "Starred" : undefined}
							className={className}
							activeProps={{ className: ACTIVE }}
							inactiveProps={{ className: INACTIVE }}
						>
							{content}
						</Link>
					)}
				</Item>
				{SYSTEM_FOLDERS.slice(1).map((folder) =>
					folderLink(folder.id, folder.label, folder.icon, unread(folder.id)),
				)}

				<div className="pt-4">
					{!collapsed && (
						<div className="flex items-center justify-between pl-4 pr-1 mb-1">
							<span className="text-xs font-semibold text-kumo-subtle">Folders</span>
							<Tooltip content="New folder" asChild>
								<Button
									variant="ghost"
									shape="square"
									size="sm"
									icon={<PlusIcon size={16} />}
									onClick={() => setIsCreateFolderOpen(true)}
									aria-label="Create new folder"
								/>
							</Tooltip>
						</div>
					)}
					{customFolders.map((folder) =>
						folderLink(folder.id, folder.name, <FolderIcon size={18} />, folder.unreadCount),
					)}
				</div>
			</nav>

			<div className={`border-t border-kumo-line ${collapsed ? "p-2" : "p-3"}`}>
				<Item collapsed={collapsed} icon={<SquaresFourIcon size={18} />} label="All mailboxes">
					{(className, content) => (
						<Link
							to="/"
							onClick={closeSidebar}
							aria-label={collapsed ? "All mailboxes" : undefined}
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

			<LayerDialog.Root open={isCreateFolderOpen} onOpenChange={setIsCreateFolderOpen}>
				<LayerDialog.Content size="sm">
					<LayerDialog.Title>Create folder</LayerDialog.Title>
					<LayerDialog.Body>
						<form id="create-folder" onSubmit={handleCreateFolder}>
							<Input
								label="Folder name"
								placeholder="e.g. Projects"
								value={newFolderName}
								onChange={(e) => setNewFolderName(e.target.value)}
								required
							/>
						</form>
					</LayerDialog.Body>
					<LayerDialog.Actions dismissLabel="Cancel">
						<LayerDialog.Action type="submit" form="create-folder" disabled={!newFolderName.trim()}>
							Create
						</LayerDialog.Action>
					</LayerDialog.Actions>
				</LayerDialog.Content>
			</LayerDialog.Root>
		</aside>
	);
}
