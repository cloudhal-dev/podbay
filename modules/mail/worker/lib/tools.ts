// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified by the Podbay contributors.

/**
 * Shared tool business logic for the Agent and MCP server.
 *
 * Each function takes an `env: Env` (or a DO stub) and tool-specific params,
 * performs the business logic (DO calls, data fetching, formatting), and
 * returns a plain object. The Agent and MCP server wrap these results in
 * their own response formats.
 *
 * Functions that already exist in email-helpers.ts (getFullEmail, getFullThread)
 * are reused directly — this module covers the remaining shared operations.
 */

import { Folders } from "../../shared/folders";
import { isLabelId } from "../../shared/labels";
import type { Env } from "../types";
import { verifyDraft } from "./ai";
import {
	buildQuotedReplyBlock,
	getFullEmail,
	getFullThread,
	getMailboxStub,
	textToHtml,
} from "./email-helpers";
import { deleteMessage } from "./messages";
import type { EmailFull } from "./schemas";

// ── Type casts for DO methods not on the base stub type ────────────
type MailboxSearchStub = {
	searchEmails: (options: { query: string; folder?: string }) => Promise<unknown>;
};

/**
 * What a tool answers for a message that waits to leave (ADR-0016, decision 20). No tool
 * sends, sends later, takes back or changes a time: scheduling is sending. A tool reads
 * Scheduled as it reads any place and changes nothing in it.
 */
const WAITING =
	"This message is waiting to be sent. Nothing changes it from here; a person takes it back in the app.";

// ── What a tool answers about a message ────────────────────────────

/**
 * What a tool answers about a message is built from these named fields and from nothing else
 * (ADR-0015, decision 21), so that a new column of the mailbox's database cannot reach a
 * model or an MCP client by accident. No tool returns the original of a message, its text,
 * the key it is stored under, what the platform said about its authentication, or whether it
 * has an original at all. Adding a field here is a decision about boundary B5: the tests pin
 * these lists (`test/workerd-agent/mcp.test.ts`, `test/unit/agent-no-send.test.ts`).
 */
export const TOOL_MESSAGE_FIELDS = [
	"id",
	"folder_id",
	"subject",
	"sender",
	"recipient",
	"cc",
	"bcc",
	"date",
	"read",
	"starred",
	"body",
	"body_text",
	"body_html",
	"in_reply_to",
	"email_references",
	"thread_id",
	"message_id",
	"raw_headers",
	"labels",
] as const;

/** A file of a message, as a tool names it. */
export const TOOL_FILE_FIELDS = [
	"id",
	"email_id",
	"filename",
	"mimetype",
	"size",
	"content_id",
	"disposition",
] as const;

/** A line of a list or of a search, as a tool answers it. */
export const TOOL_LINE_FIELDS = [
	"id",
	"folder_id",
	"folder_name",
	"subject",
	"sender",
	"recipient",
	"cc",
	"bcc",
	"date",
	"read",
	"starred",
	"snippet",
	"in_reply_to",
	"email_references",
	"thread_id",
	"labels",
] as const;

/** The named fields of a row, in the list's order; a field the row lacks is left out. */
function named(row: unknown, fields: readonly string[]): Record<string, unknown> {
	const from = (row ?? {}) as Record<string, unknown>;
	const answer: Record<string, unknown> = {};
	for (const field of fields) if (field in from) answer[field] = from[field];
	return answer;
}

/** A message for a tool: its named fields, and its files by their named fields. */
function toolMessage(row: unknown): Record<string, unknown> {
	const files = (row as { attachments?: unknown }).attachments;
	return {
		...named(row, TOOL_MESSAGE_FIELDS),
		...(Array.isArray(files)
			? { attachments: files.map((file) => named(file, TOOL_FILE_FIELDS)) }
			: {}),
	};
}

const toolLines = (rows: unknown): Record<string, unknown>[] =>
	Array.isArray(rows) ? rows.map((row) => named(row, TOOL_LINE_FIELDS)) : [];

// ── list_emails ────────────────────────────────────────────────────

export async function toolListEmails(
	env: Env,
	mailboxId: string,
	params: { folder: string; limit: number; page: number },
) {
	const stub = getMailboxStub(env, mailboxId);
	return toolLines(
		await stub.getEmails({
			folder: params.folder,
			limit: params.limit,
			page: params.page,
		}),
	);
}

// ── get_email ──────────────────────────────────────────────────────

export async function toolGetEmail(env: Env, mailboxId: string, emailId: string) {
	const stub = getMailboxStub(env, mailboxId);
	const email = await getFullEmail(stub, emailId);
	if (!email) return { error: "Email not found" };
	return toolMessage(email);
}

// ── get_thread ─────────────────────────────────────────────────────

export async function toolGetThread(env: Env, mailboxId: string, threadId: string) {
	const stub = getMailboxStub(env, mailboxId);
	const thread = await getFullThread(stub, threadId);
	return { ...thread, messages: thread.messages.map(toolMessage) };
}

// ── search_emails ──────────────────────────────────────────────────

export async function toolSearchEmails(
	env: Env,
	mailboxId: string,
	params: { query: string; folder?: string },
) {
	const stub = getMailboxStub(env, mailboxId);
	return toolLines(
		await (stub as unknown as MailboxSearchStub).searchEmails({
			query: params.query,
			folder: params.folder,
		}),
	);
}

// ── draft_reply ────────────────────────────────────────────────────

/**
 * Shared draft-reply logic.
 *
 * @param bodyInput - The reply body text. Can be plain text or HTML.
 * @param options.isPlainText - If true, body is treated as plain text and
 *   converted to HTML. If false, body is treated as HTML.
 * @param options.runVerifyDraft - If true, runs AI verifyDraft on the body.
 *   The agent and MCP both do this, but the agent does it on plain text
 *   while MCP does it on HTML.
 */
export async function toolDraftReply(
	env: Env,
	mailboxId: string,
	params: {
		originalEmailId: string;
		to: string;
		subject: string;
		body: string;
		isPlainText?: boolean;
		runVerifyDraft?: boolean;
	},
): Promise<
	| { status: "draft_saved"; draftId: string; message: string; draft: Record<string, string> }
	| { error: string }
> {
	const stub = getMailboxStub(env, mailboxId);

	// Verify/sanitize if requested
	let processedBody = params.body.trim();
	if (params.runVerifyDraft) {
		const sanitized = await verifyDraft(env.AI, processedBody);
		if (!sanitized) {
			return { error: "Draft verification failed — body could not be verified. Please try again." };
		}
		processedBody = sanitized;
	}

	// Convert plain text to HTML if needed
	if (params.isPlainText) {
		processedBody = textToHtml(processedBody);
	}

	const draftId = crypto.randomUUID();

	// Get the original email for thread_id and quoted text
	const original = (await stub.getEmail(params.originalEmailId)) as EmailFull | null;
	const threadId = original?.thread_id || params.originalEmailId;

	// Append quoted original message
	const quotedBlock = original
		? buildQuotedReplyBlock({
				date: original.date,
				sender: original.sender || params.to,
				body: original.body ?? undefined,
			})
		: "";
	const bodyHtml = processedBody + quotedBlock;

	await stub.createEmail(
		Folders.DRAFT,
		{
			id: draftId,
			subject: params.subject,
			sender: mailboxId.toLowerCase(),
			recipient: params.to.toLowerCase(),
			date: new Date().toISOString(),
			body: bodyHtml,
			in_reply_to: params.originalEmailId,
			email_references: null,
			thread_id: threadId,
		},
		[],
	);

	return {
		status: "draft_saved",
		draftId,
		message: "Draft saved to Drafts folder. Review it and confirm to send.",
		draft: {
			originalEmailId: params.originalEmailId,
			to: params.to,
			subject: params.subject,
			body: params.isPlainText ? params.body.trim() : bodyHtml,
		},
	};
}

// ── draft_email (new email, not a reply) ───────────────────────────

export async function toolDraftEmail(
	env: Env,
	mailboxId: string,
	params: {
		to: string;
		subject: string;
		body: string;
		isPlainText?: boolean;
		runVerifyDraft?: boolean;
		/** Optional in_reply_to for create_draft style */
		in_reply_to?: string;
		/** Optional thread_id for create_draft style */
		thread_id?: string;
	},
): Promise<
	| {
			status: string;
			draftId: string;
			threadId?: string;
			message: string;
			draft?: Record<string, string>;
	  }
	| { error: string }
> {
	const stub = getMailboxStub(env, mailboxId);

	let processedBody = params.body.trim();
	if (params.runVerifyDraft) {
		const sanitized = await verifyDraft(env.AI, processedBody);
		if (!sanitized) {
			return { error: "Draft verification failed — body could not be verified. Please try again." };
		}
		processedBody = sanitized;
	}

	if (params.isPlainText) {
		processedBody = textToHtml(processedBody);
	}

	const draftId = crypto.randomUUID();

	// Resolve thread ID
	let resolvedThreadId = params.thread_id;
	if (!resolvedThreadId && params.in_reply_to) {
		const original = (await stub.getEmail(params.in_reply_to)) as EmailFull | null;
		resolvedThreadId = original?.thread_id || params.in_reply_to;
	}
	if (!resolvedThreadId) {
		resolvedThreadId = draftId;
	}

	await stub.createEmail(
		Folders.DRAFT,
		{
			id: draftId,
			subject: params.subject,
			sender: mailboxId.toLowerCase(),
			recipient: (params.to || "").toLowerCase(),
			date: new Date().toISOString(),
			body: processedBody,
			in_reply_to: params.in_reply_to || null,
			email_references: null,
			thread_id: resolvedThreadId,
		},
		[],
	);

	return {
		status: "draft_saved",
		draftId,
		threadId: resolvedThreadId,
		message: "Draft saved to Drafts folder. Review it and confirm to send.",
		draft: {
			to: params.to,
			subject: params.subject,
			body: params.isPlainText ? params.body.trim() : processedBody,
		},
	};
}

// ── update_draft ───────────────────────────────────────────────────

export async function toolUpdateDraft(
	env: Env,
	mailboxId: string,
	params: {
		draftId: string;
		to?: string;
		subject?: string;
		bodyHtml?: string;
		/** If true, the body is checked by the model before it is saved. */
		runVerifyDraft?: boolean;
	},
): Promise<
	| { status: string; draftId: string; newDraftId: string; oldDraftId: string; message: string }
	| { error: string }
> {
	const stub = getMailboxStub(env, mailboxId);

	const oldDraft = (await stub.getEmail(params.draftId)) as EmailFull | null;
	if (!oldDraft) {
		return { error: "Draft not found" };
	}
	// Only a draft is changed: a message anywhere else is never touched by this tool.
	if (oldDraft.folder_id !== Folders.DRAFT) {
		return { error: "Cannot update: email is not a draft" };
	}
	// A draft a person gave files to is that person's: a tool that could change its recipient
	// would be one click away from sending those files to a stranger (ADR-0011, decision 14).
	if (await stub.holdsFiles(params.draftId)) {
		return { error: "Cannot update: this draft holds files. A person changes it in the app." };
	}

	// The body goes to the model only when the caller asks (the assistant). An MCP client's
	// draft is saved as it was given, so a key works with the assistant off and no mail of the
	// mailbox reaches a model by this path.
	const rawBody = params.bodyHtml ?? oldDraft.body ?? "";
	const verifiedBody = params.runVerifyDraft ? await verifyDraft(env.AI, rawBody) : rawBody;
	if (params.runVerifyDraft && !verifiedBody) {
		return {
			error: "Draft verification failed — keeping existing draft unchanged. Please try again.",
		};
	}

	// The draft keeps its id: it is saved in place (ADR-0011, decision 1).
	const saved = await stub.saveDraft(params.draftId, {
		subject: params.subject ?? oldDraft.subject,
		recipient: (params.to ?? oldDraft.recipient).toLowerCase(),
		cc: oldDraft.cc ?? null,
		bcc: oldDraft.bcc ?? null,
		date: new Date().toISOString(),
		body: verifiedBody,
	});
	if (!saved) return { error: "Draft not found" };

	return {
		status: "draft_updated",
		draftId: params.draftId,
		// Kept for clients written when changing a draft replaced it: both name the same draft.
		newDraftId: params.draftId,
		oldDraftId: params.draftId,
		message: "Draft updated in Drafts folder.",
	};
}

// ── mark_email_read ────────────────────────────────────────────────

export async function toolMarkEmailRead(
	env: Env,
	mailboxId: string,
	emailId: string,
	read: boolean,
) {
	const stub = getMailboxStub(env, mailboxId);
	const updated = await stub.updateEmail(emailId, { read });
	if (updated === "scheduled") return { error: WAITING };
	return { status: "updated", emailId, read };
}

// ── move_email ─────────────────────────────────────────────────────

export async function toolMoveEmail(
	env: Env,
	mailboxId: string,
	emailId: string,
	folderId: string,
) {
	const stub = getMailboxStub(env, mailboxId);
	const moved = await stub.moveEmail(emailId, folderId);
	// Scheduled is neither a source nor a target of a move (ADR-0016, decision 2).
	if (moved === "scheduled") return { error: WAITING };
	if (moved === true) {
		return { status: "moved", emailId, folder: folderId };
	}
	return { error: "Failed to move email" };
}

// ── discard_draft ──────────────────────────────────────────────────

export async function toolDiscardDraft(env: Env, mailboxId: string, draftId: string) {
	const stub = getMailboxStub(env, mailboxId);
	const email = (await stub.getEmail(draftId)) as { folder_id?: string } | null;
	if (!email) {
		return { error: "Draft not found" };
	}
	if (email.folder_id !== Folders.DRAFT) {
		return { error: "Cannot discard: email is not a draft" };
	}
	if (await stub.holdsFiles(draftId)) {
		return { error: "Cannot discard: this draft holds files. A person discards it in the app." };
	}
	// The one deletion of a message: its rows, and any object under its keys (S13).
	await deleteMessage(env.BUCKET, stub, draftId);
	return { status: "discarded", draftId };
}

// ── labels (ADR-0007) ──────────────────────────────────────────────

export async function toolListLabels(env: Env, mailboxId: string) {
	return getMailboxStub(env, mailboxId).getLabels();
}

/** Gives labels to, and takes labels from, the conversation a message belongs to. */
export async function toolLabelEmail(
	env: Env,
	mailboxId: string,
	emailId: string,
	change: { add: string[]; remove: string[] },
) {
	if (![...change.add, ...change.remove].every(isLabelId)) {
		return { error: "No such label. Call list_labels to see the labels of this mailbox." };
	}
	const stub = getMailboxStub(env, mailboxId);
	const done = await stub.labelConversation(emailId, change.add, change.remove);
	if (done === "scheduled") return { error: WAITING };
	if (done === "limit") return { error: "This message has as many labels as it can hold." };
	if (typeof done === "string") {
		return { error: "No such label or email. Call list_labels to see the labels of this mailbox." };
	}
	return { status: "labelled", emailId, labels: done.labels };
}
