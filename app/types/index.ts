// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified by the Podbay contributors.

import type { Submission } from "@podbay/mail/shared";

export interface SignatureSettings {
	enabled: boolean;
	text: string;
	html?: string;
}

export interface MailboxSettings {
	fromName?: string;
	signature?: SignatureSettings;
	agentSystemPrompt?: string;
}

export interface Mailbox {
	id: string;
	email: string;
	name: string;
	settings?: MailboxSettings;
	/** The signed-in person's role in this mailbox. */
	role?: "owner" | "sender" | "reader";
}

export type MailboxRole = "owner" | "sender" | "reader";

export interface Member {
	userId: string;
	name: string;
	email: string;
	role: MailboxRole;
	addedAt: string;
	/** Who gave the membership: an address, or null when that account is gone. */
	addedBy: string | null;
}

/** One change to the members of a mailbox, as its owners read it afterwards. */
export interface MemberChange {
	at: string;
	change: "set" | "removed";
	by: string | null;
	person: string | null;
	role: MailboxRole | null;
	self: boolean;
	/** Made by someone who manages the instance and was not an owner of the mailbox. */
	asManager: boolean;
}

/** A mailbox as whoever manages the instance sees it: who owns it, never its mail. */
export interface RegistryMailbox {
	address: string;
	name: string;
	members: number;
	owners: string[];
	/** The signed-in person's own membership, or null. */
	role: MailboxRole | null;
}

/** A key for a program (an AI client). The token itself is shown once, when the key is made. */
export interface AccessKey {
	id: string;
	name: string;
	/** The last characters of the token, to tell keys apart. */
	hint: string;
	access: "read" | "write";
	mailboxes: string[];
	createdAt: string;
	expiresAt: string | null;
	lastUsedAt: string | null;
	state: "active" | "revoked" | "expired";
}

export interface CreatedAccessKey {
	id: string;
	token: string;
	endpoint: string;
}

export interface Email {
	id: string;
	thread_id?: string | null;
	folder_id?: string | null;
	/** The ids of the labels its conversation carries. */
	labels?: string[];
	subject: string;
	sender: string;
	recipient: string;
	cc?: string;
	bcc?: string;
	date: string;
	read: boolean;
	starred: boolean;
	body?: string | null;
	in_reply_to?: string | null;
	email_references?: string | null;
	message_id?: string | null;
	raw_headers?: string | null;
	/** Whether the bytes it arrived as are kept (ADR-0015). Sent mail and drafts have none. */
	has_original?: boolean;
	/** The number of bytes of the original. */
	raw_size?: number | null;
	/** Set when Podbay could not read the message: it has its original and nothing else. */
	unparsed?: "parser" | "too_large" | "interrupted" | null;
	attachments?: Attachment[];
	/**
	 * What a message says about its way out (ADR-0016), when it was sent from here: it waits
	 * in Scheduled, has left, or came back to Drafts with the reason.
	 */
	submission?: Submission;
	snippet?: string | null;
	// Thread aggregate fields (only present in threaded list view)
	thread_count?: number;
	thread_unread_count?: number;
	participants?: string;
	needs_reply?: boolean;
	has_draft?: boolean;
}

export interface Attachment {
	id: string;
	filename: string;
	mimetype: string;
	size: number;
	content_id?: string;
	disposition?: string;
}

/** A label of a mailbox (ADR-0007). A message is in one place and carries any number of labels. */
export interface Label {
	id: string;
	name: string;
	/** An index into the app's palette. */
	color: number;
	/** Messages that carry it, outside Spam and Trash. */
	total: number;
	unread: number;
}

export interface Folder {
	id: string;
	name: string;
	unreadCount: number;
	/** In Scheduled: how many messages wait to leave (ADR-0016). */
	waiting?: number;
	/** In Drafts: how many messages came back unsent, with the reason. */
	notSent?: number;
}
