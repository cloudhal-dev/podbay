// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { Button } from "@cloudflare/kumo";
import { ArrowSquareOutIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useRef } from "react";
import { useAnswerFollowsToWindow } from "~/hooks/useAnswerFollowsToWindow";
import { useUIStore } from "~/hooks/useUIStore";
import { m, t } from "~/i18n";
import ComposePanel from "./ComposePanel";
import { useCompose } from "./ComposeSession";

const TITLES = {
	new: m("New message"),
	reply: m("Reply"),
	"reply-all": m("Reply to all"),
	forward: m("Forward"),
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

	// The conversation left with the answer still open: it goes on in the window.
	useAnswerFollowsToWindow();
	useEffect(() => {
		card.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
	}, []);

	return (
		<section
			ref={card}
			aria-label={t("Compose")}
			className="mx-4 my-5 flex h-[440px] flex-col overflow-hidden rounded-2xl border border-kumo-line shadow-sm md:mx-6 print:hidden"
		>
			<div className="flex h-10 shrink-0 items-center gap-0.5 bg-kumo-tint pl-4 pr-2">
				<h2 className="m-0 min-w-0 flex-1 truncate text-sm font-medium text-kumo-default">
					{t(TITLES[mode])}
				</h2>
				{/* Kumo's square buttons at the default size, 36 px in the 40 px bar, as the writing
				    window's title bar has; under the pointer they take the fill they had. */}
				<Button
					variant="ghost"
					shape="square"
					onClick={() => useUIStore.setState({ composePlacement: "window" })}
					aria-label={t("Open in a window")}
					title={t("Open in a window")}
					className="text-kumo-strong hover:bg-kumo-fill"
					icon={<ArrowSquareOutIcon size={16} />}
				/>
				<Button
					variant="ghost"
					shape="square"
					onClick={() => void form.saveAndClose()}
					aria-label={t("Save and close")}
					title={t("Save and close")}
					className="text-kumo-strong hover:bg-kumo-fill"
					icon={<XIcon size={16} />}
				/>
			</div>
			<ComposePanel form={form} />
		</section>
	);
}
