// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { CaretUpIcon, MinusIcon, XIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { useUIStore } from "~/hooks/useUIStore";
import ComposePanel from "./ComposePanel";

const TITLES = {
	new: "New message",
	reply: "Reply",
	"reply-all": "Reply to all",
	forward: "Forward",
};

/**
 * The compose window: it floats at the bottom of the screen over whatever is being read, can be
 * minimised to its title bar and brought back, and fills the screen on a phone. The message being
 * written stays as it is while the window is minimised.
 */
export default function ComposeWindow() {
	const { isComposing, composeOptions, closeCompose } = useUIStore();
	const [minimised, setMinimised] = useState(false);
	if (!isComposing) return null;

	return (
		<section
			aria-label="Compose"
			className={
				minimised
					? "fixed bottom-0 right-4 z-40 w-72 rounded-t-xl border border-b-0 border-kumo-line bg-kumo-base shadow-2xl"
					: "fixed inset-0 z-40 flex flex-col bg-kumo-base md:inset-auto md:bottom-0 md:right-6 md:h-[min(640px,85vh)] md:w-[580px] md:rounded-t-xl md:border md:border-b-0 md:border-kumo-line md:shadow-2xl md:overflow-hidden"
			}
		>
			{minimised && (
				<div className="flex items-center gap-1 px-3 py-2">
					<button
						type="button"
						onClick={() => setMinimised(false)}
						className="flex-1 truncate bg-transparent border-0 p-0 text-left text-sm font-medium text-kumo-default cursor-pointer"
					>
						{TITLES[composeOptions.mode]}
					</button>
					<button
						type="button"
						onClick={() => setMinimised(false)}
						aria-label="Restore the compose window"
						className="rounded p-1 bg-transparent border-0 text-kumo-subtle hover:bg-kumo-tint cursor-pointer"
					>
						<CaretUpIcon size={16} />
					</button>
					<button
						type="button"
						onClick={closeCompose}
						aria-label="Close compose"
						className="rounded p-1 bg-transparent border-0 text-kumo-subtle hover:bg-kumo-tint cursor-pointer"
					>
						<XIcon size={16} />
					</button>
				</div>
			)}
			<div className={minimised ? "hidden" : "relative flex min-h-0 flex-1 flex-col"}>
				<button
					type="button"
					onClick={() => setMinimised(true)}
					aria-label="Minimise the compose window"
					className="absolute right-12 top-3 z-10 hidden rounded p-1 bg-transparent border-0 text-kumo-subtle hover:bg-kumo-tint cursor-pointer md:block"
				>
					<MinusIcon size={18} />
				</button>
				<ComposePanel />
			</div>
		</section>
	);
}
