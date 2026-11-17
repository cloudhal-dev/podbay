// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * A person's choices in D1 (ADR-0012): one row for a person, read and merged by their own id
 * and by nothing else. The Worker stores them and decides nothing by them.
 */
import {
	CHOICES_VERSION,
	type ChoicesAnswer,
	type ChoicesChange,
	readDocument,
} from "../../shared/choices";

const EMPTY = `{"v":${CHOICES_VERSION}}`;

function answer(row: { choices: string; rev: number } | null): ChoicesAnswer {
	if (row === null) return { choices: readDocument(null), rev: 0 };
	let stored: unknown = null;
	try {
		stored = JSON.parse(row.choices);
	} catch {
		// A document that cannot be read is one without choices.
	}
	return { choices: readDocument(stored), rev: row.rev };
}

const read = (db: D1Database, userId: string) =>
	db.prepare(`select "choices", "rev" from "user_choices" where "user_id" = ?1`).bind(userId);

/** The person's document, or one without choices and `rev` 0 when they never chose. */
export async function choicesOf(db: D1Database, userId: string): Promise<ChoicesAnswer> {
	return answer(await read(db, userId).first<{ choices: string; rev: number }>());
}

/**
 * Merges a change into the person's document and gives the whole document back.
 *
 * The merge is one statement, so two changes at once to different choices both stay: SQLite's
 * `json_patch` lays the change over what is stored, takes out a key whose value is `null`, and
 * leaves every other key alone, one this version does not know included. A document of a
 * later version is not written: the statement changes nothing and the answer is `"newer"`.
 * The read after it is in the same batch, which is one transaction.
 */
export async function mergeChoices(
	db: D1Database,
	userId: string,
	change: ChoicesChange,
	now: string,
): Promise<ChoicesAnswer | "newer"> {
	const [merged, stored] = await db.batch<{ choices: string; rev: number }>([
		db
			.prepare(
				`insert into "user_choices" ("user_id", "choices", "rev", "updated_at")
				 values (?1, json_patch(?4, ?2), 1, ?3)
				 on conflict ("user_id") do update set
				   "choices" = json_patch(
				     case when json_valid("user_choices"."choices") then "user_choices"."choices" else ?4 end,
				     ?2
				   ),
				   "rev" = "user_choices"."rev" + 1,
				   "updated_at" = ?3
				 where case when json_valid("user_choices"."choices")
				   then coalesce(json_extract("user_choices"."choices", '$.v'), ?5)
				   else ?5 end <= ?5`,
			)
			.bind(userId, JSON.stringify(change), now, EMPTY, CHOICES_VERSION),
		read(db, userId),
	]);
	if ((merged?.meta.changes ?? 0) === 0) return "newer";
	return answer(stored?.results[0] ?? null);
}
