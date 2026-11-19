// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { Badge, Button, Checkbox, Tooltip } from "@cloudflare/kumo";
import {
	ArchiveIcon,
	ArrowBendUpLeftIcon,
	EnvelopeOpenIcon,
	EnvelopeSimpleIcon,
	StarIcon,
	TrashIcon,
} from "@phosphor-icons/react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { BulkFilter } from "shared/bulk";
import { formatListDate } from "shared/dates";
import { Folders } from "shared/folders";
import {
	type ConversationActions,
	type EverythingDeed,
	type Progress,
	useConversationActions,
} from "~/hooks/useConversationActions";
import { type Density, useDisplay, useSplit } from "~/hooks/useDisplay";
import { DRAG_TYPE } from "~/hooks/useDropTarget";
import { hasUnread, useOpenConversation } from "~/hooks/useOpenConversation";
import { useShortcuts } from "~/hooks/useShortcuts";
import { useUIStore } from "~/hooks/useUIStore";
import { dateLanguage, t } from "~/i18n";
import { placeName } from "~/lib/places";
import { getSnippetText } from "~/lib/utils";
import api from "~/services/api";
import type { Email } from "~/types";
import ConversationMenu, { type MenuPoint } from "./ConversationMenu";
import IconButton from "./IconButton";
import { LabelChips } from "./LabelChip";
import MessageListToolbar from "./MessageListToolbar";
import SelectEverything from "./SelectEverything";

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
	/**
	 * What "everything" is here, offered once a whole page is ticked (ADR-0014): the filter of
	 * the place or the search, and the words that offer it and say it is chosen.
	 */
	everything?: { filter: BulkFilter; offer: string; chosen: string };
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
	everything,
}: MessageListProps) {
	const { mailboxId } = useParams({ strict: false });
	const openId = useUIStore((state) => state.selectedEmailId);
	const open = useOpenConversation(mailboxId);
	const density = useDisplay((state) => state.density);
	const showSnippets = useDisplay((state) => state.snippets);
	const showActions = useDisplay((state) => state.hoverActions);
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
		moveTo: (list, target) => closeIfOpen(list, base.moveTo(list, target)),
		moveToLabel: (list, label) => closeIfOpen(list, base.moveToLabel(list, label)),
		archive: (list) => closeIfOpen(list, base.archive(list)),
		reportSpam: (list) => closeIfOpen(list, base.reportSpam(list)),
		notSpam: (list) => closeIfOpen(list, base.notSpam(list)),
		remove: async (list) => closeIfOpen(list, await base.remove(list)),
	};
	const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
	/** Whether everything of the place or the search is chosen, and not only the ticked page. */
	const [all, setAll] = useState(false);
	/** How far a deed on everything is, while it runs. */
	const [progress, setProgress] = useState<Progress | null>(null);
	const [cursor, setCursor] = useState(0);
	/** The line whose menu is open, and where it was opened. */
	const [menu, setMenu] = useState<{ email: Email; at: MenuPoint } | null>(null);
	const navigate = useNavigate();
	const startCompose = useUIStore((state) => state.startCompose);
	const mark = highlight ?? ((text: string) => text);

	const ids = emails.map((email) => email.id).join(",");
	// A new page or a new folder starts with nothing selected and the cursor at the top.
	// biome-ignore lint/correctness/useExhaustiveDependencies: the list's identity is the trigger
	useEffect(() => {
		setSelected(new Set());
		setAll(false);
		setCursor(0);
	}, [ids]);

	/** Ticking or unticking anything is a choice of lines again, not of everything. */
	const select = (next: ReadonlySet<string>) => {
		setSelected(next);
		setAll(false);
	};
	const chosen = emails.filter((email) => selected.has(email.id));
	const wholePage = emails.length > 0 && chosen.length === emails.length;
	const allChosen = all && wholePage && everything !== undefined;

	/** A deed on everything: the mailbox counts, the app asks, and the line says how far it is. */
	const onEverything = (deed: EverythingDeed): boolean => {
		if (!everything) return false;
		void base.everything(everything.filter, deed, setProgress).then((did) => {
			if (!did) return;
			select(new Set());
			// Beside the list, a conversation that was filed away must not stay open.
			if (deed.kind !== "read" && deed.kind !== "label") useUIStore.getState().closePanel();
		});
		return true;
	};
	const forAll: ConversationActions = {
		...actions,
		moveTo: (_list, target) => onEverything({ kind: "move", target }),
		moveToLabel: (_list, label) => onEverything({ kind: "moveToLabel", label }),
		archive: () => onEverything({ kind: "move", target: Folders.ARCHIVE }),
		reportSpam: () => onEverything({ kind: "move", target: Folders.SPAM }),
		notSpam: () => onEverything({ kind: "move", target: Folders.INBOX }),
		// Everything in Trash is deleted for good by emptying it, from the line above the list.
		remove: async () =>
			base.inTrash ? false : onEverything({ kind: "move", target: Folders.TRASH }),
		setRead: (_list, read) => void onEverything({ kind: "read", read }),
		label: (_list, labelId, give) => {
			const label = base.labels.find((one) => one.id === labelId);
			if (label) onEverything({ kind: "label", label, give });
		},
	};
	/** What the toolbar, the keys and the menu of a ticked line act through. */
	const deeds = allChosen ? forAll : actions;
	const current = emails[cursor];
	/** What an action applies to: the selection, or the line the keyboard is on. */
	const targets = () => (chosen.length > 0 ? chosen : current ? [current] : []);

	/** The line whose box was used last, and whether Shift was held for the one in hand. */
	const lastToggled = useRef<number | null>(null);
	const withShift = useRef(false);

	/** Ticks or unticks a line. With Shift held, every line from the last one used to this one. */
	function toggle(id: string) {
		const next = new Set(selected);
		const index = emails.findIndex((email) => email.id === id);
		const from = lastToggled.current;
		if (withShift.current && from !== null && index >= 0) {
			const on = !next.has(id);
			for (const email of emails.slice(Math.min(from, index), Math.max(from, index) + 1)) {
				if (on) next.add(email.id);
				else next.delete(email.id);
			}
		} else if (next.has(id)) next.delete(id);
		else next.add(id);
		withShift.current = false;
		lastToggled.current = index;
		select(next);
	}

	function move(by: number) {
		const next = Math.min(Math.max(cursor + by, 0), emails.length - 1);
		setCursor(next);
		const email = emails[next];
		document.getElementById(`conversation-${email?.id}`)?.scrollIntoView({ block: "nearest" });
		// Beside the list, moving through it reads it: the conversation under the cursor opens.
		if (split && email && next !== cursor) open(email);
	}

	/** Answering from the list needs the whole message, which a line does not carry. */
	async function answer(email: Email, mode: "reply" | "reply-all" | "forward") {
		if (!mailboxId) return;
		const whole = (await api.getEmail(mailboxId, email.id)) as Email;
		startCompose({ mode, originalEmail: whole });
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
			e: () => folder !== Folders.ARCHIVE && !base.fromSent && deeds.archive(targets()),
			"#": () => void deeds.remove(targets()),
			"!": () => folder !== Folders.SPAM && !base.fromSent && deeds.reportSpam(targets()),
			"Shift+I": () => deeds.setRead(targets(), true),
			"Shift+U": () => deeds.setRead(targets(), false),
			"* a": () => select(new Set(emails.map((email) => email.id))),
			"* n": () => select(new Set()),
		},
		emails.length > 0,
	);

	return (
		<>
			<h1 className="sr-only">{title}</h1>
			<MessageListToolbar
				emails={emails}
				chosen={chosen}
				onSelect={(next) => select(new Set(next))}
				isUnread={hasUnread}
				actions={deeds}
				all={allChosen}
				// A search over several places has no one answer to "out of the inbox".
				moveToLabel={!allChosen || everything?.filter.folder !== undefined}
				folder={folder}
				page={page}
				setPage={setPage}
				pageSize={pageSize}
				totalCount={totalCount}
				isRefreshing={isRefreshing}
				onRefresh={onRefresh}
			/>

			{everything && (progress !== null || (wholePage && totalCount > emails.length)) && (
				<SelectEverything
					offer={everything.offer}
					chosen={everything.chosen}
					all={allChosen}
					progress={progress}
					onAll={() => setAll(true)}
					onClear={() => select(new Set())}
				/>
			)}

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
							// biome-ignore lint/a11y/noStaticElementInteractions: the menu of the line; the keyboard reaches it through the menu key on the line's button
							<div
								key={email.id}
								draggable
								onDragStart={(event) => {
									// A line of a selection takes the selection with it.
									const taken = isSelected && chosen.length > 1 ? chosen : [email];
									useUIStore.setState({ dragged: taken });
									event.dataTransfer.setData(DRAG_TYPE, String(taken.length));
									event.dataTransfer.effectAllowed = "move";
								}}
								onDragEnd={() => useUIStore.setState({ dragged: [] })}
								// Whether Shift is held for the box this click or key ticks: Kumo's box takes no click
								// handler of its own, so the line reads it on the way down.
								onClickCapture={(event) => {
									withShift.current = event.shiftKey;
								}}
								onKeyDownCapture={(event) => {
									withShift.current = event.shiftKey;
								}}
								onContextMenu={(event) => {
									event.preventDefault();
									setMenu({ email, at: { x: event.clientX, y: event.clientY } });
								}}
								className={`group flex items-center gap-2 border-b border-l-2 border-b-kumo-line px-2.5 text-sm hover:relative hover:z-[1] hover:shadow-[0_1px_3px_rgb(0_0_0/0.18)] ${LINE[density]} ${
									index === cursor ? "border-l-kumo-brand" : "border-l-transparent"
								} ${tone}`}
							>
								<Checkbox
									aria-label={t('Select the conversation "{subject}"', {
										subject: email.subject || t("(no subject)"),
									})}
									className="mx-1 shrink-0"
									checked={isSelected}
									onCheckedChange={() => toggle(email.id)}
								/>
								<Button
									variant="ghost"
									shape="square"
									size="sm"
									aria-label={email.starred ? t("Unstar") : t("Star")}
									aria-pressed={email.starred}
									className={`shrink-0 ${
										email.starred ? "text-kumo-warning" : "text-kumo-subtle hover:text-kumo-warning"
									}`}
									icon={<StarIcon size={16} weight={email.starred ? "fill" : "regular"} />}
									onClick={() => actions.star(email)}
								/>

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
											<span className="shrink-0 text-xs font-medium text-kumo-danger">
												{t("Draft")}
											</span>
										)}
										{/* A message that came back unsent, with the reason inside (ADR-0016). */}
										{email.submission?.state === "failed" && (
											<span className="shrink-0 text-xs font-medium text-kumo-danger">
												{t("Not sent")}
											</span>
										)}
									</span>
									<span className="block truncate @2xl:flex-1">
										{showFolder && place && (
											<Badge variant="outline" className="mr-2 align-middle">
												{placeName(place)}
											</Badge>
										)}
										<span className="mr-1.5 inline-flex gap-1 align-middle empty:hidden">
											<LabelChips ids={email.labels} labels={actions.labels} max={3} />
										</span>
										<span
											className={unread ? "font-semibold text-kumo-default" : "text-kumo-default"}
										>
											{mark(email.subject || t("(no subject)"))}
										</span>
										{showSnippets && snippet && (
											<span className="text-kumo-subtle"> — {mark(snippet)}</span>
										)}
									</span>
								</button>

								{email.needs_reply && !email.has_draft && (
									<Tooltip content={t("Needs a reply")} asChild>
										<span className="shrink-0 text-kumo-warning">
											<ArrowBendUpLeftIcon size={14} weight="bold" />
										</span>
									</Tooltip>
								)}
								<span
									className={`w-16 shrink-0 text-right text-xs ${
										showActions ? "group-hover:hidden group-focus-within:hidden" : ""
									} ${unread ? "font-semibold text-kumo-default" : "text-kumo-subtle"}`}
								>
									{formatListDate(email.date, dateLanguage())}
								</span>
								<span
									className={`hidden shrink-0 items-center ${
										showActions ? "group-hover:flex group-focus-within:flex" : ""
									}`}
								>
									{folder !== Folders.ARCHIVE && !actions.fromSent && (
										<IconButton
											label={t("Archive")}
											icon={<ArchiveIcon size={16} />}
											onClick={() => actions.archive([email])}
										/>
									)}
									<IconButton
										label={actions.inTrash ? t("Delete forever") : t("Delete")}
										icon={<TrashIcon size={16} />}
										onClick={() => void actions.remove([email])}
									/>
									<IconButton
										label={unread ? t("Mark as read") : t("Mark as unread")}
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

			{menu && (
				<ConversationMenu
					at={menu.at}
					email={menu.email}
					targets={selected.has(menu.email.id) && chosen.length > 1 ? chosen : [menu.email]}
					unread={hasUnread(menu.email)}
					folder={folder}
					actions={selected.has(menu.email.id) && allChosen ? forAll : actions}
					onClose={() => setMenu(null)}
					onOpen={() => open(menu.email)}
					onAnswer={(mode) => void answer(menu.email, mode)}
					onFindFromSender={() => {
						if (!mailboxId) return;
						void navigate({
							to: "/mailbox/$mailboxId/search",
							params: { mailboxId },
							search: { q: `from:${menu.email.sender}` },
						});
					}}
					href={`${window.location.pathname}?${new URLSearchParams({
						...Object.fromEntries(new URLSearchParams(window.location.search)),
						open: menu.email.id,
					})}`}
				/>
			)}
		</>
	);
}
