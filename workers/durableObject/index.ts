// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified by the Podbay contributors.

import { DurableObject } from "cloudflare:workers";
import type { SQL } from "drizzle-orm";
import { and, asc, desc, eq, isNull, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/durable-sqlite";
import { Folders } from "../../shared/folders";
import { SENDING } from "../../shared/sending";
import * as schema from "../db/schema";
import type { ListOrder, SearchFilterOptions } from "../lib/list-options";
import type { Env } from "../types";
import * as alarm from "./alarm";
import { countConversations, listConversations } from "./conversations";
import * as steps from "./deed-steps";
import * as deeds from "./deeds";
import * as drafts from "./drafts";
import { type BatchToEmpty, batchToEmpty, type EmptiedBatch, emptyBatch } from "./emptying";
import * as known from "./known";
import * as labels from "./labels";
import * as live from "./live";
import { applyMigrations, mailboxMigrations } from "./migrations";
import * as originals from "./originals";
import { countSearchResults, searchEmails } from "./search";
import type { AttachmentData, EmailData, GetEmailsOptions } from "./shapes";
import * as submissions from "./submissions";
import { threadOfReferences, threadOfSubject } from "./threads";

/** What a method answers for a message that waits to leave: nothing else changes it. */
const SCHEDULED = "scheduled" as const;

export class MailboxDO extends DurableObject<Env> {
	declare __DURABLE_OBJECT_BRAND: never;
	db: ReturnType<typeof drizzle>;
	/** How long the sending service is waited for. A test shortens it; nothing else sets it. */
	answerWithinMs: number = SENDING.answerWithinMs;

	constructor(state: DurableObjectState, env: Env) {
		super(state, env);
		this.db = drizzle(this.ctx.storage, { schema });
		applyMigrations(this.ctx.storage.sql, mailboxMigrations, this.ctx.storage);
		live.answerPings(this.ctx);
		// Whenever the object wakes: something waits and no alarm is set, so it is set (ADR-0016).
		alarm.repair(this.ctx);
	}

	// ── Telling the open app (ADR-0013, ./live) ────────────────────

	/**
	 * Every method of this class is wrapped here, once: a call that changed a row moves the
	 * counters it is about and tells the open app. A method that writes needs to do nothing
	 * for it, and cannot leave it out; what it is about, when that is not mail, is `live.ABOUT`.
	 */
	static {
		live.watch(MailboxDO.prototype, (object) => object.ctx);
	}

	/** The one request this object takes: a connection the guard allowed, built by the Worker. */
	async fetch(request: Request) {
		return live.accept(this.ctx, request, Date.now());
	}
	/** The app says `ping`, which the platform answers. Anything else ends the connection. */
	async webSocketMessage(ws: WebSocket) {
		live.refuse(this.ctx, ws);
	}
	async webSocketClose(_ws: WebSocket, code: number) {
		live.gone(this.ctx, code);
	}
	/** Closes the connections of a person whose right ended, or all of them. */
	async closeLive(person?: string) {
		return live.end(this.ctx, person);
	}
	/** The mailbox's settings are in the index; the route that saved them says so here. */
	async settingsSaved() {
		live.move(this.ctx.storage.sql, ["settings"]);
	}

	// ── Email CRUD (Drizzle) ───────────────────────────────────────

	async getEmails(options: GetEmailsOptions = {}) {
		const { folder, thread_id, page = 1, limit: rawLimit = 25, order } = options;
		// What waits is listed soonest first, whatever order was asked for (ADR-0016, decision 2).
		if (folder === Folders.SCHEDULED && !thread_id) {
			return this.#shown(
				submissions.listScheduled(this.ctx.storage.sql, { page, limit: rawLimit }),
			);
		}

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
		return this.#shown(list);
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

	// ── Lists by conversation (./conversations) ────────────────────

	async getThreadedEmails(options: GetEmailsOptions = {}) {
		const { folder } = options;
		if (!folder) return this.getEmails(options);
		// What waits is listed by its time, each message a line of its own (ADR-0016).
		if (folder === Folders.SCHEDULED) return this.getEmails(options);
		return this.#shown(listConversations(this.ctx.storage.sql, { ...options, folder }));
	}

	/** How many lines a place has by conversation (for pagination). */
	async countThreadedEmails(folder: string) {
		if (folder === Folders.SCHEDULED) return this.countEmails({ folder });
		return countConversations(this.ctx.storage.sql, folder);
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
		return this.#shown([{ ...one, attachments: emailAttachments }])[0] ?? null;
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
		return this.#shown(list);
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
		// A message that waits to leave is changed by nothing but its own way out (ADR-0016).
		if (submissions.inScheduled(this.ctx.storage.sql, id)) return SCHEDULED;

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
	 * deleted its objects first (`messageKeys`, `workers/lib/messages.ts`). A message that waits
	 * to leave is not deleted: it is taken back first.
	 */
	async deleteEmail(id: string) {
		return this.ctx.storage.transactionSync(() => {
			if (submissions.inScheduled(this.ctx.storage.sql, id)) return SCHEDULED;
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
		if (submissions.inScheduled(this.ctx.storage.sql, id)) return SCHEDULED;
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

	// ── Outgoing mail (ADR-0016, ./submissions, ./leaving, ./alarm) ─

	/**
	 * Takes a message a person sent: it waits in Scheduled and leaves at its time. Nothing is
	 * handed to the sending service here. The assistant and MCP get a handle on the mailbox
	 * without this method and the three after it (`workers/agent/tools.ts`).
	 */
	async submit(message: submissions.ToTake) {
		const taken = submissions.take(this.ctx.storage, message, Date.now());
		if (!("refused" in taken)) await alarm.set(this.ctx.storage, Date.now());
		return taken;
	}
	/** Takes a waiting message back into Drafts, or the mark off a message that failed. */
	async unsend(id: string) {
		const back = submissions.takeBack(this.ctx.storage, id, Date.now());
		if (back === "draft") await alarm.set(this.ctx.storage, Date.now());
		return back;
	}
	/** Gives a waiting message a new time; `by` is whose right is asked when it leaves. */
	async reschedule(id: string, sendAt: number, by: string) {
		const given = submissions.giveTime(this.ctx.storage, id, sendAt, by, Date.now());
		if (typeof given !== "string") await alarm.set(this.ctx.storage, Date.now());
		return given;
	}
	/**
	 * The alarm: mail whose time has come leaves, and the alarm is set to the next time. It
	 * catches its own errors (`./alarm`), and like every write it tells the open app.
	 */
	async alarm() {
		await alarm.wake({ ctx: this.ctx, env: this.env, answerWithinMs: this.answerWithinMs });
	}

	// ── Known addresses (ADR-0012, ./known) ────────────────────────
	// A mailbox learns an address in one place: where a message has left (`./leaving`).

	/** The known addresses that what is typed could become: a handful, best first. */
	async completeAddress(typed: string) {
		return known.complete(this.ctx.storage.sql, typed);
	}
	async forgetAddress(id: string) {
		return known.forgetOne(this.ctx.storage.sql, id);
	}
	async forgetAddresses() {
		return known.forgetAll(this.ctx.storage.sql);
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
		// How many wait to leave, and how many drafts came back unsent (ADR-0016, decision 9).
		const marks = submissions.placeMarks(this.ctx.storage.sql);
		return result.map((place) =>
			place.id === Folders.SCHEDULED
				? { ...place, waiting: marks.waiting }
				: place.id === Folders.DRAFT
					? { ...place, notSent: marks.notSent }
					: place,
		);
	}

	// ── Labels (ADR-0007; the SQL is in ./labels) ─────────────────

	/**
	 * The same rows, each with the labels its conversation carries, and with what a message
	 * says about its way out when it has a row in `submissions` (ADR-0016).
	 */
	#shown<T extends object>(list: T[]) {
		const { sql } = this.ctx.storage;
		return submissions.withSubmissions(sql, labels.withLabels(sql, list));
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
		if (submissions.inScheduled(this.ctx.storage.sql, emailId)) return SCHEDULED;
		return labels.labelConversation(this.ctx.storage, emailId, add, remove);
	}

	/**
	 * Moves one message. Scheduled is neither a source nor a target: a message enters and
	 * leaves it only by being sent, taken back or let go (ADR-0016, decision 2).
	 */
	async moveEmail(id: string, folderId: string) {
		if (folderId === Folders.SCHEDULED) return SCHEDULED;
		if (submissions.inScheduled(this.ctx.storage.sql, id)) return SCHEDULED;
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
		return this.#shown(searchEmails(this.ctx.storage.sql, options));
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

	// ── Emptying (ADR-0009, ./emptying) ────────────────────────────

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
		// A mailbox that is gone tells nobody anything (ADR-0013, decision 12).
		live.end(this.ctx);
		// A deleted mailbox sends nothing: the rows that wait go with everything else, and the
		// alarm with them (ADR-0016, decision 21; docs/cloudflare/ledger.json).
		await this.ctx.storage.deleteAlarm();
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
		// Sent holds only mail that left, and Scheduled only mail on its way: neither is filled
		// by storing a message (ADR-0016, decision 2).
		if (folderId === Folders.SENT || folderId === Folders.SCHEDULED) {
			throw new Error(`createEmail: nothing is stored into "${folderId}".`);
		}

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
				read: email.read ? 1 : 0,
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
