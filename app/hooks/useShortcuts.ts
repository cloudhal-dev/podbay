// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { useEffect, useRef } from "react";

/** A key (`c`, `#`, `Shift+I`) or two keys pressed one after the other (`g i`), and what it does. */
export type Shortcuts = Record<string, () => void>;

/** The shortcuts shown in the help dialog, in the order a reader looks for them. */
export const SHORTCUT_HELP: { keys: string; does: string }[] = [
	{ keys: "c", does: "Write a new message" },
	{ keys: "/", does: "Search" },
	{ keys: "j  /  k", does: "Next or previous conversation in the list" },
	{ keys: "o  or  Enter", does: "Open the conversation" },
	{ keys: "u", does: "Back to the list" },
	{ keys: "r  /  a  /  f", does: "Reply, reply to all or forward the open conversation" },
	{ keys: "x", does: "Select the conversation" },
	{ keys: "*  then  a  /  n", does: "Select all or none" },
	{ keys: "e", does: "Archive" },
	{ keys: "#", does: "Move to Trash" },
	{ keys: "!", does: "Report spam" },
	{ keys: "s", does: "Star or unstar" },
	{ keys: "Shift+I  /  Shift+U", does: "Mark as read or unread" },
	{ keys: "g  then  i", does: "Go to Inbox" },
	{ keys: "g  then  s", does: "Go to Starred" },
	{ keys: "g  then  t", does: "Go to Sent" },
	{ keys: "g  then  d", does: "Go to Drafts" },
	{ keys: "?", does: "Show this list" },
];

/**
 * A dialog, a confirmation or a menu is open: its keys are its own. A toast is announced as a
 * dialog that is not modal, and it must not silence the keyboard while it is on screen.
 */
const OPEN_LAYER =
	'[role="dialog"]:not([aria-modal="false"]), [role="alertdialog"]:not([aria-modal="false"]), [role="menu"]';

function isTyping(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	return (
		target.isContentEditable ||
		target.tagName === "INPUT" ||
		target.tagName === "TEXTAREA" ||
		target.tagName === "SELECT"
	);
}

/** How a key press is written in a shortcut map. */
export function shortcutName(event: Pick<KeyboardEvent, "key" | "shiftKey">): string {
	if (event.key.length === 1 && /[a-z]/i.test(event.key)) {
		return event.shiftKey ? `Shift+${event.key.toUpperCase()}` : event.key.toLowerCase();
	}
	return event.key;
}

/**
 * Single-key shortcuts for the mail screens. They never fire while the reader is typing, with a
 * modifier held, or while a dialog or a menu is open, so they cannot collide with writing a message.
 */
export function useShortcuts(shortcuts: Shortcuts, enabled = true): void {
	const latest = useRef(shortcuts);
	latest.current = shortcuts;

	useEffect(() => {
		if (!enabled) return;
		let prefix: string | null = null;
		let timer: ReturnType<typeof setTimeout> | undefined;

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.metaKey || event.ctrlKey || event.altKey) return;
			if (isTyping(event.target) || document.querySelector(OPEN_LAYER)) return;
			const name = shortcutName(event);
			const combined = prefix ? `${prefix} ${name}` : name;
			clearTimeout(timer);
			prefix = null;

			const action = latest.current[combined];
			if (action) {
				event.preventDefault();
				action();
				return;
			}
			// The first key of a sequence: wait a moment for the second.
			if (Object.keys(latest.current).some((keys) => keys.startsWith(`${name} `))) {
				prefix = name;
				timer = setTimeout(() => {
					prefix = null;
				}, 1200);
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => {
			clearTimeout(timer);
			window.removeEventListener("keydown", onKeyDown);
		};
	}, [enabled]);
}
