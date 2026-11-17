// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified by the Podbay contributors.

export interface SignatureSettings {
	enabled: boolean;
	text: string;
	html?: string;
}

export interface MailboxSettings {
	fromName?: string;
	forwarding?: { enabled: boolean; email: string };
	signature?: SignatureSettings;
	autoReply?: { enabled: boolean; subject: string; message: string };
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
	attachments?: Attachment[];
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

export interface Folder {
	id: string;
	name: string;
	unreadCount: number;
}
