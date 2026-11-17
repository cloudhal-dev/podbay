// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { Folders } from "shared/folders";
import { useDisplay } from "~/hooks/useDisplay";
import { newMailKey, useLiveConnected } from "~/hooks/useLive";
import { useUIStore } from "~/hooks/useUIStore";
import { t } from "~/i18n";
import { LIVE_TIMING } from "~/lib/live";
import api from "~/services/api";
import type { Email } from "~/types";

/**
 * Says so when mail arrives, with a notification of this device, for a person who asked for it
 * in the settings and whose browser allows it. It announces what is unread at the top of the
 * inbox and was not there before. It shows who wrote and the subject, nothing of the message
 * itself, and nothing at all for what was already there when it started.
 *
 * The mailbox says when mail arrived (ADR-0013, decision 17): the notifier then asks once for
 * the top of the inbox, and for nothing else does it ask again. The connection carries no
 * mail, so who wrote and the subject come from that ordinary request. While nothing is
 * telling this tab, it looks every half minute as it did before.
 */
export default function NewMailNotifier({ mailboxId }: { mailboxId: string | undefined }) {
	const wanted = useDisplay((state) => state.notifications);
	const allowed =
		wanted && typeof Notification !== "undefined" && Notification.permission === "granted";
	const connected = useLiveConnected(mailboxId);
	const { data } = useQuery<Email[]>({
		// A key of its own: a move or a label read again by the lists is no reason to look.
		queryKey: mailboxId ? newMailKey(mailboxId) : ["new-mail", "_disabled"],
		queryFn: async () => {
			const top = await api.listEmails(mailboxId ?? "", {
				folder: Folders.INBOX,
				page: "1",
				limit: "10",
				threaded: "true",
			});
			return Array.isArray(top) ? top : (top.emails ?? []);
		},
		enabled: allowed && !!mailboxId,
		refetchInterval: connected ? false : LIVE_TIMING.askEveryMs,
	});
	/** What has been seen at the top of the inbox; `null` until the first look. */
	const seen = useRef<Set<string> | null>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: another mailbox starts afresh
	useEffect(() => {
		seen.current = null;
	}, [mailboxId]);

	useEffect(() => {
		if (!allowed || !data) return;
		const known = seen.current;
		seen.current = new Set(data.map((email) => email.id));
		if (known === null) return;
		for (const email of data) {
			if (known.has(email.id) || email.read) continue;
			const note = new Notification(email.sender, {
				body: email.subject || t("(no subject)"),
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
