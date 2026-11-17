// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified by the Podbay contributors.

import { useNavigate, useSearch } from "@tanstack/react-router";
import { type ReactNode, useEffect, useRef } from "react";
import EmailPanel from "~/components/EmailPanel";
import { useShortcuts } from "~/hooks/useShortcuts";
import { useUIStore } from "~/hooks/useUIStore";

/**
 * The main area of a mailbox: the list, or the conversation that was opened from it, never both.
 * Opening a conversation is a navigation (`?open=<id>`), so the browser's Back returns to the
 * list and a conversation can be reloaded or bookmarked.
 *
 * The address is the truth. Code that opens or closes a conversation through the store (a row,
 * the toolbar's back arrow, a move or a delete) is followed here by a navigation.
 */
export default function MailView({ children }: { children: ReactNode }) {
	const search = useSearch({ strict: false }) as { open?: string };
	const navigate = useNavigate();
	const open = search.open;
	const selectedEmailId = useUIStore((state) => state.selectedEmailId);
	const inStep = useRef<string | null>(null);

	useEffect(() => {
		inStep.current = open ?? null;
		useUIStore.setState({ selectedEmailId: open ?? null });
	}, [open]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: `selectedEmailId` is the trigger; the live value is read from the store
	useEffect(() => {
		const wanted = useUIStore.getState().selectedEmailId;
		if (wanted === inStep.current) return;
		inStep.current = wanted;
		void navigate({
			to: ".",
			search: ((previous: Record<string, unknown>) => ({
				...previous,
				open: wanted ?? undefined,
			})) as never,
		});
	}, [selectedEmailId, navigate]);

	// `u` goes back to the list, as the toolbar's arrow does.
	useShortcuts({ u: () => useUIStore.getState().closePanel() }, open !== undefined);

	return (
		<div className="flex h-full flex-col min-w-0">
			{open ? <EmailPanel emailId={open} /> : children}
		</div>
	);
}
