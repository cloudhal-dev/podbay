// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified by the Podbay contributors.

import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const folders = sqliteTable("folders", {
	id: text("id").primaryKey(),
	name: text("name").notNull().unique(),
	is_deletable: integer("is_deletable").notNull().default(1),
});

export const emails = sqliteTable("emails", {
	id: text("id").primaryKey(),
	folder_id: text("folder_id")
		.notNull()
		.references(() => folders.id, { onDelete: "cascade" }),
	subject: text("subject"),
	sender: text("sender"),
	recipient: text("recipient"),
	cc: text("cc"),
	bcc: text("bcc"),
	date: text("date"),
	read: integer("read").default(0),
	starred: integer("starred").default(0),
	body: text("body"),
	in_reply_to: text("in_reply_to"),
	email_references: text("email_references"),
	thread_id: text("thread_id"),
	message_id: text("message_id"),
	raw_headers: text("raw_headers"),
	/**
	 * The whole key of the object that holds the bytes that arrived (ADR-0015), and the only
	 * way to it. Empty for a sent message, a draft and mail stored before originals were kept.
	 * It never leaves the Worker: no answer and no log carries it.
	 */
	raw_key: text("raw_key"),
	/** The number of bytes of the original. */
	raw_size: integer("raw_size"),
	/** Why the message has no parsed fields: `parser`, `too_large` or `interrupted`. */
	unparsed: text("unparsed"),
	/** The platform's own `Authentication-Results` field, as it stood when the message arrived. */
	auth_results: text("auth_results"),
});

export const attachments = sqliteTable("attachments", {
	id: text("id").primaryKey(),
	email_id: text("email_id")
		.notNull()
		.references(() => emails.id, { onDelete: "cascade" }),
	filename: text("filename").notNull(),
	mimetype: text("mimetype").notNull(),
	size: integer("size").notNull(),
	content_id: text("content_id"),
	disposition: text("disposition"),
	/**
	 * Empty for a stored file. For a file of a draft whose bytes have not arrived yet, the time
	 * it was declared (ADR-0011): such a file is not part of the message.
	 */
	uploading_since: text("uploading_since"),
});
