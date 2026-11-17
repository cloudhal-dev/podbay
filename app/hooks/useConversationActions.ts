// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { useKumoToastManager } from "@cloudflare/kumo";
import { Folders, getFolderDisplayName } from "shared/folders";
import { useConfirm } from "~/components/Confirm";
import { useDeleteEmail, useMoveEmail, useUpdateEmail } from "~/queries/emails";
import { useFolders } from "~/queries/folders";
import type { Email, Folder } from "~/types";

/** Only a real send fills Sent, and drafts are made by writing: neither is a place to move mail to. */
const NOT_A_MOVE_TARGET: readonly string[] = [Folders.SENT, Folders.DRAFT];

const plural = (count: number) => (count === 1 ? "Conversation" : `${count} conversations`);

/**
 * What can be done to conversations, the same from the list and from an open conversation.
 * Every move says what happened and offers to take it back; Delete means Trash, and only inside
 * Trash is a message deleted for good, after asking.
 */
export function useConversationActions(mailboxId: string | undefined, folder?: string) {
	const toasts = useKumoToastManager();
	const confirm = useConfirm();
	const updateEmail = useUpdateEmail();
	const moveEmail = useMoveEmail();
	const deleteEmail = useDeleteEmail();
	const { data: folders = [] } = useFolders(mailboxId) as { data?: Folder[] };

	const inTrash = folder === Folders.TRASH;
	const moveTargets = folders.filter(
		(target) => target.id !== folder && !NOT_A_MOVE_TARGET.includes(target.id),
	);

	function moveTo(list: Email[], target: string, said?: string): boolean {
		if (!mailboxId || list.length === 0) return false;
		const before = list.map((email) => ({ id: email.id, folderId: email.folder_id || folder }));
		for (const email of list) moveEmail.mutate({ mailboxId, id: email.id, folderId: target });
		const name = folders.find((f) => f.id === target)?.name ?? getFolderDisplayName(target);
		const toast: string = toasts.add({
			title: `${plural(list.length)} ${said ?? `moved to ${name}`}`,
			actions: [
				{
					children: "Undo",
					variant: "ghost",
					onClick: () => {
						for (const was of before) {
							if (was.folderId) {
								moveEmail.mutate({ mailboxId, id: was.id, folderId: was.folderId });
							}
						}
						toasts.close(toast);
					},
				},
			],
		});
		return true;
	}

	/** Moves to Trash, or inside Trash deletes for good after asking. Resolves to whether it did. */
	async function remove(list: Email[]): Promise<boolean> {
		if (!mailboxId || list.length === 0) return false;
		if (!inTrash) return moveTo(list, Folders.TRASH, "moved to Trash");
		const one = list.length === 1;
		const sure = await confirm({
			title: one
				? "Delete this conversation forever?"
				: `Delete ${list.length} conversations forever?`,
			body: one
				? "It will be gone from this mailbox for good. This cannot be undone."
				: "They will be gone from this mailbox for good. This cannot be undone.",
			action: "Delete forever",
			destructive: true,
		});
		if (!sure) return false;
		for (const email of list) deleteEmail.mutate({ mailboxId, id: email.id });
		toasts.add({ title: `${plural(list.length)} deleted forever` });
		return true;
	}

	return {
		inTrash,
		/** Folders a conversation on screen can be moved to. */
		moveTargets,
		moveTo,
		remove,
		archive: (list: Email[]) => moveTo(list, Folders.ARCHIVE, "archived"),
		reportSpam: (list: Email[]) => moveTo(list, Folders.SPAM, "marked as spam"),
		notSpam: (list: Email[]) => moveTo(list, Folders.INBOX, "moved to Inbox"),
		setRead(list: Email[], read: boolean) {
			if (!mailboxId) return;
			for (const email of list) updateEmail.mutate({ mailboxId, id: email.id, data: { read } });
		},
		star(email: Email) {
			if (!mailboxId) return;
			updateEmail.mutate({ mailboxId, id: email.id, data: { starred: !email.starred } });
		},
	};
}

export type ConversationActions = ReturnType<typeof useConversationActions>;
