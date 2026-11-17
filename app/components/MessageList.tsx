// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { Badge, Button, Tooltip, useKumoToastManager } from "@cloudflare/kumo";
import {
	ArchiveIcon,
	ArrowBendUpLeftIcon,
	ArrowsClockwiseIcon,
	CaretLeftIcon,
	CaretRightIcon,
	EnvelopeOpenIcon,
	EnvelopeSimpleIcon,
	StarIcon,
	TrashIcon,
} from "@phosphor-icons/react";
import { useParams } from "@tanstack/react-router";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { formatListDate } from "shared/dates";
import { Folders, getFolderDisplayName } from "shared/folders";
import { useShortcuts } from "~/hooks/useShortcuts";
import { useUIStore } from "~/hooks/useUIStore";
import { getSnippetText } from "~/lib/utils";
import { useDeleteEmail, useMarkThreadRead, useMoveEmail, useUpdateEmail } from "~/queries/emails";
import type { Email } from "~/types";

interface MessageListProps {
	/** The page's heading. Read by assistive technology; the rail already shows it to the eye. */
	title: string;
	emails: Email[];
	totalCount: number;
	page: number;
	setPage: (page: number) => void;
	pageSize: number;
	isLoading: boolean;
	isRefreshing?: boolean;
	onRefresh?: () => void;
	/** The folder on screen; it decides what Delete means. Leave out for search results. */
	folder?: string;
	/** What to show when there is nothing to list. */
	empty: ReactNode;
	/** Marks the words the reader searched for. */
	highlight?: (text: string) => ReactNode;
	/** Says which folder each conversation is in (search results span folders). */
	showFolder?: boolean;
}

const hasUnread = (email: Email): boolean =>
	email.thread_unread_count !== undefined ? email.thread_unread_count > 0 : !email.read;

function participants(email: Email): string {
	if (!email.participants) return email.sender.split("@")[0] ?? email.sender;
	const names = email.participants
		.split(",")
		.map((p) => p.trim().split("@")[0] ?? "")
		.filter((name, index, all) => name !== "" && all.indexOf(name) === index);
	return names.length <= 3
		? names.join(", ")
		: `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
}

const SKELETON_ROWS = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];

function Skeleton() {
	return (
		<div className="animate-pulse" aria-hidden="true">
			{SKELETON_ROWS.map((row) => (
				<div key={row} className="flex h-10 items-center gap-3 border-b border-kumo-line px-3">
					<div className="h-4 w-4 rounded bg-kumo-fill" />
					<div className="h-4 w-4 rounded bg-kumo-fill" />
					<div className="h-3 w-32 rounded bg-kumo-fill" />
					<div className="h-3 flex-1 rounded bg-kumo-fill" />
					<div className="h-3 w-12 rounded bg-kumo-fill" />
				</div>
			))}
		</div>
	);
}

function IconButton({
	label,
	icon,
	onClick,
	disabled,
}: {
	label: string;
	icon: ReactNode;
	onClick: () => void;
	disabled?: boolean;
}) {
	return (
		<Tooltip content={label} side="bottom" asChild>
			<Button
				variant="ghost"
				shape="square"
				size="sm"
				icon={icon}
				onClick={onClick}
				disabled={disabled}
				aria-label={label}
			/>
		</Tooltip>
	);
}

/**
 * A list of conversations as a mail client shows it: one dense line each, a toolbar that acts on
 * what is selected, quick actions on the line under the pointer, and the keyboard for all of it.
 * Opening a conversation replaces the list (`MailView`); Back returns here.
 */
export default function MessageList({
	title,
	emails,
	totalCount,
	page,
	setPage,
	pageSize,
	isLoading,
	isRefreshing,
	onRefresh,
	folder,
	empty,
	highlight,
	showFolder,
}: MessageListProps) {
	const { mailboxId } = useParams({ strict: false });
	const { selectEmail } = useUIStore();
	const toasts = useKumoToastManager();
	const updateEmail = useUpdateEmail();
	const markThreadRead = useMarkThreadRead();
	const moveEmail = useMoveEmail();
	const deleteEmail = useDeleteEmail();
	const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
	const [cursor, setCursor] = useState(0);
	const selectAll = useRef<HTMLInputElement>(null);
	const mark = highlight ?? ((text: string) => text);

	const ids = emails.map((email) => email.id).join(",");
	// A new page or a new folder starts with nothing selected and the cursor at the top.
	// biome-ignore lint/correctness/useExhaustiveDependencies: the list's identity is the trigger
	useEffect(() => {
		setSelected(new Set());
		setCursor(0);
	}, [ids]);

	const chosen = emails.filter((email) => selected.has(email.id));
	const allSelected = emails.length > 0 && chosen.length === emails.length;
	useEffect(() => {
		if (selectAll.current) selectAll.current.indeterminate = chosen.length > 0 && !allSelected;
	}, [chosen.length, allSelected]);

	const inTrash = folder === Folders.TRASH;
	const current = emails[cursor];
	/** What an action applies to: the selection, or the line the keyboard is on. */
	const targets = () => (chosen.length > 0 ? chosen : current ? [current] : []);
	const plural = (count: number) => (count === 1 ? "Conversation" : `${count} conversations`);

	function toggle(id: string) {
		const next = new Set(selected);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		setSelected(next);
	}

	function open(email: Email) {
		selectEmail(email.id);
		if (!mailboxId || !hasUnread(email)) return;
		if (email.thread_id && (email.thread_count ?? 1) > 1) {
			markThreadRead.mutate({ mailboxId, threadId: email.thread_id });
		} else {
			updateEmail.mutate({ mailboxId, id: email.id, data: { read: true } });
		}
	}

	function setRead(list: Email[], read: boolean) {
		if (!mailboxId) return;
		for (const email of list) updateEmail.mutate({ mailboxId, id: email.id, data: { read } });
	}

	function star(email: Email) {
		if (mailboxId) {
			updateEmail.mutate({ mailboxId, id: email.id, data: { starred: !email.starred } });
		}
	}

	function archive(list: Email[]) {
		if (!mailboxId || list.length === 0) return;
		for (const email of list) {
			moveEmail.mutate({ mailboxId, id: email.id, folderId: Folders.ARCHIVE });
		}
		toasts.add({ title: `${plural(list.length)} archived` });
	}

	/** Delete moves to Trash. Only inside Trash is it for good, and then it asks first. */
	function remove(list: Email[]) {
		if (!mailboxId || list.length === 0) return;
		if (!inTrash) {
			for (const email of list) {
				moveEmail.mutate({ mailboxId, id: email.id, folderId: Folders.TRASH });
			}
			toasts.add({ title: `${plural(list.length)} moved to Trash` });
			return;
		}
		const sure = window.confirm(
			`Delete ${list.length === 1 ? "this conversation" : `these ${list.length} conversations`} forever? This cannot be undone.`,
		);
		if (!sure) return;
		for (const email of list) deleteEmail.mutate({ mailboxId, id: email.id });
		toasts.add({ title: `${plural(list.length)} deleted forever` });
	}

	function move(by: number) {
		const next = Math.min(Math.max(cursor + by, 0), emails.length - 1);
		setCursor(next);
		document
			.getElementById(`conversation-${emails[next]?.id}`)
			?.scrollIntoView({ block: "nearest" });
	}

	const openCurrent = () => current && open(current);
	useShortcuts(
		{
			j: () => move(1),
			k: () => move(-1),
			o: openCurrent,
			Enter: openCurrent,
			x: () => current && toggle(current.id),
			s: () => current && star(current),
			e: () => folder !== Folders.ARCHIVE && archive(targets()),
			"#": () => remove(targets()),
			"Shift+I": () => setRead(targets(), true),
			"Shift+U": () => setRead(targets(), false),
		},
		emails.length > 0,
	);

	const first = (page - 1) * pageSize + 1;
	const last = Math.min(page * pageSize, totalCount);

	return (
		<>
			<h1 className="sr-only">{title}</h1>
			<div className="flex h-12 shrink-0 items-center gap-1 border-b border-kumo-line px-3">
				<input
					ref={selectAll}
					type="checkbox"
					aria-label="Select all conversations on this page"
					className="mx-1.5 h-4 w-4 cursor-pointer"
					checked={allSelected}
					disabled={emails.length === 0}
					onChange={() => setSelected(allSelected ? new Set() : new Set(emails.map((e) => e.id)))}
				/>
				{chosen.length === 0 ? (
					onRefresh && (
						<IconButton
							label={isRefreshing ? "Refreshing" : "Refresh"}
							icon={
								<ArrowsClockwiseIcon size={18} className={isRefreshing ? "animate-spin" : ""} />
							}
							onClick={onRefresh}
							disabled={isRefreshing}
						/>
					)
				) : (
					<>
						{folder !== Folders.ARCHIVE && (
							<IconButton
								label="Archive"
								icon={<ArchiveIcon size={18} />}
								onClick={() => archive(chosen)}
							/>
						)}
						<IconButton
							label={inTrash ? "Delete forever" : "Delete"}
							icon={<TrashIcon size={18} />}
							onClick={() => remove(chosen)}
						/>
						<IconButton
							label="Mark as read"
							icon={<EnvelopeOpenIcon size={18} />}
							onClick={() => setRead(chosen, true)}
						/>
						<IconButton
							label="Mark as unread"
							icon={<EnvelopeSimpleIcon size={18} />}
							onClick={() => setRead(chosen, false)}
						/>
						<span className="ml-2 text-sm text-kumo-subtle" aria-live="polite">
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

			<div className="flex-1 overflow-y-auto">
				{isLoading && emails.length === 0 ? (
					<Skeleton />
				) : emails.length === 0 ? (
					empty
				) : (
					emails.map((email, index) => {
						const unread = hasUnread(email);
						const isSelected = selected.has(email.id);
						const snippet = getSnippetText(email.snippet, 140);
						const place =
							(email as Email & { folder_name?: string }).folder_name ?? email.folder_id;
						const tone = isSelected
							? "bg-kumo-brand/10"
							: unread
								? "bg-kumo-base hover:bg-kumo-tint"
								: "bg-kumo-recessed/60 hover:bg-kumo-tint";
						return (
							<div
								key={email.id}
								className={`group flex min-h-10 items-center gap-2 border-b border-l-2 border-b-kumo-line px-2.5 text-sm transition-colors md:h-10 ${
									index === cursor ? "border-l-kumo-brand" : "border-l-transparent"
								} ${tone}`}
							>
								<input
									type="checkbox"
									aria-label={`Select the conversation "${email.subject || "No subject"}"`}
									className="mx-1 h-4 w-4 shrink-0 cursor-pointer"
									checked={isSelected}
									onChange={() => toggle(email.id)}
								/>
								<button
									type="button"
									aria-label={email.starred ? "Unstar" : "Star"}
									aria-pressed={email.starred}
									className="shrink-0 rounded bg-transparent border-0 p-0.5 cursor-pointer"
									onClick={() => star(email)}
								>
									<StarIcon
										size={16}
										weight={email.starred ? "fill" : "regular"}
										className={
											email.starred
												? "text-kumo-warning"
												: "text-kumo-subtle hover:text-kumo-warning"
										}
									/>
								</button>

								{/* The conversation itself: one button, so the row has one name and one action */}
								<button
									type="button"
									id={`conversation-${email.id}`}
									onClick={() => open(email)}
									onFocus={() => setCursor(index)}
									className="min-w-0 flex-1 cursor-pointer self-stretch border-0 bg-transparent p-0 py-1.5 text-left text-sm md:flex md:items-center md:gap-3 md:py-0"
								>
									<span
										className={`flex min-w-0 items-center gap-1.5 md:w-48 md:shrink-0 ${
											unread ? "font-semibold text-kumo-default" : "text-kumo-strong"
										}`}
									>
										<span className="truncate">{mark(participants(email))}</span>
										{(email.thread_count ?? 1) > 1 && (
											<span className="shrink-0 text-xs font-normal text-kumo-subtle">
												{email.thread_count}
											</span>
										)}
										{email.has_draft && (
											<span className="shrink-0 text-xs font-medium text-kumo-danger">Draft</span>
										)}
									</span>
									<span className="block truncate md:flex-1">
										{showFolder && place && (
											<Badge variant="outline" className="mr-2 align-middle">
												{getFolderDisplayName(place)}
											</Badge>
										)}
										<span
											className={unread ? "font-semibold text-kumo-default" : "text-kumo-default"}
										>
											{mark(email.subject || "(no subject)")}
										</span>
										{snippet && <span className="text-kumo-subtle"> — {mark(snippet)}</span>}
									</span>
								</button>

								{email.needs_reply && !email.has_draft && (
									<Tooltip content="Needs a reply" asChild>
										<span className="shrink-0 text-kumo-warning">
											<ArrowBendUpLeftIcon size={14} weight="bold" />
										</span>
									</Tooltip>
								)}
								<span
									className={`w-16 shrink-0 text-right text-xs group-hover:hidden group-focus-within:hidden ${
										unread ? "font-semibold text-kumo-default" : "text-kumo-subtle"
									}`}
								>
									{formatListDate(email.date)}
								</span>
								<span className="hidden shrink-0 items-center group-hover:flex group-focus-within:flex">
									{folder !== Folders.ARCHIVE && (
										<IconButton
											label="Archive"
											icon={<ArchiveIcon size={16} />}
											onClick={() => archive([email])}
										/>
									)}
									<IconButton
										label={inTrash ? "Delete forever" : "Delete"}
										icon={<TrashIcon size={16} />}
										onClick={() => remove([email])}
									/>
									<IconButton
										label={unread ? "Mark as read" : "Mark as unread"}
										icon={
											unread ? <EnvelopeOpenIcon size={16} /> : <EnvelopeSimpleIcon size={16} />
										}
										onClick={() => setRead([email], unread)}
									/>
								</span>
							</div>
						);
					})
				)}
			</div>
		</>
	);
}
