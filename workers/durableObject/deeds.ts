// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * One request acts on many conversations (ADR-0014). The mailbox object's methods call these.
 *
 * - A **line** is a conversation in a place: the messages that share a thread id and are in the
 *   same place as the message that was named or found. With `unit: "message"` a line is that
 *   message alone.
 * - A **move** takes the whole line. **Read, taking a star and labels** act on every message of
 *   the conversation outside Spam and Trash; **unread and a star** are given to the newest
 *   message of the line. A line in Spam or Trash is marked by itself and takes no label.
 * - A line is changed whole or left out whole, and the answer says how many were left out and
 *   why. Every change sets a state, so doing it twice changes nothing the second time.
 * - A request with ids acts at once. A request with a filter only counts; the deed is then run
 *   in steps (`./deed-steps`), each one transaction, and never takes mail stored after it was
 *   asked.
 * - What each message had before is recorded for an hour, so a deed can be taken back. The
 *   record holds ids, places and marks, never content.
 */
import {
	BULK_LIMITS,
	type BulkChange,
	type BulkCountAnswer,
	type BulkFilter,
	type BulkSkipped,
	type BulkStepAnswer,
	type BulkUnit,
	labelsOf,
	newDeedId,
} from "../../shared/bulk";
import { Folders } from "../../shared/folders";
import { isLabelId, LABEL_LIMITS } from "../../shared/labels";
import { buildSearchConditions } from "./search";

/** What a transaction needs: the object's storage. */
export interface DeedStorage {
	sql: SqlStorage;
	transactionSync: <T>(closure: () => T) => T;
}

/** A request the route has already checked against `BulkRequestSchema`. */
export interface DeedRequest {
	ids?: string[];
	filter?: BulkFilter;
	unit: BulkUnit;
	change: BulkChange;
}

/** A deed as the mailbox keeps it. */
export interface Deed {
	id: string;
	/** The time of asking. A filter deed takes nothing stored after it. */
	askedAt: string;
	unit: BulkUnit;
	change: BulkChange;
	/** Missing for a deed on ticked lines. */
	filter: BulkFilter | null;
	/** What was counted when a filter deed was asked for. */
	conversations: number;
	messages: number;
	startedAt: string | null;
	finishedAt: string | null;
	/** How far a filter deed is: the last found message it read. */
	positionDate: string;
	positionId: string;
	undoStartedAt: string | null;
}

/** A query takes at most 100 bound parameters (docs/cloudflare/ledger.json). */
const CHUNK = 90;
/** What is in these places is marked by itself and takes no label (ADR-0007, decision 4). */
const HIDDEN: readonly string[] = [Folders.SPAM, Folders.TRASH];

export const rows = <T>(cursor: Iterable<unknown>): T[] => [...cursor] as T[];
export const iso = (time: number) => new Date(time).toISOString();
/** `?from, …` for `count` values, to be bound in that order. */
export const marks = (count: number, from = 1) =>
	Array.from({ length: count }, (_value, index) => `?${from + index}`).join(", ");

export function* chunks<T>(list: readonly T[], size = CHUNK): Generator<T[]> {
	for (let start = 0; start < list.length; start += size) yield list.slice(start, start + size);
}

export const noneSkipped = (): BulkSkipped => ({ not_found: 0, place: 0, label_limit: 0 });

// ── The record ─────────────────────────────────────────────────────

interface DeedRow {
	id: string;
	asked_at: string;
	unit: string;
	change: string;
	filter: string | null;
	conversations: number;
	messages: number;
	started_at: string | null;
	finished_at: string | null;
	position_date: string;
	position_id: string;
	undo_started_at: string | null;
}

export function loadDeed(sql: SqlStorage, id: string): Deed | null {
	const row = rows<DeedRow>(sql.exec(`SELECT * FROM deeds WHERE id = ?`, id))[0];
	if (!row) return null;
	return {
		id: row.id,
		askedAt: row.asked_at,
		unit: row.unit === "message" ? "message" : "conversation",
		change: JSON.parse(row.change) as BulkChange,
		filter: row.filter === null ? null : (JSON.parse(row.filter) as BulkFilter),
		conversations: row.conversations,
		messages: row.messages,
		startedAt: row.started_at,
		finishedAt: row.finished_at,
		positionDate: row.position_date,
		positionId: row.position_id,
		undoStartedAt: row.undo_started_at,
	};
}

/**
 * Removes the record of every deed whose hour is over. It runs when the next deed begins
 * (decision 18). A deed that is being taken back is kept until that is an hour old.
 */
function forgetOld(sql: SqlStorage, now: number): void {
	const over = `SELECT id FROM deeds WHERE COALESCE(undo_started_at, started_at, asked_at) < ?1`;
	const before = iso(now - BULK_LIMITS.keptForMs);
	sql.exec(`DELETE FROM deed_changes WHERE deed_id IN (${over})`, before);
	sql.exec(`DELETE FROM deeds WHERE id IN (${over})`, before);
}

/** A message that is deleted for good leaves no row in the record of any deed (rule S13). */
export function forgetChangesOf(sql: SqlStorage, emailIds: readonly string[]): void {
	for (const chunk of chunks(emailIds)) {
		sql.exec(`DELETE FROM deed_changes WHERE email_id IN (${marks(chunk.length)})`, ...chunk);
	}
}

// ── What a filter finds ────────────────────────────────────────────

/**
 * The search route's own conditions for a filter, and nothing stored after `before`. `null`
 * when the filter can find nothing: a label that is asked for and is not one.
 */
export function scopeOf(
	filter: BulkFilter,
	before: string,
): { where: string; params: (string | number)[] } | null {
	if (filter.label !== undefined && !isLabelId(filter.label)) return null;
	const { conditions, params } = buildSearchConditions(
		{ ...filter, query: filter.query ?? "" },
		"e",
	);
	params.push(before);
	conditions.push(`e.date <= ?${params.length}`);
	return { where: conditions.join(" AND "), params };
}

/** The lines a filter finds, and the messages of those lines. */
export function countScope(
	sql: SqlStorage,
	filter: BulkFilter,
	unit: BulkUnit,
	before: string,
): { conversations: number; messages: number } {
	const scope = scopeOf(filter, before);
	if (scope === null) return { conversations: 0, messages: 0 };
	if (unit === "message") {
		const found =
			rows<{ n: number }>(
				sql.exec(`SELECT COUNT(*) AS n FROM emails e WHERE ${scope.where}`, ...scope.params),
			)[0]?.n ?? 0;
		return { conversations: found, messages: found };
	}
	// `before` is the last parameter of the scope; the messages of a line are held to it too.
	const counted = rows<{ conversations: number; messages: number }>(
		sql.exec(
			`WITH found AS (
				SELECT DISTINCT COALESCE(e.thread_id, e.id) AS conversation, e.folder_id AS place
				FROM emails e WHERE ${scope.where}
			)
			SELECT
				(SELECT COUNT(*) FROM found) AS conversations,
				(SELECT COUNT(*) FROM emails m
					JOIN found f ON COALESCE(m.thread_id, m.id) = f.conversation AND m.folder_id = f.place
					WHERE COALESCE(m.date, '') <= ?${scope.params.length}) AS messages`,
			...scope.params,
		),
	)[0];
	return { conversations: counted?.conversations ?? 0, messages: counted?.messages ?? 0 };
}

// ── Acting on lines ────────────────────────────────────────────────

interface Message {
	id: string;
	folder_id: string;
	conversation: string;
	date: string;
	read: number;
	starred: number;
}

const MESSAGE = `id, folder_id, COALESCE(thread_id, id) AS conversation, COALESCE(date, '') AS date,
	COALESCE(read, 0) AS read, COALESCE(starred, 0) AS starred`;

/** The messages of some conversations, named by thread id (which has an index). */
const OF_CONVERSATIONS = (count: number, alias = "") =>
	`(${alias}thread_id IN (${marks(count)}) OR (${alias}thread_id IS NULL AND ${alias}id IN (${marks(count)})))`;

interface Line {
	conversation: string;
	place: string;
	/** The message that was named or found. */
	anchor: string;
}

/** What one chunk of lines changes, as sets of message ids. */
class Plan {
	lines = 0;
	touched = new Set<string>();
	move = new Set<string>();
	readOn = new Set<string>();
	readOff = new Set<string>();
	starOn = new Set<string>();
	starOff = new Set<string>();
	gained = new Map<string, Set<string>>();
	lost = new Map<string, Set<string>>();

	label(into: Map<string, Set<string>>, label: string, id: string) {
		const ids = into.get(label) ?? new Set<string>();
		ids.add(id);
		into.set(label, ids);
	}
}

const newestOf = (messages: readonly Message[]) =>
	messages.reduce((newest, message) =>
		message.date > newest.date || (message.date === newest.date && message.id > newest.id)
			? message
			: newest,
	);

/**
 * Plans what one line changes. Returns why the line is left out, or `null`. A line that is
 * left out adds nothing to the plan.
 */
function planLine(
	plan: Plan,
	line: Line,
	conversation: readonly Message[],
	carried: ReadonlyMap<string, ReadonlySet<string>>,
	deed: Pick<Deed, "unit" | "change">,
): keyof BulkSkipped | null {
	const { change, unit } = deed;
	const { add, remove } = labelsOf(change);
	const inLine =
		unit === "message"
			? conversation.filter((message) => message.id === line.anchor)
			: conversation.filter((message) => message.folder_id === line.place);
	if (inLine.length === 0) return "not_found";

	// A line in Sent goes only to Trash; a draft is not moved here; Spam and Trash take no label.
	if (change.move !== undefined) {
		if (line.place === Folders.DRAFT) return "place";
		if (line.place === Folders.SENT && change.move !== Folders.TRASH) return "place";
	}
	const hidden = HIDDEN.includes(line.place);
	if (add.length + remove.length > 0 && hidden) return "place";
	const outside = conversation.filter((message) => !HIDDEN.includes(message.folder_id));
	const tooMany = (message: Message) => {
		let kept = 0;
		for (const label of carried.get(message.id) ?? []) {
			if (!add.includes(label) && !remove.includes(label)) kept += 1;
		}
		return kept + add.length > LABEL_LIMITS.perMessage;
	};
	if (add.length > 0 && outside.some(tooMany)) return "label_limit";

	const before = plan.touched.size;
	const take = (into: Set<string>, message: Message) => {
		into.add(message.id);
		plan.touched.add(message.id);
	};
	/** What a mark of the conversation takes: all of it outside Spam and Trash, or the line. */
	const marked = unit === "message" || hidden ? inLine : outside;
	const newest = newestOf(inLine);

	if (change.move !== undefined) {
		for (const message of inLine) if (message.folder_id !== change.move) take(plan.move, message);
	}
	if (change.read === true) {
		for (const message of marked) if (message.read === 0) take(plan.readOn, message);
	} else if (change.read === false && newest.read !== 0) take(plan.readOff, newest);
	if (change.starred === false) {
		for (const message of marked) if (message.starred !== 0) take(plan.starOff, message);
	} else if (change.starred === true && newest.starred === 0) take(plan.starOn, newest);
	for (const message of outside) {
		const has = carried.get(message.id);
		for (const label of add) {
			if (has?.has(label)) continue;
			plan.label(plan.gained, label, message.id);
			plan.touched.add(message.id);
		}
		for (const label of remove) {
			if (!has?.has(label)) continue;
			plan.label(plan.lost, label, message.id);
			plan.touched.add(message.id);
		}
	}
	if (plan.touched.size > before) plan.lines += 1;
	return null;
}

/** Writes a plan: for each message what it had, into the record, and then the change. */
function write(sql: SqlStorage, deed: Pick<Deed, "id" | "change">, plan: Plan): void {
	/** Runs once for each chunk of ids: `here` names them, `first` and `second` what follows. */
	const each = (
		ids: ReadonlySet<string>,
		run: (chunk: string[], here: string, first: string, second: string) => void,
	) => {
		for (const chunk of chunks([...ids])) {
			const count = chunk.length;
			run(chunk, `WHERE id IN (${marks(count)})`, `?${count + 1}`, `?${count + 2}`);
		}
	};
	/** Keeps what the named messages had; `was` is a column or a parameter. */
	const record = (kind: string, was: string, deedParam: string, here: string) =>
		`INSERT OR IGNORE INTO deed_changes (deed_id, email_id, kind, was)
			SELECT ${deedParam}, id, '${kind}', ${was} FROM emails ${here}`;

	each(plan.move, (chunk, here, first) => {
		sql.exec(record("place", "folder_id", first, here), ...chunk, deed.id);
		sql.exec(`UPDATE emails SET folder_id = ${first} ${here}`, ...chunk, deed.change.move);
	});
	const mark = (column: "read" | "starred", ids: ReadonlySet<string>, to: 0 | 1) =>
		each(ids, (chunk, here, first) => {
			sql.exec(record(column, `'${1 - to}'`, first, here), ...chunk, deed.id);
			sql.exec(`UPDATE emails SET ${column} = ${to} ${here}`, ...chunk);
		});
	mark("read", plan.readOn, 1);
	mark("read", plan.readOff, 0);
	mark("starred", plan.starOn, 1);
	mark("starred", plan.starOff, 0);

	for (const [label, ids] of plan.gained) {
		each(ids, (chunk, here, first, second) => {
			sql.exec(record("gained", second, first, here), ...chunk, deed.id, label);
			sql.exec(
				`INSERT OR IGNORE INTO email_labels (email_id, label_id) SELECT id, ${first} FROM emails ${here}`,
				...chunk,
				label,
			);
		});
	}
	for (const [label, ids] of plan.lost) {
		each(ids, (chunk, here, first, second) => {
			sql.exec(record("lost", second, first, here), ...chunk, deed.id, label);
			sql.exec(
				`DELETE FROM email_labels WHERE label_id = ${first} AND email_id IN (${marks(chunk.length)})`,
				...chunk,
				label,
			);
		});
	}
}

/**
 * Acts on the lines of the named messages and records what each changed message had. With
 * `before`, nothing stored after it is touched: neither a named message nor one of its line.
 */
export function actOn(
	sql: SqlStorage,
	deed: Pick<Deed, "id" | "unit" | "change">,
	anchors: readonly string[],
	before: string | null,
): { conversations: number; messages: number; skipped: BulkSkipped } {
	const skipped = noneSkipped();
	const named = [...new Set(anchors)];
	/** Nothing stored after the deed was asked for; the time is bound after `count` values. */
	const held = (count: number) =>
		before === null ? "" : `AND COALESCE(date, '') <= ?${count + 1}`;
	const bound = before === null ? [] : [before];

	// The lines: one for each conversation in a place, or one for each message.
	const lines = new Map<string, Line>();
	let known = 0;
	for (const chunk of chunks(named)) {
		const found = rows<Message>(
			sql.exec(
				`SELECT ${MESSAGE} FROM emails WHERE id IN (${marks(chunk.length)}) ${held(chunk.length)}`,
				...chunk,
				...bound,
			),
		);
		known += found.length;
		for (const message of found) {
			const key =
				deed.unit === "message" ? message.id : `${message.conversation}\n${message.folder_id}`;
			if (lines.has(key)) continue;
			lines.set(key, {
				conversation: message.conversation,
				place: message.folder_id,
				anchor: message.id,
			});
		}
	}
	skipped.not_found = named.length - known;

	const ofConversation = new Map<string, Line[]>();
	for (const line of lines.values()) {
		ofConversation.set(line.conversation, [...(ofConversation.get(line.conversation) ?? []), line]);
	}
	const labelling = (() => {
		const { add, remove } = labelsOf(deed.change);
		return add.length + remove.length > 0;
	})();

	let conversations = 0;
	let messages = 0;
	for (const chunk of chunks([...ofConversation.keys()])) {
		const members = new Map<string, Message[]>();
		for (const message of rows<Message>(
			sql.exec(
				`SELECT ${MESSAGE} FROM emails WHERE ${OF_CONVERSATIONS(chunk.length)} ${held(chunk.length)}`,
				...chunk,
				...bound,
			),
		)) {
			members.set(message.conversation, [...(members.get(message.conversation) ?? []), message]);
		}
		const carried = new Map<string, Set<string>>();
		if (labelling) {
			for (const row of rows<{ email_id: string; label_id: string }>(
				sql.exec(
					`SELECT el.email_id, el.label_id FROM email_labels el
						JOIN emails e ON e.id = el.email_id
						WHERE ${OF_CONVERSATIONS(chunk.length, "e.")}`,
					...chunk,
				),
			)) {
				carried.set(row.email_id, (carried.get(row.email_id) ?? new Set()).add(row.label_id));
			}
		}
		const plan = new Plan();
		for (const conversation of chunk) {
			for (const line of ofConversation.get(conversation) ?? []) {
				const why = planLine(plan, line, members.get(conversation) ?? [], carried, deed);
				if (why !== null) skipped[why] += 1;
			}
		}
		write(sql, deed, plan);
		conversations += plan.lines;
		messages += plan.touched.size;
	}
	return { conversations, messages, skipped };
}

// ── Beginning a deed ───────────────────────────────────────────────

/**
 * Begins a deed. With ids it acts at once and answers what it changed. With a filter it changes
 * nothing: it counts, keeps the filter, the change and the time of asking, and answers the
 * count and the deed's id (decision 9). `not_found` when a label of the change is not one of
 * this mailbox; nothing is changed or kept then.
 */
export function begin(
	storage: DeedStorage,
	request: DeedRequest,
	now: number,
): BulkStepAnswer | BulkCountAnswer | "not_found" {
	const { sql } = storage;
	const { add, remove } = labelsOf(request.change);
	const wanted = [...new Set([...add, ...remove])];
	return storage.transactionSync(() => {
		forgetOld(sql, now);
		if (wanted.length > 0) {
			const known = rows(
				sql.exec(`SELECT id FROM labels WHERE id IN (${marks(wanted.length)})`, ...wanted),
			);
			// A label of another mailbox does not exist here.
			if (known.length !== wanted.length) return "not_found";
		}
		const id = newDeedId();
		const at = iso(now);
		const change = JSON.stringify(request.change);
		if (request.filter !== undefined) {
			const counted = countScope(sql, request.filter, request.unit, at);
			sql.exec(
				`INSERT INTO deeds (id, asked_at, unit, change, filter, conversations, messages)
					VALUES (?, ?, ?, ?, ?, ?, ?)`,
				id,
				at,
				request.unit,
				change,
				JSON.stringify(request.filter),
				counted.conversations,
				counted.messages,
			);
			return { deed: id, ...counted };
		}
		sql.exec(
			`INSERT INTO deeds (id, asked_at, unit, change, started_at, finished_at)
				VALUES (?1, ?2, ?3, ?4, ?2, ?2)`,
			id,
			at,
			request.unit,
			change,
		);
		const done = actOn(
			sql,
			{ id, unit: request.unit, change: request.change },
			request.ids ?? [],
			null,
		);
		sql.exec(
			`UPDATE deeds SET conversations = ?, messages = ? WHERE id = ?`,
			done.conversations,
			done.messages,
			id,
		);
		return { deed: id, ...done, more: false };
	});
}
