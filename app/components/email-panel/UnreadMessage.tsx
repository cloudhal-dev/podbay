// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { Button } from "@cloudflare/kumo";
import { CodeIcon, DownloadSimpleIcon } from "@phosphor-icons/react";
import { m, t } from "~/i18n";
import type { Email } from "~/types";

/** Why Podbay has nothing but the original of a message, in a sentence. */
const WHY: Record<NonNullable<Email["unparsed"]>, string> = {
	parser: m("It is built in a way Podbay does not read."),
	too_large: m("A part of it is too large for Podbay to keep as text."),
	interrupted: m("Podbay was stopped twice while reading it, and did not try again."),
};

/**
 * In place of the body of a message Podbay could not read (ADR-0015, decision 7). The message
 * is not lost: it is here with the bytes it arrived as, and this says so and offers them.
 */
export default function UnreadMessage({
	why,
	onShowOriginal,
	onDownloadOriginal,
}: {
	why: NonNullable<Email["unparsed"]>;
	onShowOriginal?: () => void;
	onDownloadOriginal?: () => void;
}) {
	return (
		<div role="note" className="rounded-lg border border-kumo-line bg-kumo-tint/40 p-4 text-sm">
			<p className="font-medium text-kumo-default">{t("Podbay could not read this message.")}</p>
			<p className="mt-1 text-kumo-subtle">{t(WHY[why])}</p>
			<p className="mt-1 text-kumo-subtle">
				{t("It is kept exactly as it arrived, and you can see or save that.")}
			</p>
			{onShowOriginal && onDownloadOriginal && (
				<div className="mt-3 flex flex-wrap gap-2 print:hidden">
					<Button
						variant="secondary"
						size="sm"
						icon={<CodeIcon size={14} />}
						onClick={onShowOriginal}
					>
						{t("Show original")}
					</Button>
					<Button
						variant="secondary"
						size="sm"
						icon={<DownloadSimpleIcon size={14} />}
						onClick={onDownloadOriginal}
					>
						{t("Download message")}
					</Button>
				</div>
			)}
		</div>
	);
}
