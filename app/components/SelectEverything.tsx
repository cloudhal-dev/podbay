// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { Button } from "@cloudflare/kumo";
import type { Progress } from "~/hooks/useConversationActions";
import { plural, t } from "~/i18n";

/**
 * The line above a list once a whole page is ticked (ADR-0014): it offers every conversation
 * of the place or the search, says when all of them are chosen, and while a deed on them runs
 * says how far it is. Leaving the page stops the deed where it is; what was done stays done.
 */
export default function SelectEverything({
	offer,
	chosen,
	all,
	progress,
	onAll,
	onClear,
}: {
	/** The words on the button that chooses everything: "Select everything in Inbox". */
	offer: string;
	/** What is said once everything is chosen. */
	chosen: string;
	/** Whether everything is chosen, and not only the page. */
	all: boolean;
	progress: Progress | null;
	onAll: () => void;
	onClear: () => void;
}) {
	return (
		<div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-kumo-line bg-kumo-recessed/60 px-4 py-2 text-xs text-kumo-subtle print:hidden">
			{progress !== null ? (
				<span role="status">
					{progress.total === null
						? plural(
								progress.done,
								"Putting back: {count} message so far",
								"Putting back: {count} messages so far",
							)
						: t(
								"{done} of {total} done so far. Leaving this page stops it where it is; what was done stays done.",
								{ done: progress.done, total: progress.total },
							)}
				</span>
			) : (
				<>
					<span role="status">{all ? chosen : t("Everything on this page is selected.")}</span>
					<Button variant="ghost" size="sm" onClick={all ? onClear : onAll}>
						{all ? t("Clear the selection") : offer}
					</Button>
				</>
			)}
		</div>
	);
}
