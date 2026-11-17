// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { m, plural, t } from "~/i18n";

/** What was done to conversations, as the note says it. */
export type Deed =
	| "archived"
	| "trash"
	| "spam"
	| "inbox"
	| "moved"
	| "deleted"
	| "read"
	| "unread"
	| "starred"
	| "unstarred"
	| "labelled"
	| "unlabelled";

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
	read: {
		one: m("Conversation marked as read"),
		many: m("{count} conversations marked as read"),
		message: m("Message marked as read"),
	},
	unread: {
		one: m("Conversation marked as unread"),
		many: m("{count} conversations marked as unread"),
		message: m("Message marked as unread"),
	},
	starred: {
		one: m("Conversation starred"),
		many: m("{count} conversations starred"),
		message: m("Message starred"),
	},
	unstarred: {
		one: m("Star taken off the conversation"),
		many: m("Star taken off {count} conversations"),
		message: m("Star taken off the message"),
	},
	labelled: {
		one: m("Conversation labelled {name}"),
		many: m("{count} conversations labelled {name}"),
	},
	unlabelled: {
		one: m("Label {name} taken off the conversation"),
		many: m("Label {name} taken off {count} conversations"),
	},
};

export function note(deed: Deed, count: number, what?: "message", name = ""): string {
	const said = NOTES[deed];
	const text =
		what === "message" && said.message ? said.message : count === 1 ? said.one : said.many;
	return t(text, { count, name });
}

/** The deeds that can be done to everything in a place or a search. */
export type AskedDeed = Exclude<Deed, "deleted" | "starred" | "unstarred">;

/**
 * What the app asks before a deed on everything in a place or a search (ADR-0014, decision 9):
 * the question, with how much the mailbox counted in `{holds}`, and the words on the button.
 */
const QUESTIONS: Record<AskedDeed, { ask: string; action: string }> = {
	archived: { ask: m("Archive {holds}?"), action: m("Archive") },
	trash: { ask: m("Move {holds} to Trash?"), action: m("Move to Trash") },
	spam: { ask: m("Mark {holds} as spam?"), action: m("Report spam") },
	inbox: { ask: m("Move {holds} to Inbox?"), action: m("Move to Inbox") },
	moved: { ask: m("Move {holds} to {name}?"), action: m("Move") },
	read: { ask: m("Mark {holds} as read?"), action: m("Mark as read") },
	unread: { ask: m("Mark {holds} as unread?"), action: m("Mark as unread") },
	labelled: { ask: m("Label {holds} {name}?"), action: m("Label") },
	unlabelled: { ask: m("Take the label {name} off {holds}?"), action: m("Take it off") },
};

/** How much a deed takes, in the lines a list shows: conversations, or messages. */
export function holds(count: number, conversations: boolean): string {
	return conversations
		? plural(count, "{count} conversation", "{count} conversations")
		: plural(count, "{count} message", "{count} messages");
}

export function question(
	deed: AskedDeed,
	held: string,
	name = "",
): { title: string; action: string } {
	const asked = QUESTIONS[deed];
	return { title: t(asked.ask, { holds: held, name }), action: t(asked.action) };
}

/** The lines a deed left as they were, for the second line of its note. */
export function leftOut(count: number): string {
	return plural(
		count,
		"{count} conversation was left as it is: it cannot be changed this way where it is.",
		"{count} conversations were left as they are: they cannot be changed this way where they are.",
	);
}
