// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { useUIStore } from "~/hooks/useUIStore";
import { useMarkThreadRead, useUpdateEmail } from "~/queries/emails";
import type { Email } from "~/types";

/** Whether a line in a list still has something unread in it. */
export const hasUnread = (email: Email): boolean =>
	email.thread_unread_count !== undefined ? email.thread_unread_count > 0 : !email.read;

/**
 * Opening a conversation from a list shows it and marks it read, the whole thread when it is one.
 * The list and the newer and older buttons of an open conversation open it the same way.
 */
export function useOpenConversation(mailboxId: string | undefined): (email: Email) => void {
	const selectEmail = useUIStore((state) => state.selectEmail);
	const updateEmail = useUpdateEmail();
	const markThreadRead = useMarkThreadRead();

	return (email) => {
		selectEmail(email.id);
		if (!mailboxId || !hasUnread(email)) return;
		if (email.thread_id && (email.thread_count ?? 1) > 1) {
			markThreadRead.mutate({ mailboxId, threadId: email.thread_id });
		} else {
			updateEmail.mutate({ mailboxId, id: email.id, data: { read: true } });
		}
	};
}
