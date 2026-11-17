// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified by the Podbay contributors.

import { EnvelopeSimpleOpenIcon } from "@phosphor-icons/react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { type ReactNode, useEffect, useRef } from "react";
import EmailPanel from "~/components/EmailPanel";
import { useSplit } from "~/hooks/useDisplay";
import { useShortcuts } from "~/hooks/useShortcuts";
import { useUIStore } from "~/hooks/useUIStore";
import type { Email } from "~/types";

/**
 * The main area of a mailbox. By default it is the list, or the conversation that was opened
 * from it, never both. When the reader chose the reading pane and the screen has room, the
 * conversation opens beside the list instead.
 *
 * Opening a conversation is a navigation (`?open=<id>`) either way, so the browser's Back
 * returns to the list and a conversation can be reloaded or bookmarked. The address is the
 * truth: code that opens or closes a conversation through the store (a row, the toolbar's back
 * arrow, a move or a delete) is followed here by a navigation.
 */
export default function MailView({
	children,
	emails = [],
}: {
	children: ReactNode;
	/** The conversations of the list on screen, so an open one can step to the next. */
	emails?: Email[];
}) {
	const search = useSearch({ strict: false }) as { open?: string };
	const navigate = useNavigate();
	const open = search.open;
	const selectedEmailId = useUIStore((state) => state.selectedEmailId);
	const inStep = useRef<string | null>(null);
	const split = useSplit();

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

	if (split) {
		return (
			<div className="flex h-full min-w-0 print:block print:h-auto">
				<div className="@container flex w-[38%] min-w-[360px] max-w-[520px] shrink-0 flex-col border-r border-kumo-line print:hidden">
					{children}
				</div>
				<div className="flex min-w-0 flex-1 flex-col print:block">
					{open ? (
						<EmailPanel emailId={open} inPane />
					) : (
						<div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
							<EnvelopeSimpleOpenIcon size={48} weight="thin" className="text-kumo-subtle" />
							<p className="text-sm text-kumo-subtle">No conversation is open.</p>
						</div>
					)}
				</div>
			</div>
		);
	}

	return (
		<div className="@container flex h-full min-w-0 flex-col print:block print:h-auto">
			{open ? <EmailPanel emailId={open} siblings={emails} /> : children}
		</div>
	);
}
