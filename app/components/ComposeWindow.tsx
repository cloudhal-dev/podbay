// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { Button } from "@cloudflare/kumo";
import {
	ArrowsInSimpleIcon,
	ArrowsOutSimpleIcon,
	CaretUpIcon,
	MinusIcon,
	XIcon,
} from "@phosphor-icons/react";
import { type ReactNode, useEffect, useState } from "react";
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

const FRAME =
	"fixed z-40 flex flex-col overflow-hidden border-kumo-line bg-kumo-base shadow-[0_8px_30px_rgb(0_0_0/0.28)] print:hidden";
const SIZES = {
	minimised: "bottom-0 right-4 w-72 rounded-t-xl border border-b-0 md:right-16",
	normal:
		"inset-0 md:inset-auto md:bottom-0 md:right-16 md:h-[min(620px,calc(100dvh-5rem))] md:w-[600px] md:rounded-t-2xl md:border md:border-b-0",
	large:
		"inset-0 md:inset-x-0 md:top-auto md:bottom-0 md:mx-auto md:h-[calc(100dvh-4rem)] md:w-[min(960px,calc(100vw-4rem))] md:rounded-t-2xl md:border md:border-b-0",
};

function TitleButton({
	label,
	onClick,
	children,
	className = "",
}: {
	label: string;
	onClick: () => void;
	children: ReactNode;
	className?: string;
}) {
	// Kumo's square button at its default size, 36 px in the 40 px bar, a larger target than the
	// 28 px it was; under the pointer it takes the fill it had, as the bar is Kumo's tint already.
	return (
		<Button
			variant="ghost"
			shape="square"
			onClick={onClick}
			aria-label={label}
			title={label}
			className={`text-kumo-strong hover:bg-kumo-fill ${className}`}
			icon={children}
		/>
	);
}

/**
 * The compose window: it floats at the bottom of the screen over whatever is being read, can be
 * minimised to its title bar, made larger, and fills the screen on a phone. Closing it keeps what
 * was written as a draft; only Discard throws it away.
 */
export default function ComposeWindow() {
	const { isComposing, composePlacement } = useUIStore();
	const form = useCompose();
	// An answer being written under its conversation is shown there, not here; and a message is
	// drawn only on its own mailbox's pages (#113).
	if (!isComposing || composePlacement === "inline" || !form.belongsHere) return null;
	return <OpenComposeWindow />;
}

function OpenComposeWindow() {
	const { composeOptions } = useUIStore();
	const form = useCompose();
	const [size, setSize] = useState<keyof typeof SIZES>("normal");
	const minimised = size === "minimised";
	const title = form.isDraftEdit ? t("Draft") : t(TITLES[composeOptions.mode]);

	// A new message or reply always opens at its usual size.
	// biome-ignore lint/correctness/useExhaustiveDependencies: what is being written is the trigger
	useEffect(() => setSize("normal"), [composeOptions]);

	return (
		<section aria-label={t("Compose")} className={`${FRAME} ${SIZES[size]}`}>
			<div className="flex h-10 shrink-0 items-center gap-0.5 bg-kumo-tint pl-4 pr-2">
				<h2 className="m-0 min-w-0 flex-1 truncate text-sm font-medium text-kumo-default">
					{form.subject.trim() || title}
				</h2>
				{minimised ? (
					<TitleButton label={t("Restore the compose window")} onClick={() => setSize("normal")}>
						<CaretUpIcon size={16} />
					</TitleButton>
				) : (
					<>
						<TitleButton
							label={t("Minimise the compose window")}
							onClick={() => setSize("minimised")}
							className="hidden md:flex"
						>
							<MinusIcon size={16} />
						</TitleButton>
						<TitleButton
							label={
								size === "large"
									? t("Make the compose window smaller")
									: t("Make the compose window larger")
							}
							onClick={() => setSize(size === "large" ? "normal" : "large")}
							className="hidden md:flex"
						>
							{size === "large" ? (
								<ArrowsInSimpleIcon size={16} />
							) : (
								<ArrowsOutSimpleIcon size={16} />
							)}
						</TitleButton>
					</>
				)}
				<TitleButton label={t("Save and close")} onClick={() => void form.saveAndClose()}>
					<XIcon size={16} />
				</TitleButton>
			</div>
			{/* Hidden, not unmounted, so what was written stays as it is */}
			<div className={minimised ? "hidden" : "flex min-h-0 flex-1 flex-col"}>
				<ComposePanel form={form} />
			</div>
		</section>
	);
}
