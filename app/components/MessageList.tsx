// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { Badge, Tooltip } from "@cloudflare/kumo";
import {
	ArchiveIcon,
	ArrowBendUpLeftIcon,
	EnvelopeOpenIcon,
	EnvelopeSimpleIcon,
	StarIcon,
	TrashIcon,
} from "@phosphor-icons/react";
import { useParams } from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";
import { formatListDate } from "shared/dates";
import { Folders, getFolderDisplayName } from "shared/folders";
import { type ConversationActions, useConversationActions } from "~/hooks/useConversationActions";
import { type Density, useDisplay, useSplit } from "~/hooks/useDisplay";
import { hasUnread, useOpenConversation } from "~/hooks/useOpenConversation";
import { useShortcuts } from "~/hooks/useShortcuts";
import { useUIStore } from "~/hooks/useUIStore";
import { getSnippetText } from "~/lib/utils";
import type { Email } from "~/types";
import IconButton from "./IconButton";
import { LabelChips } from "./LabelChip";
import MessageListToolbar from "./MessageListToolbar";

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

/** How tall a line is. On a narrow list a line is two rows of text whatever the density. */
const LINE: Record<Density, string> = {
	default: "min-h-10 @2xl:h-10",
	comfortable: "min-h-12 @2xl:h-12",
	compact: "min-h-8 @2xl:h-8",
};

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
	const openId = useUIStore((state) => state.selectedEmailId);
	const open = useOpenConversation(mailboxId);
	const density = useDisplay((state) => state.density);
	const split = useSplit();
	const base = useConversationActions(mailboxId, folder);
	/** Beside the list, a conversation that was filed away must not stay open. */
	const closeIfOpen = (list: Email[], did: boolean) => {
		const { selectedEmailId, closePanel } = useUIStore.getState();
		if (did && list.some((email) => email.id === selectedEmailId)) closePanel();
		return did;
	};
	const actions: ConversationActions = {
		...base,
		moveTo: (list, target, said) => closeIfOpen(list, base.moveTo(list, target, said)),
		moveToLabel: (list, label) => closeIfOpen(list, base.moveToLabel(list, label)),
		archive: (list) => closeIfOpen(list, base.archive(list)),
		reportSpam: (list) => closeIfOpen(list, base.reportSpam(list)),
		notSpam: (list) => closeIfOpen(list, base.notSpam(list)),
		remove: async (list) => closeIfOpen(list, await base.remove(list)),
	};
	const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
	const [cursor, setCursor] = useState(0);
	const mark = highlight ?? ((text: string) => text);

	const ids = emails.map((email) => email.id).join(",");
	// A new page or a new folder starts with nothing selected and the cursor at the top.
	// biome-ignore lint/correctness/useExhaustiveDependencies: the list's identity is the trigger
	useEffect(() => {
		setSelected(new Set());
		setCursor(0);
	}, [ids]);

	const chosen = emails.filter((email) => selected.has(email.id));
	const current = emails[cursor];
	/** What an action applies to: the selection, or the line the keyboard is on. */
	const targets = () => (chosen.length > 0 ? chosen : current ? [current] : []);

	function toggle(id: string) {
		const next = new Set(selected);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		setSelected(next);
	}

	function move(by: number) {
		const next = Math.min(Math.max(cursor + by, 0), emails.length - 1);
		setCursor(next);
		const email = emails[next];
		document.getElementById(`conversation-${email?.id}`)?.scrollIntoView({ block: "nearest" });
		// Beside the list, moving through it reads it: the conversation under the cursor opens.
		if (split && email && next !== cursor) open(email);
	}

	const openCurrent = () => current && open(current);
	useShortcuts(
		{
			j: () => move(1),
			k: () => move(-1),
			o: openCurrent,
			Enter: openCurrent,
			x: () => current && toggle(current.id),
			s: () => current && actions.star(current),
			e: () => folder !== Folders.ARCHIVE && actions.archive(targets()),
			"#": () => void actions.remove(targets()),
			"!": () => folder !== Folders.SPAM && actions.reportSpam(targets()),
			"Shift+I": () => actions.setRead(targets(), true),
			"Shift+U": () => actions.setRead(targets(), false),
			"* a": () => setSelected(new Set(emails.map((email) => email.id))),
			"* n": () => setSelected(new Set()),
		},
		emails.length > 0,
	);

	return (
		<>
			<h1 className="sr-only">{title}</h1>
			<MessageListToolbar
				emails={emails}
				chosen={chosen}
				onSelect={(next) => setSelected(new Set(next))}
				isUnread={hasUnread}
				actions={actions}
				folder={folder}
				page={page}
				setPage={setPage}
				pageSize={pageSize}
				totalCount={totalCount}
				isRefreshing={isRefreshing}
				onRefresh={onRefresh}
			/>

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
							: email.id === openId
								? "bg-kumo-brand/15"
								: unread
									? "bg-kumo-base"
									: "bg-kumo-recessed/60";
						return (
							<div
								key={email.id}
								className={`group flex items-center gap-2 border-b border-l-2 border-b-kumo-line px-2.5 text-sm hover:relative hover:z-[1] hover:shadow-[0_1px_3px_rgb(0_0_0/0.18)] ${LINE[density]} ${
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
									onClick={() => actions.star(email)}
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
									className="min-w-0 flex-1 cursor-pointer self-stretch border-0 bg-transparent p-0 py-1 text-left text-sm @2xl:flex @2xl:items-center @2xl:gap-3 @2xl:py-0"
								>
									<span
										className={`flex min-w-0 items-center gap-1.5 @2xl:w-48 @2xl:shrink-0 ${
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
									<span className="block truncate @2xl:flex-1">
										{showFolder && place && (
											<Badge variant="outline" className="mr-2 align-middle">
												{getFolderDisplayName(place)}
											</Badge>
										)}
										<span className="mr-1.5 inline-flex gap-1 align-middle empty:hidden">
											<LabelChips ids={email.labels} labels={actions.labels} max={3} />
										</span>
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
											onClick={() => actions.archive([email])}
										/>
									)}
									<IconButton
										label={actions.inTrash ? "Delete forever" : "Delete"}
										icon={<TrashIcon size={16} />}
										onClick={() => void actions.remove([email])}
									/>
									<IconButton
										label={unread ? "Mark as read" : "Mark as unread"}
										icon={
											unread ? <EnvelopeOpenIcon size={16} /> : <EnvelopeSimpleIcon size={16} />
										}
										onClick={() => actions.setRead([email], unread)}
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
