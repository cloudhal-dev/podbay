// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { useEffect, useRef } from "react";
import { Folders } from "shared/folders";
import { useDisplay } from "~/hooks/useDisplay";
import { useUIStore } from "~/hooks/useUIStore";
import { useEmails } from "~/queries/emails";

/**
 * Says so when mail arrives, with a notification of this device, for a person who asked for it
 * in the settings and whose browser allows it. It looks at the top of the inbox as often as the
 * list does and announces what is unread and was not there before. It shows who wrote and the
 * subject, nothing of the message itself, and nothing at all for what was already there when it
 * started.
 */
export default function NewMailNotifier({ mailboxId }: { mailboxId: string | undefined }) {
	const wanted = useDisplay((state) => state.notifications);
	const allowed =
		wanted && typeof Notification !== "undefined" && Notification.permission === "granted";
	const { data } = useEmails(
		mailboxId,
		{ folder: Folders.INBOX, page: "1", limit: "10" },
		{ enabled: allowed, refetchInterval: 30_000 },
	);
	/** What has been seen at the top of the inbox; `null` until the first look. */
	const seen = useRef<Set<string> | null>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: another mailbox starts afresh
	useEffect(() => {
		seen.current = null;
	}, [mailboxId]);

	useEffect(() => {
		if (!allowed || !data) return;
		const known = seen.current;
		seen.current = new Set(data.emails.map((email) => email.id));
		if (known === null) return;
		for (const email of data.emails) {
			if (known.has(email.id) || email.read) continue;
			const note = new Notification(email.sender, {
				body: email.subject || "(no subject)",
				tag: email.id,
			});
			note.onclick = () => {
				window.focus();
				useUIStore.getState().selectEmail(email.id);
				note.close();
			};
		}
	}, [allowed, data]);

	return null;
}
