// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { Button, useKumoToastManager } from "@cloudflare/kumo";
import { Folders } from "@podbay/mail/shared";
import { useState } from "react";
import { useConfirm } from "~/components/Confirm";
import { useDisplay } from "~/hooks/useDisplay";
import { useUIStore } from "~/hooks/useUIStore";
import { plural, t } from "~/i18n";
import { useInvalidateEmailData } from "~/queries/emails";
import api from "~/services/api";

/** A place is emptied in batches; this many calls is far more than any mailbox needs. */
const MOST_CALLS = 2000;

/**
 * The line above Trash and Spam: how much is there, and one button that deletes all of it for
 * good (ADR-0009). It asks first and says how much goes. The mailbox deletes in batches, so the
 * line says how far it is; leaving the page stops it where it is, and what was deleted stays
 * deleted.
 */
export default function EmptyPlace({
	mailboxId,
	place,
	count,
}: {
	mailboxId: string;
	place: string | undefined;
	/** The lines of the list: conversations, or messages when conversations are off. */
	count: number;
}) {
	const confirm = useConfirm();
	const toasts = useKumoToastManager();
	const invalidate = useInvalidateEmailData();
	const conversations = useDisplay((state) => state.conversationView);
	const [gone, setGone] = useState<number | null>(null);

	const trash = place === Folders.TRASH;
	if ((!trash && place !== Folders.SPAM) || count === 0) return null;

	const holds = conversations
		? plural(count, "{count} conversation", "{count} conversations")
		: plural(count, "{count} message", "{count} messages");

	async function empty() {
		const sure = await confirm({
			title: trash ? t("Empty Trash?") : t("Delete all spam?"),
			body: t("{holds} will be deleted for good, with every file in them. This cannot be undone.", {
				holds,
			}),
			action: trash ? t("Empty Trash") : t("Delete all spam"),
			destructive: true,
		});
		if (!sure || !place) return;
		setGone(0);
		// A conversation of this place that is open would be read from under itself.
		useUIStore.getState().closePanel();
		try {
			let before: string | undefined;
			let deleted = 0;
			for (let call = 0; call < MOST_CALLS; call++) {
				const answer = await api.emptyPlace(mailboxId, place, before);
				before = answer.before;
				deleted += answer.deleted;
				setGone(deleted);
				if (!answer.more) break;
			}
			toasts.add({ title: trash ? t("Trash is empty") : t("All spam is deleted") });
		} catch {
			toasts.add({
				title: t("Not everything could be deleted. What was deleted stays deleted."),
				variant: "error",
			});
		} finally {
			setGone(null);
			invalidate(mailboxId);
		}
	}

	return (
		<div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-kumo-line bg-kumo-recessed/60 px-4 py-2 text-xs text-kumo-subtle print:hidden">
			{gone === null ? (
				<>
					<span>
						{trash
							? t("{holds} in Trash. Nothing here is deleted by itself.", { holds })
							: t("{holds} in Spam. Nothing here is deleted by itself.", { holds })}
					</span>
					<Button variant="ghost" size="sm" onClick={() => void empty()}>
						{trash ? t("Empty Trash now") : t("Delete all spam now")}
					</Button>
				</>
			) : (
				<span role="status">
					{plural(gone, "Deleting: {count} message so far", "Deleting: {count} messages so far")}
				</span>
			)}
		</div>
	);
}
