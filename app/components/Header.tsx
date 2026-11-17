// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified by the Podbay contributors.

import { Button, Tooltip } from "@cloudflare/kumo";
import {
	GearSixIcon,
	KeyboardIcon,
	ListIcon,
	MagnifyingGlassIcon,
	RobotIcon,
	ShieldCheckIcon,
	SlidersIcon,
	XIcon,
} from "@phosphor-icons/react";
import { Link, useLocation, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { type KeyboardEvent, useEffect, useState } from "react";
import { useUIStore } from "~/hooks/useUIStore";
import { useFeatures } from "~/queries/config";
import DisplayMenu from "./DisplayMenu";
import SearchOptions from "./SearchOptions";

/** The id the `/` shortcut focuses. */
export const SEARCH_INPUT_ID = "mail-search";

/**
 * The top bar: the rail's toggle, the product, one wide search box, and the few things that are
 * about the whole mailbox rather than a message.
 */
export default function Header() {
	const [searchQuery, setSearchQuery] = useState("");
	const [optionsOpen, setOptionsOpen] = useState(false);
	const { mailboxId } = useParams({ strict: false });
	const navigate = useNavigate();
	const location = useLocation();
	const search = useSearch({ strict: false }) as { q?: string };
	const { toggleSidebar, toggleRail, toggleAgentPanel, isAgentPanelOpen, setShortcutHelpOpen } =
		useUIStore();
	const enabled = useFeatures();
	const hasAssistant = enabled.agent || enabled.mcp;
	const onSearchPage = location.pathname.includes("/search");

	// The box shows the search the page is showing.
	const urlQuery = search.q ?? "";
	useEffect(() => {
		setSearchQuery(onSearchPage ? urlQuery : "");
	}, [urlQuery, onSearchPage]);

	const toInbox = () => {
		if (mailboxId) {
			void navigate({
				to: "/mailbox/$mailboxId/emails/$folder",
				params: { mailboxId, folder: "inbox" },
			});
		}
	};

	const performSearch = (wanted = searchQuery) => {
		const q = wanted.trim();
		if (mailboxId && q) {
			void navigate({ to: "/mailbox/$mailboxId/search", params: { mailboxId }, search: { q } });
		}
	};

	const clearSearch = () => {
		setSearchQuery("");
		if (onSearchPage) toInbox();
	};

	const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Enter") performSearch();
		if (e.key === "Escape") {
			if (searchQuery) clearSearch();
			else e.currentTarget.blur();
		}
	};

	const isSettingsActive = location.pathname.includes("/settings");

	return (
		<header className="flex h-16 shrink-0 items-center gap-2 bg-kumo-recessed px-2 md:gap-3 md:px-3">
			{/* One button: slides the rail in on a phone, collapses it on a wide screen */}
			<Tooltip content="Main menu" side="bottom" asChild>
				<Button
					variant="ghost"
					shape="square"
					icon={<ListIcon size={20} />}
					onClick={() => {
						if (window.matchMedia("(min-width: 768px)").matches) toggleRail();
						else toggleSidebar();
					}}
					aria-label="Main menu"
					className="shrink-0"
				/>
			</Tooltip>
			<Link
				to="/"
				className="hidden shrink-0 pr-2 text-lg font-semibold text-kumo-default no-underline sm:block md:w-44"
			>
				Podbay
			</Link>

			<div className="relative flex min-w-0 flex-1 items-center md:max-w-2xl">
				<MagnifyingGlassIcon
					size={18}
					className="pointer-events-none absolute left-4 text-kumo-subtle"
				/>
				<input
					id={SEARCH_INPUT_ID}
					type="search"
					aria-label="Search emails"
					placeholder="Search mail"
					autoComplete="off"
					value={searchQuery}
					onChange={(e) => setSearchQuery(e.target.value)}
					onKeyDown={handleKeyDown}
					className="h-12 w-full rounded-full border border-transparent bg-kumo-fill pl-12 pr-20 text-sm text-kumo-default placeholder:text-kumo-subtle focus:border-kumo-line focus:bg-kumo-base focus:outline-none focus:ring-1 focus:ring-kumo-ring [&::-webkit-search-cancel-button]:hidden"
				/>
				{searchQuery && (
					<button
						type="button"
						onClick={clearSearch}
						className="absolute right-11 rounded-full p-1 bg-transparent border-0 text-kumo-subtle hover:bg-kumo-tint hover:text-kumo-default cursor-pointer"
						aria-label="Clear search"
					>
						<XIcon size={16} />
					</button>
				)}
				<button
					type="button"
					onClick={() => setOptionsOpen(true)}
					className="absolute right-3 rounded-full p-1.5 bg-transparent border-0 text-kumo-subtle hover:bg-kumo-tint hover:text-kumo-default cursor-pointer"
					aria-label="Search options"
					title="Search options"
				>
					<SlidersIcon size={16} />
				</button>
				<SearchOptions
					open={optionsOpen}
					onOpenChange={setOptionsOpen}
					mailboxId={mailboxId}
					query={searchQuery}
					onSearch={(built) => {
						setSearchQuery(built);
						performSearch(built);
					}}
				/>
			</div>

			<div className="ml-auto flex shrink-0 items-center gap-0.5">
				<Tooltip content="Keyboard shortcuts" side="bottom" asChild>
					<Button
						variant="ghost"
						shape="square"
						icon={<KeyboardIcon size={20} />}
						onClick={() => setShortcutHelpOpen(true)}
						aria-label="Keyboard shortcuts"
						className="hidden md:inline-flex"
					/>
				</Tooltip>
				<DisplayMenu />
				{hasAssistant && (
					<Tooltip
						content={isAgentPanelOpen ? "Hide agent panel" : "Show agent panel"}
						side="bottom"
						asChild
					>
						<Button
							variant={isAgentPanelOpen ? "secondary" : "ghost"}
							shape="square"
							icon={<RobotIcon size={20} />}
							onClick={toggleAgentPanel}
							aria-label="Toggle agent panel"
							className="hidden lg:inline-flex"
						/>
					</Tooltip>
				)}
				<Tooltip content="Settings" side="bottom" asChild>
					<Button
						variant={isSettingsActive ? "secondary" : "ghost"}
						shape="square"
						icon={<GearSixIcon size={20} />}
						onClick={() => {
							if (!mailboxId) return;
							if (isSettingsActive) toInbox();
							else void navigate({ to: "/mailbox/$mailboxId/settings", params: { mailboxId } });
						}}
						aria-label="Settings"
					/>
				</Tooltip>
				<Tooltip content="Sign-in and security" side="bottom" asChild>
					<Button
						variant="ghost"
						shape="square"
						icon={<ShieldCheckIcon size={20} />}
						onClick={() => void navigate({ to: "/account/security" })}
						aria-label="Sign-in and security"
					/>
				</Tooltip>
			</div>
		</header>
	);
}
