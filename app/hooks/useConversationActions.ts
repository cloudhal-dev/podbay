// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { useKumoToastManager } from "@cloudflare/kumo";
// Types only: the schema of the request stays in the Worker's bundle (shared/bulk.ts).
import type { BulkChange, BulkFilter, BulkMove, BulkUnit } from "@podbay/mail/shared";
import { Folders } from "@podbay/mail/shared";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useConfirm } from "~/components/Confirm";
import { useDisplay } from "~/hooks/useDisplay";
import { useUIStore } from "~/hooks/useUIStore";
import { plural, t } from "~/i18n";
import { type AskedDeed, type Deed, holds, leftOut, note, question } from "~/lib/deed-words";
import { placeName } from "~/lib/places";
import { useDeleteEmail, useInvalidateEmailData, useMoveEmail } from "~/queries/emails";
import { useFolders } from "~/queries/folders";
import { useLabels } from "~/queries/labels";
import api, { ApiError } from "~/services/api";
import type { Email, Folder, Label } from "~/types";

/**
 * Only a real send fills Sent and Scheduled, and drafts are made by writing: none of them is a
 * place to move mail to.
 */
const NOT_A_MOVE_TARGET: readonly string[] = [Folders.SENT, Folders.DRAFT, Folders.SCHEDULED];
/** Where one request may move lines (ADR-0014, decision 2). */
const MOVES: readonly BulkMove[] = ["inbox", "archive", "spam", "trash"];
const MOVED: Record<BulkMove, AskedDeed> = {
	inbox: "inbox",
	archive: "archived",
	spam: "spam",
	trash: "trash",
};

/** How long `z` can still take back the last deed: about as long as its note is on screen. */
const UNDO_FOR_MS = 8000;
/** One request names at most this many lines: the largest page of a list. */
const LINES_AT_ONCE = 100;
/** A deed runs in steps; this many calls is far more than any mailbox needs. */
const MOST_CALLS = 2000;

/** How far a deed on everything is, or its undo (`total` is then unknown). */
export interface Progress {
	done: number;
	total: number | null;
}

/** A deed on everything in a place or a search. */
export type EverythingDeed =
	| { kind: "move"; target: string }
	| { kind: "read"; read: boolean }
	| { kind: "label"; label: Label; give: boolean }
	| { kind: "moveToLabel"; label: Label };

interface Part {
	lines: Email[];
	change: BulkChange;
}

/** What requests for lines did, also when a later one failed. */
interface Did {
	deeds: string[];
	/** Lines in which something was changed. */
	changed: number;
	/** Lines that were left out: not there any more, or not changeable this way where they are. */
	left: number;
}

const isMove = (target: string): target is BulkMove => MOVES.some((move) => move === target);

/** Shows a mark on the named messages at once; the lists are read again when the deed is done. */
function showMark(
	queryClient: QueryClient,
	mailboxId: string,
	lines: readonly Email[],
	mark: { read?: boolean; starred?: boolean },
) {
	const ids = new Set(lines.map((email) => email.id));
	const patch = (email: Email): Email => {
		if (!ids.has(email.id)) return email;
		const next = { ...email };
		if (mark.starred !== undefined) next.starred = mark.starred;
		if (mark.read !== undefined) {
			next.read = mark.read;
			if (email.thread_unread_count !== undefined) {
				next.thread_unread_count = mark.read ? 0 : Math.max(1, email.thread_unread_count);
			}
		}
		return next;
	};
	const shown = (cached: unknown): unknown => {
		if (Array.isArray(cached)) return (cached as Email[]).map(patch);
		if (cached === null || typeof cached !== "object") return cached;
		const data = cached as { emails?: Email[]; results?: Email[]; id?: string };
		if (data.emails) return { ...data, emails: data.emails.map(patch) };
		if (data.results) return { ...data, results: data.results.map(patch) };
		return typeof data.id === "string" ? patch(cached as Email) : cached;
	};
	for (const key of ["emails", "search"]) {
		queryClient.setQueriesData({ queryKey: [key, mailboxId] }, shown);
	}
}

/**
 * What can be done to conversations, the same from the list and from an open conversation.
 *
 * A line of a list is a conversation in a place, and what is done to lines is one request to the
 * mailbox, however many are ticked (ADR-0014): a move takes the whole line, a mark the
 * conversation. Every deed says what happened and offers to take it back from the mailbox's own
 * record. Delete means Trash, and only inside Trash is a message deleted for good, after asking.
 */
export function useConversationActions(mailboxId: string | undefined, folder?: string) {
	const toasts = useKumoToastManager();
	const confirm = useConfirm();
	const queryClient = useQueryClient();
	const moveEmail = useMoveEmail();
	const deleteEmail = useDeleteEmail();
	const invalidate = useInvalidateEmailData();
	const conversations = useDisplay((state) => state.conversationView);
	const { data: folders = [] } = useFolders(mailboxId) as { data?: Folder[] };
	const { data: labels = [] } = useLabels(mailboxId);

	const inTrash = folder === Folders.TRASH;
	/** A line in Sent goes only to Trash (ADR-0014, decision 5). */
	const fromSent = folder === Folders.SENT;
	const moveTargets = folders.filter(
		(target) =>
			target.id !== folder &&
			!NOT_A_MOVE_TARGET.includes(target.id) &&
			(!fromSent || target.id === Folders.TRASH),
	);
	const placeOf = (email: Email) => email.folder_id || folder;
	/** With conversation view off a line is one message, and the request says so. */
	const unitOf = (what?: "message"): BulkUnit =>
		what === "message" || !conversations ? "message" : "conversation";

	/**
	 * Says what was done and offers to take it back, on the note and, while the note is there,
	 * with `z`.
	 */
	function offerUndo(title: string, undo: () => void, description?: string) {
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
			description,
			actions: [{ children: t("Undo"), variant: "ghost", onClick: run }],
		});
		useUIStore.setState({ lastUndo: run });
		setTimeout(forget, UNDO_FOR_MS);
	}

	/** Takes deeds back, step by step, from the record the mailbox keeps for an hour. */
	async function takeBack(
		box: string,
		deeds: readonly string[],
		onProgress?: (progress: Progress | null) => void,
	) {
		let back = 0;
		try {
			for (const deed of deeds) {
				for (let call = 0; call < MOST_CALLS; call++) {
					const answer = await api.undoDeed(box, deed);
					back += answer.messages;
					if (!answer.more) break;
					onProgress?.({ done: back, total: null });
				}
			}
		} catch {
			toasts.add({
				title: t("Not everything could be put back. What was put back stays."),
				variant: "error",
			});
		} finally {
			onProgress?.(null);
			invalidate(box);
		}
	}

	/** One request for each part, at most a page of lines in each. */
	async function send(box: string, parts: readonly Part[], unit: BulkUnit, did: Did) {
		for (const part of parts) {
			for (let from = 0; from < part.lines.length; from += LINES_AT_ONCE) {
				const lines = part.lines.slice(from, from + LINES_AT_ONCE);
				const answer = await api.actOnLines(box, {
					ids: lines.map((email) => email.id),
					unit,
					change: part.change,
				});
				const { not_found, place, label_limit } = answer.skipped;
				did.deeds.push(answer.deed);
				did.left += not_found + place + label_limit;
				// The lines in which the mailbox changed something: what the note counts.
				did.changed += answer.conversations;
			}
		}
	}

	/**
	 * Acts on lines: sends the requests, then says what was done and offers Undo. `also` is what
	 * was done beside the requests (a draft, which this route does not move).
	 */
	function act(
		parts: readonly Part[],
		said: (count: number) => string,
		what?: "message",
		also?: { count: number; undo: () => void },
	): boolean {
		const sent = parts.filter((part) => part.lines.length > 0);
		if (!mailboxId || (sent.length === 0 && !also)) return false;
		const box = mailboxId;
		void (async () => {
			const did: Did = { deeds: [], changed: 0, left: 0 };
			try {
				await send(box, sent, unitOf(what), did);
			} catch {
				toasts.add({
					title: t("Not everything could be changed. What was changed stays changed."),
					variant: "error",
				});
			} finally {
				invalidate(box);
			}
			const count = did.changed + (also?.count ?? 0);
			const left = did.left > 0 ? leftOut(did.left) : undefined;
			if (count === 0) {
				if (left) toasts.add({ title: t("Nothing was changed"), description: left });
				return;
			}
			offerUndo(
				said(count),
				() => {
					also?.undo();
					if (did.deeds.length > 0) void takeBack(box, did.deeds);
				},
				left,
			);
		})();
		return true;
	}

	function moveTo(list: Email[], target: string, deed: Deed = "moved", what?: "message"): boolean {
		if (!mailboxId || list.length === 0 || !isMove(target)) return false;
		const box = mailboxId;
		// A draft is not moved by the request for lines: it goes by itself, as it always did.
		const drafts = list.filter((email) => placeOf(email) === Folders.DRAFT);
		for (const draft of drafts)
			moveEmail.mutate({ mailboxId: box, id: draft.id, folderId: target });
		return act(
			[{ lines: list.filter((email) => !drafts.includes(email)), change: { move: target } }],
			(count) => note(deed, count, what, placeName(target)),
			what,
			drafts.length === 0
				? undefined
				: {
						count: drafts.length,
						undo: () => {
							for (const draft of drafts) {
								moveEmail.mutate({ mailboxId: box, id: draft.id, folderId: Folders.DRAFT });
							}
						},
					},
		);
	}

	/** Moves to Trash, or inside Trash deletes for good after asking. Resolves to whether it did. */
	async function remove(list: Email[], what?: "message"): Promise<boolean> {
		if (!mailboxId || list.length === 0) return false;
		// What decides is where each message is, so one message of a conversation read elsewhere
		// goes to Trash, and one already in Trash is deleted for good.
		const inTrash = list.every((email) => placeOf(email) === Folders.TRASH);
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
		const name = labels.find((one) => one.id === labelId)?.name ?? "";
		act(
			[{ lines: list, change: { labels: give ? { add: [labelId] } : { remove: [labelId] } } }],
			(count) => note(give ? "labelled" : "unlabelled", count, undefined, name),
		);
	}

	/**
	 * "Move to" a label: gives the label and takes the conversation out of the inbox, as one
	 * action with one Undo (ADR-0007, decision 9). A line that is not in the inbox gets the label
	 * and stays where it is.
	 */
	function moveToLabel(list: Email[], target: Label): boolean {
		const give = { labels: { add: [target.id] } };
		const inInbox = (email: Email) => placeOf(email) === Folders.INBOX;
		return act(
			[
				{ lines: list.filter(inInbox), change: { ...give, move: "archive" } },
				{ lines: list.filter((email) => !inInbox(email)), change: give },
			],
			(count) => note("moved", count, undefined, target.name),
		);
	}

	/** The change, the name of the deed and the name in its words, for a deed on everything. */
	function everythingAsked(filter: BulkFilter, deed: EverythingDeed) {
		if (deed.kind === "move") {
			if (!isMove(deed.target)) return null;
			return { change: { move: deed.target }, name: MOVED[deed.target], said: "" };
		}
		if (deed.kind === "read") {
			const name: AskedDeed = deed.read ? "read" : "unread";
			return { change: { read: deed.read }, name, said: "" };
		}
		const id = deed.label.id;
		if (deed.kind === "label") {
			const name: AskedDeed = deed.give ? "labelled" : "unlabelled";
			const change = { labels: deed.give ? { add: [id] } : { remove: [id] } };
			return { change, name, said: deed.label.name };
		}
		// Out of the inbox when the inbox is what is chosen; elsewhere the label alone.
		const out = filter.folder === Folders.INBOX;
		const name: AskedDeed = out ? "moved" : "labelled";
		const change: BulkChange = { labels: { add: [id] }, ...(out ? { move: "archive" } : {}) };
		return { change, name, said: deed.label.name };
	}

	/**
	 * A deed on everything in a place or a search (ADR-0014). The mailbox counts first and the
	 * app asks with that count; then the deed runs in steps, `onProgress` says how far it is, and
	 * the note offers to take all of it back. Resolves to whether anything was done.
	 */
	async function everything(
		filter: BulkFilter,
		deed: EverythingDeed,
		onProgress: (progress: Progress | null) => void,
	): Promise<boolean> {
		const asked = everythingAsked(filter, deed);
		if (!mailboxId || asked === null) return false;
		const box = mailboxId;
		const unit = unitOf();
		let counted: { deed: string; conversations: number; messages: number };
		try {
			counted = await api.askDeed(box, { filter, unit, change: asked.change });
		} catch {
			toasts.add({ title: t("That could not be counted. Nothing was changed."), variant: "error" });
			return false;
		}
		if (counted.conversations === 0) {
			toasts.add({ title: t("There is nothing here to change.") });
			return false;
		}
		const words = question(
			asked.name,
			holds(counted.conversations, unit === "conversation"),
			asked.said,
		);
		const sure = await confirm({
			title: words.title,
			body:
				unit === "conversation"
					? t("That is {messages} in all. For an hour you can take it back.", {
							messages: plural(counted.messages, "{count} message", "{count} messages"),
						})
					: t("For an hour you can take it back."),
			action: words.action,
		});
		if (!sure) return false;

		let done = 0;
		let left = 0;
		let failed: unknown = null;
		onProgress({ done, total: counted.conversations });
		try {
			for (let call = 0; call < MOST_CALLS; call++) {
				const step = await api.runDeed(box, counted.deed);
				done += step.conversations;
				left += step.skipped.not_found + step.skipped.place + step.skipped.label_limit;
				if (!step.more) break;
				onProgress({ done, total: counted.conversations });
			}
		} catch (error) {
			failed = error;
		} finally {
			onProgress(null);
			invalidate(box);
		}
		if (failed !== null) {
			const code = failed instanceof ApiError ? failed.body.code : undefined;
			toasts.add({
				title:
					code === "SCOPE_GREW" || code === "DEED_LATE"
						? t("This changed while you were asked. Nothing was changed: choose again.")
						: t("Not everything could be changed. What was changed stays changed."),
				variant: "error",
			});
			if (done === 0) return false;
		}
		if (done === 0) {
			toasts.add({
				title: t("Nothing was changed"),
				description: left > 0 ? leftOut(left) : undefined,
			});
			return false;
		}
		offerUndo(
			note(asked.name, done, undefined, asked.said),
			() => void takeBack(box, [counted.deed], onProgress),
			left > 0 ? leftOut(left) : undefined,
		);
		return true;
	}

	return {
		inTrash,
		/** Whether a line here can only go to Trash: mail in Sent is not archived or reported. */
		fromSent,
		/** The labels of the mailbox, in name order. */
		labels,
		label,
		moveToLabel,
		/** Folders a conversation on screen can be moved to. */
		moveTargets,
		moveTo,
		remove,
		everything,
		archive: (list: Email[]) => moveTo(list, Folders.ARCHIVE, "archived"),
		reportSpam: (list: Email[], what?: "message") => moveTo(list, Folders.SPAM, "spam", what),
		notSpam: (list: Email[]) => moveTo(list, Folders.INBOX, "inbox"),
		/** `what` says the mark is for these messages themselves, not for their conversations. */
		setRead(list: Email[], read: boolean, what?: "message") {
			if (!mailboxId) return;
			showMark(queryClient, mailboxId, list, { read });
			act(
				[{ lines: list, change: { read } }],
				(count) => note(read ? "read" : "unread", count, what),
				what,
			);
		},
		star(email: Email, what?: "message") {
			if (!mailboxId) return;
			const starred = !email.starred;
			showMark(queryClient, mailboxId, [email], { starred });
			act(
				[{ lines: [email], change: { starred } }],
				(count) => note(starred ? "starred" : "unstarred", count, what),
				what,
			);
		},
	};
}

export type ConversationActions = ReturnType<typeof useConversationActions>;
