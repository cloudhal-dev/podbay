// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified by the Podbay contributors.

import { Outlet, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import AgentSidebar from "~/components/AgentSidebar";
import ComposeWindow from "~/components/ComposeWindow";
import Header, { SEARCH_INPUT_ID } from "~/components/Header";
import ShortcutHelp from "~/components/ShortcutHelp";
import Sidebar from "~/components/Sidebar";
import { useShortcuts } from "~/hooks/useShortcuts";
import { useUIStore } from "~/hooks/useUIStore";
import { useFeatures } from "~/queries/config";
import { useMailbox } from "~/queries/mailboxes";

/**
 * The frame of a mailbox: the top bar across the whole width, the rail on the left, the mail in
 * a rounded surface, the assistant on the right when it is on, and the compose window floating
 * over all of it.
 */
export default function MailboxRoute() {
	const { mailboxId } = useParams({ strict: false });
	const navigate = useNavigate();
	// Prefetch mailbox data for child components
	useMailbox(mailboxId);
	const enabled = useFeatures();
	const hasAssistant = enabled.agent || enabled.mcp;
	const prevMailboxIdRef = useRef<string | undefined>(undefined);
	const {
		isSidebarOpen,
		closeSidebar,
		isAgentPanelOpen,
		closePanel,
		closeCompose,
		startCompose,
		setShortcutHelpOpen,
	} = useUIStore();

	useEffect(() => {
		if (prevMailboxIdRef.current && mailboxId && prevMailboxIdRef.current !== mailboxId) {
			closePanel();
			closeCompose();
			closeSidebar();
		}

		prevMailboxIdRef.current = mailboxId;
	}, [mailboxId, closeCompose, closePanel, closeSidebar]);

	const goTo = (folder: string) => {
		if (mailboxId) {
			void navigate({ to: "/mailbox/$mailboxId/emails/$folder", params: { mailboxId, folder } });
		}
	};
	useShortcuts({
		c: () => startCompose(),
		"/": () => document.getElementById(SEARCH_INPUT_ID)?.focus(),
		"?": () => setShortcutHelpOpen(true),
		"g i": () => goTo("inbox"),
		"g t": () => goTo("sent"),
		"g d": () => goTo("draft"),
		"g s": () => {
			if (mailboxId) {
				void navigate({
					to: "/mailbox/$mailboxId/search",
					params: { mailboxId },
					search: { q: "is:starred" },
				});
			}
		},
	});

	return (
		<div className="flex h-screen flex-col overflow-hidden bg-kumo-recessed">
			<Header />
			<div className="flex min-h-0 flex-1">
				{/* Phone: the rail slides over the list */}
				{isSidebarOpen && (
					<div
						className="fixed inset-0 z-30 bg-black/30 md:hidden"
						onClick={closeSidebar}
						onKeyDown={(e) => e.key === "Escape" && closeSidebar()}
						role="button"
						tabIndex={-1}
						aria-label="Close sidebar"
					/>
				)}
				<div
					className={`fixed inset-y-0 left-0 z-40 transform transition-transform duration-200 ease-in-out md:relative md:z-0 md:translate-x-0 ${
						isSidebarOpen ? "translate-x-0" : "-translate-x-full"
					}`}
				>
					<Sidebar />
				</div>

				<main className="min-w-0 flex-1 overflow-hidden bg-kumo-base md:mb-2 md:mr-2 md:rounded-2xl md:border md:border-kumo-line">
					<Outlet />
				</main>

				{hasAssistant && isAgentPanelOpen && (
					<div className="hidden w-[380px] shrink-0 flex-col overflow-hidden bg-kumo-base lg:mb-2 lg:mr-2 lg:flex lg:rounded-2xl lg:border lg:border-kumo-line">
						<AgentSidebar />
					</div>
				)}
			</div>

			<ComposeWindow />
			<ShortcutHelp />
		</div>
	);
}
