// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { useKumoToastManager } from "@cloudflare/kumo";
import { Folders } from "shared/folders";
import { useConfirm } from "~/components/Confirm";
import { useUIStore } from "~/hooks/useUIStore";
import { m, t } from "~/i18n";
import { placeName } from "~/lib/places";
import { useDeleteEmail, useMoveEmail, useUpdateEmail } from "~/queries/emails";
import { useFolders } from "~/queries/folders";
import { useLabelConversation, useLabels } from "~/queries/labels";
import type { Email, Folder, Label } from "~/types";

/** Only a real send fills Sent, and drafts are made by writing: neither is a place to move mail to. */
const NOT_A_MOVE_TARGET: readonly string[] = [Folders.SENT, Folders.DRAFT];

/** How long `z` can still take back the last move: about as long as its note is on screen. */
const UNDO_FOR_MS = 8000;

/** What was done to conversations, as the note says it. */
type Deed = "archived" | "trash" | "spam" | "inbox" | "moved" | "deleted";

/**
 * The note of a deed. Each is a whole sentence, so a language can order it its own way; `one`
 * and `many` are for conversations, `message` for one message of a conversation.
 */
const NOTES: Record<Deed, { one: string; many: string; message?: string }> = {
	archived: { one: m("Conversation archived"), many: m("{count} conversations archived") },
	trash: {
		one: m("Conversation moved to Trash"),
		many: m("{count} conversations moved to Trash"),
		message: m("Message moved to Trash"),
	},
	spam: {
		one: m("Conversation marked as spam"),
		many: m("{count} conversations marked as spam"),
		message: m("Message marked as spam"),
	},
	inbox: { one: m("Conversation moved to Inbox"), many: m("{count} conversations moved to Inbox") },
	moved: {
		one: m("Conversation moved to {name}"),
		many: m("{count} conversations moved to {name}"),
	},
	deleted: {
		one: m("Conversation deleted forever"),
		many: m("{count} conversations deleted forever"),
	},
};

function note(deed: Deed, count: number, what?: "message", name = ""): string {
	const said = NOTES[deed];
	const text =
		what === "message" && said.message ? said.message : count === 1 ? said.one : said.many;
	return t(text, { count, name });
}

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
	const { data: labels = [] } = useLabels(mailboxId);
	const labelConversation = useLabelConversation();

	const inTrash = folder === Folders.TRASH;
	const moveTargets = folders.filter(
		(target) => target.id !== folder && !NOT_A_MOVE_TARGET.includes(target.id),
	);

	/** `what` names what moved when it is not whole conversations: one message of one. */
	/**
	 * Says what was done and offers to take it back, on the note and, while the note is there,
	 * with `z`.
	 */
	function offerUndo(title: string, undo: () => void) {
		const forget = () => {
			if (useUIStore.getState().lastUndo === run) useUIStore.setState({ lastUndo: null });
		};
		const run = () => {
			undo();
			toasts.close(toast);
			forget();
		};
		const toast: string = toasts.add({
			title,
			actions: [{ children: t("Undo"), variant: "ghost", onClick: run }],
		});
		useUIStore.setState({ lastUndo: run });
		setTimeout(forget, UNDO_FOR_MS);
	}

	function moveTo(list: Email[], target: string, deed: Deed = "moved", what?: "message"): boolean {
		if (!mailboxId || list.length === 0) return false;
		const before = list.map((email) => ({ id: email.id, folderId: email.folder_id || folder }));
		for (const email of list) moveEmail.mutate({ mailboxId, id: email.id, folderId: target });
		offerUndo(note(deed, list.length, what, placeName(target)), () => {
			for (const was of before) {
				if (was.folderId) moveEmail.mutate({ mailboxId, id: was.id, folderId: was.folderId });
			}
		});
		return true;
	}

	/** Moves to Trash, or inside Trash deletes for good after asking. Resolves to whether it did. */
	async function remove(list: Email[], what?: "message"): Promise<boolean> {
		if (!mailboxId || list.length === 0) return false;
		// What decides is where each message is, so one message of a conversation read elsewhere
		// goes to Trash, and one already in Trash is deleted for good.
		const inTrash = list.every((email) => (email.folder_id || folder) === Folders.TRASH);
		if (!inTrash) return moveTo(list, Folders.TRASH, "trash", what);
		const one = list.length === 1;
		const sure = await confirm({
			title: one
				? t("Delete this conversation forever?")
				: t("Delete {count} conversations forever?", { count: list.length }),
			body: one
				? t("It will be gone from this mailbox for good. This cannot be undone.")
				: t("They will be gone from this mailbox for good. This cannot be undone."),
			action: t("Delete forever"),
			destructive: true,
		});
		if (!sure) return false;
		for (const email of list) deleteEmail.mutate({ mailboxId, id: email.id });
		toasts.add({ title: note("deleted", list.length) });
		return true;
	}

	/** Gives a label to conversations, or takes it from them. They stay where they are. */
	function label(list: Email[], labelId: string, give: boolean) {
		if (!mailboxId) return;
		for (const email of list) {
			labelConversation.mutate({
				mailboxId,
				emailId: email.id,
				add: give ? [labelId] : [],
				remove: give ? [] : [labelId],
			});
		}
	}

	/** "Move to" a label: gives the label and takes the conversation out of the inbox, as one action. */
	function moveToLabel(list: Email[], target: Label): boolean {
		if (!mailboxId || list.length === 0) return false;
		const before = list.map((email) => ({
			email,
			had: email.labels?.includes(target.id) === true,
			folderId: email.folder_id || folder,
		}));
		for (const { email, folderId } of before) {
			labelConversation.mutate({ mailboxId, emailId: email.id, add: [target.id], remove: [] });
			if (folderId === Folders.INBOX) {
				moveEmail.mutate({ mailboxId, id: email.id, folderId: Folders.ARCHIVE });
			}
		}
		offerUndo(note("moved", list.length, undefined, target.name), () => {
			for (const { email, had, folderId } of before) {
				if (!had) {
					labelConversation.mutate({ mailboxId, emailId: email.id, add: [], remove: [target.id] });
				}
				if (folderId === Folders.INBOX) {
					moveEmail.mutate({ mailboxId, id: email.id, folderId: Folders.INBOX });
				}
			}
		});
		return true;
	}

	return {
		inTrash,
		/** The labels of the mailbox, in name order. */
		labels,
		label,
		moveToLabel,
		/** Folders a conversation on screen can be moved to. */
		moveTargets,
		moveTo,
		remove,
		archive: (list: Email[]) => moveTo(list, Folders.ARCHIVE, "archived"),
		reportSpam: (list: Email[], what?: "message") => moveTo(list, Folders.SPAM, "spam", what),
		notSpam: (list: Email[]) => moveTo(list, Folders.INBOX, "inbox"),
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
