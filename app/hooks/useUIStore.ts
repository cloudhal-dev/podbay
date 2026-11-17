// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified by the Podbay contributors.

import { create } from "zustand";
import type { Email } from "~/types";

export type ComposeMode = "new" | "reply" | "reply-all" | "forward";

export interface ComposeOptions {
	mode: ComposeMode;
	originalEmail?: Email | null;
	/** When editing a draft, this holds the draft email to pre-fill the composer */
	draftEmail?: Email | null;
	/** A new message that starts with a recipient and a subject (leaving a mailing list). */
	prefill?: { to: string; subject: string };
}

const RAIL_KEY = "podbay.rail";

/** Whether the reader left the rail collapsed last time. A convenience kept in this browser only. */
function railCollapsedBefore(): boolean {
	try {
		return window.localStorage.getItem(RAIL_KEY) === "collapsed";
	} catch {
		return false;
	}
}

function rememberRail(collapsed: boolean): void {
	try {
		window.localStorage.setItem(RAIL_KEY, collapsed ? "collapsed" : "open");
	} catch {
		// Private windows and blocked storage: the rail simply opens expanded next time.
	}
}

interface UIState {
	/** The open conversation. The address bar is the truth (`?open=`); `MailView` keeps the two in step. */
	selectedEmailId: string | null;
	/** Takes back the last move, while its note is on screen. */
	lastUndo: (() => void) | null;
	/** The conversations being dragged from a list, until they are dropped or let go. */
	dragged: Email[];
	/** Whether the compose window is open. It floats over whatever is on screen. */
	isComposing: boolean;
	selectEmail: (id: string | null) => void;
	/** Where the message being written is shown: the floating window, or under the conversation. */
	composePlacement: "window" | "inline";
	startCompose: (options?: ComposeOptions, placement?: "window" | "inline") => void;
	/** Close the open conversation and go back to the list. */
	closePanel: () => void;
	closeCompose: () => void;

	// Compose options
	composeOptions: ComposeOptions;

	// The rail: an overlay on a phone, collapsible to icons on a wide screen
	isSidebarOpen: boolean;
	openSidebar: () => void;
	closeSidebar: () => void;
	toggleSidebar: () => void;
	isRailCollapsed: boolean;
	toggleRail: () => void;

	// Keyboard shortcut help
	isShortcutHelpOpen: boolean;
	setShortcutHelpOpen: (open: boolean) => void;

	// Agent panel
	isAgentPanelOpen: boolean;
	toggleAgentPanel: () => void;
}

export const useUIStore = create<UIState>((set, get) => ({
	selectedEmailId: null,
	isComposing: false,
	lastUndo: null,
	dragged: [],
	composePlacement: "window",
	composeOptions: { mode: "new", originalEmail: null },
	isSidebarOpen: false,
	isRailCollapsed: railCollapsedBefore(),
	isShortcutHelpOpen: false,
	isAgentPanelOpen: true,

	selectEmail: (id) => set({ selectedEmailId: id }),

	// Writing a message never closes what is being read: the window floats above it.
	startCompose: (options, placement = "window") =>
		set({
			isComposing: true,
			composePlacement: placement,
			composeOptions: options || { mode: "new", originalEmail: null },
			isSidebarOpen: false,
		}),

	closePanel: () => set({ selectedEmailId: null }),

	closeCompose: () =>
		set({ isComposing: false, composeOptions: { mode: "new" as const, originalEmail: null } }),

	openSidebar: () => set({ isSidebarOpen: true }),
	closeSidebar: () => set({ isSidebarOpen: false }),
	toggleSidebar: () => set({ isSidebarOpen: !get().isSidebarOpen }),
	toggleRail: () => {
		const collapsed = !get().isRailCollapsed;
		rememberRail(collapsed);
		set({ isRailCollapsed: collapsed });
	},

	setShortcutHelpOpen: (open) => set({ isShortcutHelpOpen: open }),

	toggleAgentPanel: () => set({ isAgentPanelOpen: !get().isAgentPanelOpen }),
}));
