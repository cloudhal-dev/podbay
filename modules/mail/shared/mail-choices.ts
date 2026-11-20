// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Mail's own choices (ADR-0012): how the mail screens look and behave. Mail gives this table;
 * the shell joins it with the choices that belong to no module (`shared/choices.ts`), and a
 * key is given once. Its rules are decision 4 of ADR-0012, the order of a list by decision 25
 * of ADR-0014, and the undo window of a send by decision 10 of ADR-0016 (a person's choice like
 * the others; the request carries it, and the Worker never reads it from here).
 */
import type { ChoiceTable } from "@podbay/contract/choices";
import { LIST_ORDERS, type ListOrder } from "./list-order";
import { DEFAULT_UNDO_SECONDS, UNDO_SECONDS, type UndoSeconds } from "./sending";

export const DENSITIES = ["default", "comfortable", "compact"] as const;
export type Density = (typeof DENSITIES)[number];
export const READING_PANES = ["none", "right", "below"] as const;
export type ReadingPane = (typeof READING_PANES)[number];
export const PAGE_SIZES = [10, 25, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZES)[number];
export const DEFAULT_REPLIES = ["reply", "reply-all"] as const;
export type DefaultReply = (typeof DEFAULT_REPLIES)[number];
export const AFTER_FILING = ["list", "newer", "older"] as const;
export type AfterFiling = (typeof AFTER_FILING)[number];
const YES_OR_NO = [true, false] as const;

export interface MailChoices {
	/** How tall a line of a list is. */
	density: Density;
	/** Whether a conversation opens beside the list. */
	readingPane: ReadingPane;
	/** Conversations on one page of a list. */
	pageSize: PageSize;
	/** What a list puts on top: the newest, or what is unread or starred (ADR-0014). */
	order: ListOrder;
	/** What the Reply button of a message does. */
	defaultReply: DefaultReply;
	/** Where to go after the open conversation is archived, deleted, moved or reported. */
	afterFiling: AfterFiling;
	/** Whether single keys act as shortcuts. */
	shortcuts: boolean;
	/** Whether the messages of a conversation are one line and one screen, or each its own. */
	conversationView: boolean;
	/** Whether a line shows the start of the message after the subject. */
	snippets: boolean;
	/** Whether the line under the pointer offers archive, delete and read in place of its date. */
	hoverActions: boolean;
	/** Whether an answer can be sent and its conversation archived in one press. */
	sendAndArchive: boolean;
	/** How long a message that was sent can still be taken back, in seconds (ADR-0016). */
	undoSeconds: UndoSeconds;
	/** Whether new mail is announced by a notification of this device. */
	notifications: boolean;
}

export const MAIL_CHOICES: ChoiceTable<MailChoices> = {
	density: { values: DENSITIES, initial: "default", kept: "device" },
	readingPane: { values: READING_PANES, initial: "none", kept: "device" },
	pageSize: { values: PAGE_SIZES, initial: 25, kept: "person" },
	order: { values: LIST_ORDERS, initial: "newest", kept: "person" },
	defaultReply: { values: DEFAULT_REPLIES, initial: "reply", kept: "person" },
	afterFiling: { values: AFTER_FILING, initial: "list", kept: "person" },
	shortcuts: { values: YES_OR_NO, initial: true, kept: "person" },
	conversationView: { values: YES_OR_NO, initial: true, kept: "person" },
	snippets: { values: YES_OR_NO, initial: true, kept: "person" },
	hoverActions: { values: YES_OR_NO, initial: true, kept: "person" },
	sendAndArchive: { values: YES_OR_NO, initial: false, kept: "person" },
	undoSeconds: { values: UNDO_SECONDS, initial: DEFAULT_UNDO_SECONDS, kept: "person" },
	notifications: { values: YES_OR_NO, initial: false, kept: "device" },
};
