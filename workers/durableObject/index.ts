// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified by the Podbay contributors.

import { DurableObject } from "cloudflare:workers";
import type { SQL } from "drizzle-orm";
import { and, asc, desc, eq, isNull, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/durable-sqlite";
import { Folders } from "../../shared/folders";
import * as schema from "../db/schema";
import {
	conversationOrderSql,
	type ListOrder,
	type SearchFilterOptions,
} from "../lib/list-options";
import type { Env } from "../types";
import * as steps from "./deed-steps";
import * as deeds from "./deeds";
import * as drafts from "./drafts";
import { type BatchToEmpty, batchToEmpty, type EmptiedBatch, emptyBatch } from "./emptying";
import * as labels from "./labels";
import { applyMigrations, mailboxMigrations } from "./migrations";
import * as originals from "./originals";
import { countSearchResults, searchEmails } from "./search";
import { sendRefusal } from "./sending";
import type { AttachmentData, EmailData, GetEmailsOptions } from "./shapes";
import { threadOfReferences, threadOfSubject } from "./threads";

/**
 * SQL expression to normalize email subjects by stripping common
 * reply/forward prefixes (Re:, Fwd:, FW:, AW:, WG:, Réf:, SV:).
 * Used for conversation grouping. Hardcoded to the `subject` column.
 */
const NORMALIZED_SUBJECT_SQL = `LOWER(TRIM(
	REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
		LOWER(subject),
		'aw: ', ''), 'wg: ', ''), 'réf: ', ''), 'sv: ', ''),
		're: ', ''), 'fwd: ', ''), 'fw: ', '')
))`;

export class MailboxDO extends DurableObject<Env> {
	declare __DURABLE_OBJECT_BRAND: never;
	db: ReturnType<typeof drizzle>;

	constructor(state: DurableObjectState, env: Env) {
		super(state, env);
		this.db = drizzle(this.ctx.storage, { schema });
		applyMigrations(this.ctx.storage.sql, mailboxMigrations, this.ctx.storage);
	}

	// ── Email CRUD (Drizzle) ───────────────────────────────────────

	async getEmails(options: GetEmailsOptions = {}) {
		const { folder, thread_id, page = 1, limit: rawLimit = 25, order } = options;

		// Cap pagination limit to prevent unbounded queries
		const limit = Math.min(Math.max(rawLimit, 1), 100);

		const offset = (page - 1) * limit;

		const conditions: SQL[] = [];
		if (folder) {
			conditions.push(
				sql`${schema.emails.folder_id} = (SELECT id FROM folders WHERE name = ${folder} OR id = ${folder} LIMIT 1)`,
			);
		}
		if (thread_id) {
			conditions.push(eq(schema.emails.thread_id, thread_id));
		}

		// Unread or starred messages first when asked, newest first inside each group (ADR-0014).
		const newest = desc(schema.emails.date);
		const orderBy =
			order === "unread"
				? [asc(schema.emails.read), newest]
				: order === "starred"
					? [desc(schema.emails.starred), newest]
					: [newest];

		const result = this.db
			.select({
				id: schema.emails.id,
				subject: schema.emails.subject,
				sender: schema.emails.sender,
				recipient: schema.emails.recipient,
				cc: schema.emails.cc,
				bcc: schema.emails.bcc,
				date: schema.emails.date,
				read: schema.emails.read,
				starred: schema.emails.starred,
				in_reply_to: schema.emails.in_reply_to,
				email_references: schema.emails.email_references,
				thread_id: schema.emails.thread_id,
				folder_id: schema.emails.folder_id,
				snippet: sql<string>`SUBSTR(${schema.emails.body}, 1, 300)`,
			})
			.from(schema.emails)
			.where(conditions.length > 0 ? and(...conditions) : undefined)
			.orderBy(...orderBy)
			.limit(limit)
			.offset(offset)
			.all();

		const list = result.map((email) => ({
			...email,
			read: !!email.read,
			starred: !!email.starred,
		}));
		return this.#labelled(list);
	}

	/**
	 * Count total emails matching the given filters (for pagination).
	 */
	async countEmails(options: { folder?: string; thread_id?: string } = {}) {
		const { folder, thread_id } = options;
		const conditions: string[] = [];
		const params: (string | number)[] = [];

		if (folder) {
			conditions.push("folder_id = (SELECT id FROM folders WHERE name = ?1 OR id = ?1 LIMIT 1)");
			params.push(folder);
		}

		if (thread_id) {
			conditions.push(`thread_id = ?${params.length + 1}`);
			params.push(thread_id);
		}

		const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
		const row = [
			...this.ctx.storage.sql.exec(`SELECT COUNT(*) as total FROM emails ${where}`, ...params),
		][0] as { total: number } | undefined;

		return row?.total ?? 0;
	}

	// ── Threaded queries (raw SQL — too complex for Drizzle's builder) ──

	async getThreadedEmails(options: GetEmailsOptions = {}) {
		const { folder, page = 1, limit: rawLimit = 25, order } = options;
		const limit = Math.min(Math.max(rawLimit, 1), 100);

		if (!folder) {
			// Fallback to regular getEmails if no folder specified
			return this.getEmails(options);
		}

		const offset = (page - 1) * limit;

		// Thread grouping strategy:
		// For DRAFT folder: group by in_reply_to (the email being replied to).
		//   This ensures reply-drafts to different emails stay separate, even if
		//   they share a thread_id or subject. New drafts (no in_reply_to) each
		//   get their own group via their unique id.
		// For other folders:
		//   1. Primary: group by thread_id (from email threading headers)
		//   2. Fallback: group by normalized subject (strips Re:/Fwd:/FW: prefixes)
		//      for legacy emails that lack threading headers (thread_id IS NULL).
		const isDraftFolder = folder === Folders.DRAFT;

		if (isDraftFolder) {
			const result = this.ctx.storage.sql.exec(
				`WITH
				folder_emails AS (
					SELECT *,
						COALESCE(in_reply_to, id) as draft_group_key
					FROM emails
					WHERE folder_id = (SELECT id FROM folders WHERE name = ?1 OR id = ?1 LIMIT 1)
				),
				draft_stats AS (
					SELECT
						draft_group_key,
						COUNT(*) as thread_count,
						SUM(CASE WHEN read = 0 THEN 1 ELSE 0 END) as thread_unread_count,
						SUM(CASE WHEN starred = 1 THEN 1 ELSE 0 END) as thread_starred_count,
						GROUP_CONCAT(DISTINCT sender) as participants
					FROM folder_emails
					GROUP BY draft_group_key
				),
				latest_per_group AS (
					SELECT
						fe.*,
						ROW_NUMBER() OVER (
							PARTITION BY fe.draft_group_key
							ORDER BY fe.date DESC
						) as rn
					FROM folder_emails fe
				)
				SELECT
					lp.id, lp.subject, lp.sender, lp.recipient, lp.date,
					lp.read, lp.starred, lp.thread_id, lp.folder_id,
					lp.in_reply_to, lp.email_references,
					SUBSTR(lp.body, 1, 300) as snippet,
					ds.thread_count, ds.thread_unread_count, ds.participants
				FROM latest_per_group lp
				JOIN draft_stats ds ON lp.draft_group_key = ds.draft_group_key
				WHERE lp.rn = 1
				ORDER BY ${conversationOrderSql(order, {
					unread: "ds.thread_unread_count",
					starred: "ds.thread_starred_count",
					date: "lp.date",
				})}
				LIMIT ?2 OFFSET ?3`,
				folder,
				limit,
				offset,
			);

			const rows = [...result];
			const list = rows.map((row) => ({
				...row,
				read: !!row.read,
				starred: !!row.starred,
				thread_count: row.thread_count || 1,
				thread_unread_count: row.thread_unread_count || 0,
				participants: row.participants || row.sender,
			}));
			return this.#labelled(list);
		}

		// Non-draft folders: full threading logic
		const result = this.ctx.storage.sql.exec(
			`WITH
			folder_emails AS (
				SELECT *,
					COALESCE(thread_id, id) as raw_thread_id,
					${NORMALIZED_SUBJECT_SQL} as normalized_subject
				FROM emails
				WHERE folder_id = (SELECT id FROM folders WHERE name = ?1 OR id = ?1 LIMIT 1)
			),
			thread_to_conversation AS (
				SELECT
					raw_thread_id,
					normalized_subject,
					CASE
						WHEN thread_id IS NOT NULL THEN raw_thread_id
						ELSE MIN(raw_thread_id) OVER (PARTITION BY normalized_subject)
					END as conversation_id
				FROM folder_emails
				GROUP BY raw_thread_id, normalized_subject, thread_id
			),
			all_emails_with_conversation AS (
				SELECT
					e.*,
					COALESCE(tc.conversation_id, COALESCE(e.thread_id, e.id)) as conversation_id
				FROM emails e
				LEFT JOIN thread_to_conversation tc
					ON COALESCE(e.thread_id, e.id) = tc.raw_thread_id
			),
			conversation_stats AS (
				SELECT
					conversation_id,
					COUNT(*) as thread_count,
					SUM(CASE WHEN read = 0 THEN 1 ELSE 0 END) as thread_unread_count,
					SUM(CASE WHEN read = 1 THEN 1 ELSE 0 END) as thread_read_count,
					SUM(CASE WHEN starred = 1 THEN 1 ELSE 0 END) as thread_starred_count,
					GROUP_CONCAT(DISTINCT sender) as participants,
					SUM(CASE WHEN folder_id = (SELECT id FROM folders WHERE name = 'draft' LIMIT 1) THEN 1 ELSE 0 END) as has_draft
				FROM all_emails_with_conversation
				WHERE conversation_id IN (
					SELECT DISTINCT conversation_id FROM all_emails_with_conversation
					WHERE folder_id = (SELECT id FROM folders WHERE name = ?1 OR id = ?1 LIMIT 1)
				)
				GROUP BY conversation_id
			),
			latest_message_per_conversation AS (
				SELECT
					conversation_id,
					folder_id,
					ROW_NUMBER() OVER (PARTITION BY conversation_id ORDER BY date DESC) as rn
				FROM all_emails_with_conversation
			),
			latest_in_folder AS (
				SELECT
					fe.*,
					COALESCE(tc.conversation_id, fe.raw_thread_id) as conversation_id,
					ROW_NUMBER() OVER (
						PARTITION BY COALESCE(tc.conversation_id, fe.raw_thread_id)
						ORDER BY fe.date DESC
					) as rn
				FROM folder_emails fe
				LEFT JOIN thread_to_conversation tc
					ON fe.raw_thread_id = tc.raw_thread_id
			)
			SELECT
				lif.id, lif.subject, lif.sender, lif.recipient, lif.date,
				lif.read, lif.starred, lif.thread_id, lif.folder_id,
				lif.in_reply_to, lif.email_references,
				SUBSTR(lif.body, 1, 300) as snippet,
				cs.thread_count, cs.thread_unread_count, cs.participants,
				CASE WHEN lmc.folder_id != (SELECT id FROM folders WHERE name = 'sent' LIMIT 1)
					AND lmc.folder_id != (SELECT id FROM folders WHERE name = 'draft' LIMIT 1)
					AND cs.thread_read_count > 0
					THEN 1 ELSE 0 END as needs_reply,
				CASE WHEN cs.has_draft > 0 THEN 1 ELSE 0 END as has_draft
			FROM latest_in_folder lif
			JOIN conversation_stats cs ON lif.conversation_id = cs.conversation_id
			LEFT JOIN latest_message_per_conversation lmc
				ON lmc.conversation_id = lif.conversation_id AND lmc.rn = 1
			WHERE lif.rn = 1
			ORDER BY ${conversationOrderSql(order, {
				unread: "cs.thread_unread_count",
				starred: "cs.thread_starred_count",
				date: "lif.date",
			})}
			LIMIT ?2 OFFSET ?3`,
			folder,
			limit,
			offset,
		);

		const rows = [...result];
		const list = rows.map((row) => ({
			...row,
			read: !!row.read,
			starred: !!row.starred,
			thread_count: row.thread_count || 1,
			thread_unread_count: row.thread_unread_count || 0,
			participants: row.participants || row.sender,
			needs_reply: !!row.needs_reply,
			has_draft: !!row.has_draft,
		}));
		return this.#labelled(list);
	}

	/**
	 * Count threaded conversations in a folder (for pagination).
	 * Returns the number of conversation groups, not individual emails.
	 */
	async countThreadedEmails(folder: string) {
		const isDraftFolder = folder === Folders.DRAFT;

		if (isDraftFolder) {
			const row = [
				...this.ctx.storage.sql.exec(
					`SELECT COUNT(DISTINCT COALESCE(in_reply_to, id)) as total
					 FROM emails
					 WHERE folder_id = (SELECT id FROM folders WHERE name = ?1 OR id = ?1 LIMIT 1)`,
					folder,
				),
			][0] as { total: number } | undefined;
			return row?.total ?? 0;
		}

		const row = [
			...this.ctx.storage.sql.exec(
				`WITH
				folder_emails AS (
					SELECT
						COALESCE(thread_id, id) as raw_thread_id,
						thread_id,
					${NORMALIZED_SUBJECT_SQL} as normalized_subject
					FROM emails
					WHERE folder_id = (SELECT id FROM folders WHERE name = ?1 OR id = ?1 LIMIT 1)
				),
				thread_to_conversation AS (
					SELECT
						raw_thread_id,
						CASE
							WHEN thread_id IS NOT NULL THEN raw_thread_id
							WHEN normalized_subject != '' THEN MIN(raw_thread_id) OVER (PARTITION BY normalized_subject)
							ELSE raw_thread_id
						END as conversation_id
					FROM folder_emails
					GROUP BY raw_thread_id, normalized_subject, thread_id
				)
				SELECT COUNT(DISTINCT conversation_id) as total
				FROM thread_to_conversation`,
				folder,
			),
		][0] as { total: number } | undefined;
		return row?.total ?? 0;
	}

	// ── Single email operations (Drizzle) ──────────────────────────

	async getEmail(id: string) {
		const email = this.db.select().from(schema.emails).where(eq(schema.emails.id, id)).get();

		if (!email) return null;

		// A file whose bytes have not arrived is not part of the message (ADR-0011).
		const emailAttachments = this.db
			.select()
			.from(schema.attachments)
			.where(and(eq(schema.attachments.email_id, id), isNull(schema.attachments.uploading_since)))
			.all();

		// The key of the original stays here: the answer says `has_original` (ADR-0015).
		const one = originals.shownMessage({ ...email, read: !!email.read, starred: !!email.starred });
		return this.#labelled([{ ...one, attachments: emailAttachments }])[0] ?? null;
	}

	/**
	 * Fetch all emails in a thread with full bodies and attachments in
	 * two queries (one for emails, one for attachments) instead of
	 * N+1 individual getEmail calls.
	 */
	async getThreadEmails(threadId: string) {
		const emailRows = [
			...this.ctx.storage.sql.exec(
				`SELECT * FROM emails WHERE thread_id = ?1 ORDER BY date ASC`,
				threadId,
			),
		];

		if (emailRows.length === 0) return [];

		const emailIds = emailRows.map((e) => e.id as string);

		// Batch-fetch all attachments for the thread in a single query
		const placeholders = emailIds.map((_, i) => `?${i + 1}`).join(",");
		const attachmentRows = [
			...this.ctx.storage.sql.exec(
				`SELECT * FROM attachments WHERE email_id IN (${placeholders}) AND uploading_since IS NULL`,
				...emailIds,
			),
		];

		// Group attachments by email_id
		const attachmentsByEmail = new Map<string, Record<string, SqlStorageValue>[]>();
		for (const att of attachmentRows) {
			const emailId = String(att.email_id);
			const list = attachmentsByEmail.get(emailId) || [];
			list.push(att);
			attachmentsByEmail.set(emailId, list);
		}

		const list = emailRows.map((email) => ({
			...originals.shownMessage(email),
			read: !!email.read,
			starred: !!email.starred,
			attachments: attachmentsByEmail.get(String(email.id)) || [],
		}));
		return this.#labelled(list);
	}

	async updateEmail(id: string, { read, starred }: { read?: boolean; starred?: boolean }) {
		const data: { read?: number; starred?: number } = {};
		if (read !== undefined) {
			data.read = read ? 1 : 0;
		}
		if (starred !== undefined) {
			data.starred = starred ? 1 : 0;
		}

		if (Object.keys(data).length === 0) {
			return this.getEmail(id);
		}

		this.db.update(schema.emails).set(data).where(eq(schema.emails.id, id)).run();

		return this.getEmail(id);
	}

	async markThreadRead(threadId: string) {
		this.ctx.storage.sql.exec(
			`UPDATE emails SET read = 1 WHERE thread_id = ? AND read = 0`,
			threadId,
		);
		return { threadId, markedRead: true };
	}

	/**
	 * Deletes a message's rows and names the objects it had at that moment. The caller has
	 * deleted its objects first (`messageKeys`, `workers/lib/messages.ts`).
	 */
	async deleteEmail(id: string) {
		return this.ctx.storage.transactionSync(() => {
			const keys = originals.messageKeys(this.ctx.storage, id);
			if (keys === null) return null;
			labels.forgetLabelsOf(this.ctx.storage.sql, id);
			deeds.forgetChangesOf(this.ctx.storage.sql, [id]);
			this.db.delete(schema.attachments).where(eq(schema.attachments.email_id, id)).run();
			this.db.delete(schema.emails).where(eq(schema.emails.id, id)).run();
			return keys;
		});
	}

	// ── Arrivals and originals (ADR-0015, ./originals) ─────────────

	async beginArrival(arrival: Parameters<typeof originals.beginArrival>[1]) {
		return originals.beginArrival(this.ctx.storage, arrival, Date.now());
	}
	async dropArrival(id: string) {
		return originals.dropArrival(this.ctx.storage, id);
	}
	async fileArrival(id: string, filed: originals.Filed) {
		return originals.fileArrival(this.ctx.storage, id, filed, Date.now());
	}
	async filesStored(emailId: string, fileIds: string[]) {
		return originals.filesStored(this.ctx.storage, emailId, fileIds);
	}
	/** One arrival that was left half done; the attempt is counted. */
	async claimArrival(skip: string[]) {
		return originals.claimArrival(this.ctx.storage, Date.now(), skip);
	}
	/** Where a message's original is. For the Worker's two routes only: never an answer. */
	async originalOf(id: string) {
		return originals.originalOf(this.ctx.storage, id);
	}
	/** The keys of every object a message has, to delete them before its rows. */
	async messageKeys(id: string) {
		return originals.messageKeys(this.ctx.storage, id);
	}
	/** The keys of everything this mailbox has in the bucket. */
	async allKeys() {
		return originals.allKeys(this.ctx.storage);
	}

	/** A stored file by its id. One whose bytes have not arrived does not exist yet. */
	async getAttachment(id: string) {
		return (
			this.db
				.select()
				.from(schema.attachments)
				.where(and(eq(schema.attachments.id, id), isNull(schema.attachments.uploading_since)))
				.get() ?? null
		);
	}

	// ── Drafts and their files (ADR-0011, ./drafts) ────────────────

	async saveDraft(id: string, fields: drafts.DraftFields) {
		return drafts.saveDraft(this.ctx.storage, id, fields);
	}
	async declareFile(draftId: string, file: Parameters<typeof drafts.declareFile>[2]) {
		return drafts.declareFile(this.ctx.storage, draftId, file, Date.now());
	}
	async draftFile(draftId: string, fileId: string) {
		return drafts.draftFile(this.ctx.storage, draftId, fileId);
	}
	async markStored(draftId: string, fileId: string) {
		return drafts.markStored(this.ctx.storage, draftId, fileId);
	}
	async removeFile(draftId: string, fileId: string) {
		return drafts.removeFile(this.ctx.storage, draftId, fileId);
	}
	async holdsFiles(id: string) {
		return drafts.holdsFiles(this.ctx.storage, id);
	}
	async sendDraft(id: string, fields: drafts.SentFields) {
		return drafts.sendDraft(this.ctx.storage, id, fields);
	}

	// ── Folders (Drizzle) ──────────────────────────────────────────

	async getFolders() {
		const result = this.db
			.select({
				id: schema.folders.id,
				name: schema.folders.name,
				unreadCount:
					sql<number>`COALESCE(SUM(CASE WHEN ${schema.emails.read} = 0 THEN 1 ELSE 0 END), 0)`.mapWith(
						Number,
					),
			})
			.from(schema.folders)
			.leftJoin(schema.emails, eq(schema.emails.folder_id, schema.folders.id))
			.groupBy(schema.folders.id, schema.folders.name)
			.all();
		return result;
	}

	// ── Labels (ADR-0007; the SQL is in ./labels) ─────────────────

	/** The same rows, each with the labels its conversation carries. */
	#labelled<T extends object>(list: T[]) {
		return labels.withLabels(this.ctx.storage.sql, list);
	}

	async getLabels() {
		return labels.listLabels(this.ctx.storage.sql);
	}

	async createLabel(name: string, color: number) {
		return labels.createLabel(this.ctx.storage.sql, name, color);
	}

	async updateLabel(id: string, change: { name?: string; color?: number }) {
		return labels.updateLabel(this.ctx.storage.sql, id, change);
	}

	async deleteLabel(id: string) {
		return labels.deleteLabel(this.ctx.storage, id);
	}

	async labelConversation(emailId: string, add: string[], remove: string[]) {
		return labels.labelConversation(this.ctx.storage, emailId, add, remove);
	}

	async moveEmail(id: string, folderId: string) {
		const folder = this.db
			.select({ id: schema.folders.id })
			.from(schema.folders)
			.where(eq(schema.folders.id, folderId))
			.get();

		if (!folder) return false;

		this.db
			.update(schema.emails)
			.set({ folder_id: folderId })
			.where(eq(schema.emails.id, id))
			.run();

		return true;
	}

	// ── Deeds on many conversations (ADR-0014, ./deeds) ───────────

	/** Acts on the ticked lines at once, or counts what a filter finds and changes nothing. */
	async bulk(request: deeds.DeedRequest) {
		return deeds.begin(this.ctx.storage, request, Date.now());
	}
	/** One step of a filter deed that was asked for. */
	async runDeed(deedId: string) {
		return steps.run(this.ctx.storage, deedId, Date.now());
	}
	/** One step of taking a deed back. */
	async undoDeed(deedId: string) {
		return steps.undo(this.ctx.storage, deedId, Date.now());
	}

	// ── Search (./search) ──────────────────────────────────────────

	async searchEmails(
		options: SearchFilterOptions & { page?: number; limit?: number; order?: ListOrder },
	) {
		return this.#labelled(searchEmails(this.ctx.storage.sql, options));
	}

	/** Count total search results matching the given filters (for pagination). */
	async countSearchResults(options: SearchFilterOptions) {
		return countSearchResults(this.ctx.storage.sql, options);
	}

	// ── Threading helpers (raw SQL) ────────────────────────────────

	/** The conversation an incoming message joins by what it says it answers (./threads). */
	async findThreadOfReferences(messageIds: string[], subject: string) {
		return threadOfReferences(this.ctx.storage.sql, messageIds, subject);
	}

	async findThreadBySubject(subject: string, senderAddress?: string): Promise<string | null> {
		return threadOfSubject(this.ctx.storage.sql, subject, senderAddress);
	}

	// ── Rate limiting (raw SQL) ────────────────────────────────────

	/** Why the mailbox may not send now, or `null` (./sending). */
	async checkSendRateLimit(): Promise<string | null> {
		return sendRefusal(this.ctx.storage.sql);
	}

	/** Names one batch of what Trash or Spam held at `before`, and its objects (./emptying). */
	async batchToEmpty(place: string, before: string): Promise<BatchToEmpty> {
		return batchToEmpty(this.ctx.storage, place, before);
	}
	/** Deletes the rows of a named batch, after its objects are gone (ADR-0009, ./emptying). */
	async emptyBatch(place: string, before: string, ids: string[]): Promise<EmptiedBatch> {
		return emptyBatch(this.ctx.storage, place, before, ids);
	}

	// ── Email creation (Drizzle) ───────────────────────────────────

	/**
	 * Delete everything this mailbox holds (rule S13). The caller has deleted its objects first
	 * (`allKeys`); this names what it held in the bucket at this moment, so that what arrived
	 * in between is deleted too. After this the object is empty.
	 */
	async purge(): Promise<string[]> {
		const keys = originals.allKeys(this.ctx.storage);
		await this.ctx.storage.deleteAll();
		// The object may live on in memory. Leave it empty but usable, so a mailbox created again at
		// the same address starts from a clean schema instead of from missing tables.
		applyMigrations(this.ctx.storage.sql, mailboxMigrations, this.ctx.storage);
		return keys;
	}

	async createEmail(folder: string, email: EmailData, attachments: AttachmentData[]) {
		// Resolve folder name or ID to the actual folder ID.
		const folderRow = this.db
			.select({ id: schema.folders.id })
			.from(schema.folders)
			.where(or(eq(schema.folders.id, folder), eq(schema.folders.name, folder)))
			.limit(1)
			.get();

		if (!folderRow) {
			throw new Error(
				`createEmail: folder "${folder}" not found. ` +
					"Ensure the folder exists before inserting an email.",
			);
		}

		const folderId = folderRow.id;
		const isSent = folderId === Folders.SENT;

		// Sent emails are always read — the sender obviously knows what they wrote.
		// This prevents sent replies from inflating thread_unread_count.
		this.db
			.insert(schema.emails)
			.values({
				id: email.id,
				folder_id: folderId,
				subject: email.subject,
				sender: email.sender,
				recipient: email.recipient,
				cc: email.cc ?? null,
				bcc: email.bcc ?? null,
				date: email.date,
				read: isSent ? 1 : email.read ? 1 : 0,
				starred: email.starred ? 1 : 0,
				body: email.body,
				in_reply_to: email.in_reply_to ?? null,
				email_references: email.email_references ?? null,
				thread_id: email.thread_id ?? null,
				message_id: email.message_id ?? null,
				raw_headers: email.raw_headers ?? null,
			})
			.run();

		if (attachments.length > 0) {
			this.db.insert(schema.attachments).values(attachments).run();
		}
	}
}
