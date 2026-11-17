// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * The steps of a deed on everything a filter finds, and of taking any deed back (ADR-0014,
 * decisions 9 to 20). A step is one call and one transaction: it reads the next found messages,
 * acts on their lines, moves the deed's position, and writes all of it or none. The mailbox
 * keeps the position, so a step that is sent twice continues and does nothing twice.
 */
import {
	BULK_LIMITS,
	type BulkChange,
	type BulkStepAnswer,
	type BulkUndoAnswer,
} from "../../shared/bulk";
import { Folders } from "../../shared/folders";
import {
	actOn,
	chunks,
	countScope,
	type Deed,
	type DeedStorage,
	iso,
	loadDeed,
	marks,
	noneSkipped,
	rows,
	scopeOf,
} from "./deeds";

/** Why a step was refused. Nothing was changed. */
export type DeedRefusal =
	/** No such deed here, or not one that runs in steps. */
	| "not_found"
	/** Not started within ten minutes of asking: the app asks again. */
	| "late"
	/** The scope now holds more conversations than the person was shown. */
	| "grew"
	/** The deed was taken back, or is being taken back. */
	| "undone"
	/** The hour in which a deed can be taken back is over. */
	| "expired";

/** What the audit log is told when a filter deed starts or is undone: never the filter. */
export interface DeedNotice {
	change: BulkChange;
	conversations: number;
	messages: number;
}

/** `began` is set on the call that started the deed, and only then. */
export type RunAnswer = BulkStepAnswer & { began?: DeedNotice };
/** `began` is set on the call that started taking a filter deed back. */
export type UndoAnswer = BulkUndoAnswer & { began?: DeedNotice };

/**
 * One step of a filter deed. The first step is refused when it comes too late or when the scope
 * grew since the person was shown its size; a deed that is done answers that nothing is left.
 */
export function run(storage: DeedStorage, deedId: string, now: number): RunAnswer | DeedRefusal {
	const { sql } = storage;
	return storage.transactionSync(() => {
		const deed = loadDeed(sql, deedId);
		if (deed === null || deed.filter === null) return "not_found";
		if (deed.undoStartedAt !== null) return "undone";
		const nothing = {
			deed: deed.id,
			conversations: 0,
			messages: 0,
			skipped: noneSkipped(),
			more: false,
		};
		if (deed.finishedAt !== null) return nothing;

		let began: DeedNotice | undefined;
		if (deed.startedAt === null) {
			if (now - Date.parse(deed.askedAt) > BULK_LIMITS.startWithinMs) return "late";
			// What was counted is what is acted on: the scope is counted again, as it was asked.
			const counted = countScope(sql, deed.filter, deed.unit, deed.askedAt);
			if (counted.conversations > deed.conversations) return "grew";
			sql.exec(`UPDATE deeds SET started_at = ? WHERE id = ?`, iso(now), deed.id);
			began = {
				change: deed.change,
				conversations: deed.conversations,
				messages: deed.messages,
			};
		}

		const scope = scopeOf(deed.filter, deed.askedAt);
		const found =
			scope === null
				? []
				: rows<{ id: string; date: string }>(
						sql.exec(
							`SELECT e.id, e.date FROM emails e
								WHERE ${scope.where}
									AND (e.date > ?${scope.params.length + 1}
										OR (e.date = ?${scope.params.length + 1} AND e.id > ?${scope.params.length + 2}))
								ORDER BY e.date, e.id
								LIMIT ${BULK_LIMITS.step + 1}`,
							...scope.params,
							deed.positionDate,
							deed.positionId,
						),
					);
		const batch = found.slice(0, BULK_LIMITS.step);
		const more = found.length > BULK_LIMITS.step;
		const done = actOn(
			sql,
			deed,
			batch.map((message) => message.id),
			deed.askedAt,
		);
		const last = batch.at(-1);
		sql.exec(
			`UPDATE deeds SET position_date = ?, position_id = ?, finished_at = ? WHERE id = ?`,
			last?.date ?? deed.positionDate,
			last?.id ?? deed.positionId,
			more ? null : iso(now),
			deed.id,
		);
		return { deed: deed.id, ...done, more, ...(began ? { began } : {}) };
	});
}

interface Change {
	email_id: string;
	kind: string;
	was: string;
}

interface State {
	id: string;
	folder_id: string;
	read: number;
	starred: number;
}

/** Whether a message is still as the deed left it, in everything the deed changed on it. */
function asLeft(
	change: BulkChange,
	recorded: readonly Change[],
	state: State,
	carried: ReadonlySet<string> | undefined,
): boolean {
	return recorded.every((one) => {
		if (one.kind === "place") return state.folder_id === change.move;
		if (one.kind === "read") return state.read === (change.read ? 1 : 0);
		if (one.kind === "starred") return state.starred === (change.starred ? 1 : 0);
		if (one.kind === "gained") return carried?.has(one.was) === true;
		if (one.kind === "lost") return carried?.has(one.was) !== true;
		return false;
	});
}

/**
 * Puts back the named messages of a deed's record and removes their rows from it. A message
 * that was moved, marked or labelled again since the deed is left alone. Returns how many were
 * put back.
 */
function putBack(
	sql: SqlStorage,
	deed: Deed,
	ids: readonly string[],
	labels: ReadonlySet<string>,
): number {
	const here = marks(ids.length);
	const next = `?${ids.length + 1}`;
	const recorded = new Map<string, Change[]>();
	for (const row of rows<Change>(
		sql.exec(
			`SELECT email_id, kind, was FROM deed_changes WHERE deed_id = ${next} AND email_id IN (${here})`,
			...ids,
			deed.id,
		),
	)) {
		recorded.set(row.email_id, [...(recorded.get(row.email_id) ?? []), row]);
	}
	const carried = new Map<string, Set<string>>();
	for (const row of rows<{ email_id: string; label_id: string }>(
		sql.exec(`SELECT email_id, label_id FROM email_labels WHERE email_id IN (${here})`, ...ids),
	)) {
		carried.set(row.email_id, (carried.get(row.email_id) ?? new Set()).add(row.label_id));
	}

	/** What to write: for each kind and what was there before, the messages that get it back. */
	const back = new Map<string, { kind: string; was: string; ids: string[] }>();
	let restored = 0;
	for (const state of rows<State>(
		sql.exec(
			`SELECT id, folder_id, COALESCE(read, 0) AS read, COALESCE(starred, 0) AS starred
				FROM emails WHERE id IN (${here})`,
			...ids,
		),
	)) {
		const changes = recorded.get(state.id) ?? [];
		// A message that was sent since and waits to leave is left as it is (ADR-0016).
		if (state.folder_id === Folders.SCHEDULED) continue;
		if (!asLeft(deed.change, changes, state, carried.get(state.id))) continue;
		restored += 1;
		for (const one of changes) {
			// A label that was deleted since cannot be given back.
			if (one.kind === "lost" && !labels.has(one.was)) continue;
			const key = `${one.kind}\n${one.was}`;
			const group = back.get(key) ?? { kind: one.kind, was: one.was, ids: [] };
			group.ids.push(state.id);
			back.set(key, group);
		}
	}

	for (const { kind, was, ids: group } of back.values()) {
		const these = `(${marks(group.length)})`;
		const value = `?${group.length + 1}`;
		if (kind === "place") {
			// Also a sent message back into Sent: from the record, never from a request.
			sql.exec(`UPDATE emails SET folder_id = ${value} WHERE id IN ${these}`, ...group, was);
		} else if (kind === "read" || kind === "starred") {
			sql.exec(
				`UPDATE emails SET ${kind} = ${value} WHERE id IN ${these}`,
				...group,
				was === "1" ? 1 : 0,
			);
		} else if (kind === "gained") {
			sql.exec(
				`DELETE FROM email_labels WHERE label_id = ${value} AND email_id IN ${these}`,
				...group,
				was,
			);
		} else if (kind === "lost") {
			sql.exec(
				`INSERT OR IGNORE INTO email_labels (email_id, label_id)
					SELECT id, ${value} FROM emails WHERE id IN ${these}`,
				...group,
				was,
			);
		}
	}
	sql.exec(
		`DELETE FROM deed_changes WHERE deed_id = ${next} AND email_id IN (${here})`,
		...ids,
		deed.id,
	);
	return restored;
}

/**
 * One step of taking a deed back, within the hour its record is kept. It puts back each message
 * that is still as the deed left it, and ends the deed: a deed that was taken back runs no
 * further step.
 */
export function undo(storage: DeedStorage, deedId: string, now: number): UndoAnswer | DeedRefusal {
	const { sql } = storage;
	return storage.transactionSync(() => {
		const deed = loadDeed(sql, deedId);
		if (deed === null) return "not_found";

		let began: DeedNotice | undefined;
		if (deed.undoStartedAt === null) {
			const acted = Date.parse(deed.startedAt ?? deed.askedAt);
			if (now - acted > BULK_LIMITS.keptForMs) return "expired";
			sql.exec(`UPDATE deeds SET undo_started_at = ? WHERE id = ?`, iso(now), deed.id);
			if (deed.filter !== null) {
				const recorded =
					rows<{ n: number }>(
						sql.exec(
							`SELECT COUNT(DISTINCT email_id) AS n FROM deed_changes WHERE deed_id = ?`,
							deed.id,
						),
					)[0]?.n ?? 0;
				began = { change: deed.change, conversations: deed.conversations, messages: recorded };
			}
		}

		const recorded = rows<{ email_id: string }>(
			sql.exec(
				`SELECT DISTINCT email_id FROM deed_changes WHERE deed_id = ?
					ORDER BY email_id LIMIT ${BULK_LIMITS.step + 1}`,
				deed.id,
			),
		).map((row) => row.email_id);
		const labels = new Set(
			rows<{ id: string }>(sql.exec(`SELECT id FROM labels`)).map((label) => label.id),
		);
		let messages = 0;
		for (const chunk of chunks(recorded.slice(0, BULK_LIMITS.step))) {
			messages += putBack(sql, deed, chunk, labels);
		}
		return { messages, more: recorded.length > BULK_LIMITS.step, ...(began ? { began } : {}) };
	});
}
