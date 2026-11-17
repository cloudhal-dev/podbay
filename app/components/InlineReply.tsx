// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { ArrowSquareOutIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useRef } from "react";
import { useUIStore } from "~/hooks/useUIStore";
import ComposePanel from "./ComposePanel";
import { useCompose } from "./ComposeSession";

const TITLES = {
	new: "New message",
	reply: "Reply",
	"reply-all": "Reply to all",
	forward: "Forward",
};

/**
 * An answer written where it belongs: under the conversation it answers. It can be moved out to
 * the floating window, and it moves there by itself when the conversation is left, so nothing
 * that was written is lost.
 */
export default function InlineReply() {
	const form = useCompose();
	const mode = useUIStore((state) => state.composeOptions.mode);
	const card = useRef<HTMLElement>(null);

	useEffect(() => {
		card.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
		return () => {
			// The conversation was left with the answer still open: it goes on in the window.
			const { isComposing, composePlacement } = useUIStore.getState();
			if (isComposing && composePlacement === "inline") {
				useUIStore.setState({ composePlacement: "window" });
			}
		};
	}, []);

	return (
		<section
			ref={card}
			aria-label="Compose"
			className="mx-4 my-5 flex h-[440px] flex-col overflow-hidden rounded-2xl border border-kumo-line shadow-sm md:mx-6 print:hidden"
		>
			<div className="flex h-10 shrink-0 items-center gap-0.5 bg-kumo-tint pl-4 pr-2">
				<h2 className="m-0 min-w-0 flex-1 truncate text-sm font-medium text-kumo-default">
					{TITLES[mode]}
				</h2>
				<button
					type="button"
					onClick={() => useUIStore.setState({ composePlacement: "window" })}
					aria-label="Open in a window"
					title="Open in a window"
					className="cursor-pointer rounded border-0 bg-transparent p-1.5 text-kumo-strong hover:bg-kumo-fill"
				>
					<ArrowSquareOutIcon size={16} />
				</button>
				<button
					type="button"
					onClick={() => void form.saveAndClose()}
					aria-label="Save and close"
					title="Save and close"
					className="cursor-pointer rounded border-0 bg-transparent p-1.5 text-kumo-strong hover:bg-kumo-fill"
				>
					<XIcon size={16} />
				</button>
			</div>
			<ComposePanel form={form} />
		</section>
	);
}
