// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";
import type { LiveKind } from "shared/live";
import {
	holdLive,
	isLiveConnected,
	LIVE_TIMING,
	LiveConnection,
	liveUrl,
	onLiveConnected,
	setLiveConnected,
} from "~/lib/live";
import { queryKeys } from "~/queries/keys";

/** The key of the notifier's look at the top of the inbox. Only new mail makes it look again. */
export const newMailKey = (mailboxId: string) => ["new-mail", mailboxId] as const;

/**
 * Reads again what a kind of change can have touched. The connection said only that something
 * changed; what changed comes from the same requests as ever, with the same rights.
 */
export function refetchMoved(client: QueryClient, mailboxId: string, kinds: LiveKind[]): void {
	const invalidate = (queryKey: readonly unknown[]) => void client.invalidateQueries({ queryKey });
	if (kinds.includes("mail") || kinds.includes("labels")) {
		// A list shows its conversations' labels, and a label counts its conversations.
		invalidate(["emails", mailboxId]);
		invalidate(["search", mailboxId]);
		invalidate(queryKeys.folders.list(mailboxId));
		invalidate(queryKeys.labels.list(mailboxId));
	}
	if (kinds.includes("settings")) {
		invalidate(queryKeys.mailboxes.all);
		invalidate(queryKeys.mailboxes.detail(mailboxId));
	}
	// A notification of the device is raised from this and from nothing else.
	if (kinds.includes("delivery")) invalidate(newMailKey(mailboxId));
}

/**
 * Keeps one connection to the mailbox on screen for as long as the tab shows it, seen or not
 * (ADR-0013, decision 15). Mounted once, by the frame of a mailbox.
 */
export function useLive(mailboxId: string | undefined): void {
	const client = useQueryClient();
	useEffect(() => {
		if (!mailboxId || typeof WebSocket === "undefined") return;
		const connection = new LiveConnection({
			url: liveUrl(mailboxId, window.location),
			open: (url) => new WebSocket(url),
			onMoved: (kinds) => refetchMoved(client, mailboxId, kinds),
			onConnected: (connected) => setLiveConnected(mailboxId, connected),
		});
		const release = holdLive(connection);
		// A browser whose content policy does not let the page reach its own host over a
		// WebSocket says so here. The policy is not widened: this tab goes on asking.
		const refused = (event: SecurityPolicyViolationEvent) => {
			if (event.effectiveDirective === "connect-src" && /^wss?:/.test(event.blockedURI)) {
				connection.stop();
			}
		};
		document.addEventListener("securitypolicyviolation", refused);
		connection.start();
		return () => {
			document.removeEventListener("securitypolicyviolation", refused);
			release();
		};
	}, [mailboxId, client]);
}

/** Whether the mailbox is telling this tab what changes. */
export function useLiveConnected(mailboxId: string | undefined): boolean {
	return useSyncExternalStore(onLiveConnected, () => isLiveConnected(mailboxId));
}

/**
 * How often a list asks by itself: every half minute without a connection, as before, and
 * every five minutes with one, as a net under a signal that was lost (decision 16).
 */
export function useAskEvery(mailboxId: string | undefined): number {
	return useLiveConnected(mailboxId) ? LIVE_TIMING.askEveryConnectedMs : LIVE_TIMING.askEveryMs;
}
