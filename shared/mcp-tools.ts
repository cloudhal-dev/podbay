// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * The tools of the MCP endpoint, in one place: the server registers exactly these names and the
 * app lists them. No tool sends mail; `changes` marks the ones a read-only key cannot use.
 */
export const MCP_TOOLS = [
	{ name: "list_mailboxes", summary: "List the mailboxes the key can reach", changes: false },
	{ name: "list_emails", summary: "List the emails in a folder", changes: false },
	{ name: "get_email", summary: "Read one email", changes: false },
	{ name: "get_thread", summary: "Read a conversation", changes: false },
	{ name: "search_emails", summary: "Search a mailbox", changes: false },
	{ name: "list_labels", summary: "List the labels of a mailbox", changes: false },
	{ name: "draft_reply", summary: "Save a reply as a draft", changes: true },
	{ name: "create_draft", summary: "Save a new message as a draft", changes: true },
	{ name: "update_draft", summary: "Change a saved draft", changes: true },
	{ name: "mark_email_read", summary: "Mark an email read or unread", changes: true },
	{ name: "move_email", summary: "Move an email to a folder", changes: true },
	{ name: "move_to_trash", summary: "Move an email to Trash", changes: true },
	{ name: "label_email", summary: "Give or take labels on a conversation", changes: true },
] as const;

export type McpToolName = (typeof MCP_TOOLS)[number]["name"];
