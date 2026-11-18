// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * The rules of a mailbox in its own database (ADR-0008): blocked senders and filters, in the
 * table `rules`, and the step that runs them when a message arrives.
 *
 * **Rules run once, when a message arrives** (decision 5): after it was parsed and before its
 * row is written. `file` reads the rules, asks the one pure function of `shared/rules.ts` for
 * the outcome, and hands it to the write that files the message, so the message is stored in
 * its place with its marks and labels in one transaction. Nothing here runs on mail that is
 * already stored.
 *
 * **A rule cannot fail a delivery** (decision 6). The pure function never throws, and what
 * surrounds it here is guarded: when the rules cannot be read, the message is filed in the
 * Inbox as if there were none, and the failure is logged as a number.
 *
 * Every query is a constant with bound values: nothing a person or a message wrote is ever
 * part of a statement, and nothing is compared as a pattern.
 */
import { errorFields, log } from "../../shared/log";
import {
	type BlockedSender,
	evaluate,
	factsOf,
	type MessageFacts,
	type Outcome,
	RULE_LIMITS,
	type Rule,
	type RulesAnswer,
	shownRule,
} from "../../shared/rules";
import * as alarm from "./alarm";
import * as autoReply from "./auto-reply";
import * as originals from "./originals";

interface Storage {
	sql: SqlStorage;
	transactionSync: <T>(closure: () => T) => T;
}

const iso = (time: number) => new Date(time).toISOString();
const rows = <T>(cursor: Iterable<unknown>): T[] => [...cursor] as T[];

// ── Reading and changing ───────────────────────────────────────────

function blockedOf(sql: SqlStorage): BlockedSender[] {
	return rows<{ sender: string; set_at: string }>(
		sql.exec(
			`SELECT sender, set_at FROM rules WHERE kind = 'block' AND sender IS NOT NULL
			 ORDER BY sender LIMIT ?1`,
			RULE_LIMITS.blocked,
		),
	).map((row) => ({ sender: row.sender, created_at: row.set_at }));
}

/** The stored filters, in their order. A body that is not JSON is given as it is not: `null`. */
function storedFilters(sql: SqlStorage): { id: string; body: unknown }[] {
	return rows<{ id: string; body: string }>(
		sql.exec(
			`SELECT id, body FROM rules WHERE kind = 'filter' ORDER BY position, id LIMIT ?1`,
			RULE_LIMITS.rules,
		),
	).map((row) => {
		try {
			return { id: row.id, body: JSON.parse(row.body) as unknown };
		} catch {
			return { id: row.id, body: null };
		}
	});
}

/** The rules of the mailbox: its filters in order, and its blocked senders. */
export function list(sql: SqlStorage): RulesAnswer {
	const rules: Rule[] = [];
	for (const { id, body } of storedFilters(sql)) {
		const rule = shownRule(id, body);
		if (rule !== null) rules.push(rule);
	}
	return { rules, blocked: blockedOf(sql) };
}

/**
 * Replaces the filters with this list, in this order (`PUT …/rules`). The caller has parsed
 * the list with the strict schema. Says how many there were and are.
 */
export function replace(
	storage: Storage,
	rules: readonly Rule[],
	by: string,
	now: number,
): { before: number; after: number } | "limit" {
	if (rules.length > RULE_LIMITS.rules) return "limit";
	const { sql } = storage;
	return storage.transactionSync(() => {
		const before = Number(
			[...sql.exec(`SELECT COUNT(*) AS n FROM rules WHERE kind = 'filter'`)][0]?.n ?? 0,
		);
		sql.exec(`DELETE FROM rules WHERE kind = 'filter'`);
		rules.forEach((rule, position) => {
			sql.exec(
				`INSERT INTO rules (id, kind, position, sender, body, set_at, set_by)
				 VALUES (?1, 'filter', ?2, NULL, ?3, ?4, ?5)`,
				rule.id,
				position,
				JSON.stringify({ conditions: rule.conditions, actions: rule.actions }),
				iso(now),
				by,
			);
		});
		return { before, after: rules.length };
	});
}

export type Blocked = { blocked: BlockedSender; made: boolean } | "limit";

/**
 * Blocks a sender (decision 4): a rule of its own kind. `sender` is an address or `@domain`
 * as `blockedSenderOf` gives it. Blocking one that is blocked changes nothing.
 */
export function block(storage: Storage, sender: string, by: string, now: number): Blocked {
	const { sql } = storage;
	return storage.transactionSync((): Blocked => {
		const held = rows<{ sender: string; set_at: string }>(
			sql.exec(`SELECT sender, set_at FROM rules WHERE kind = 'block' AND sender = ?1`, sender),
		)[0];
		if (held !== undefined) {
			return { blocked: { sender: held.sender, created_at: held.set_at }, made: false };
		}
		const count = Number(
			[...sql.exec(`SELECT COUNT(*) AS n FROM rules WHERE kind = 'block'`)][0]?.n ?? 0,
		);
		if (count >= RULE_LIMITS.blocked) return "limit";
		const bytes = crypto.getRandomValues(new Uint8Array(12));
		const id = `blk_${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
		sql.exec(
			`INSERT INTO rules (id, kind, position, sender, body, set_at, set_by)
			 VALUES (?1, 'block', 0, ?2, '{}', ?3, ?4)`,
			id,
			sender,
			iso(now),
			by,
		);
		return { blocked: { sender, created_at: iso(now) }, made: true };
	});
}

/** Unblocks a sender. False when it was not blocked. */
export function unblock(sql: SqlStorage, sender: string): boolean {
	return sql.exec(`DELETE FROM rules WHERE kind = 'block' AND sender = ?1`, sender).rowsWritten > 0;
}

// ── When a message arrives ─────────────────────────────────────────

const INBOX: Outcome = {
	place: "inbox",
	read: false,
	starred: false,
	labels: [],
	blocked: false,
	matched: 0,
	skipped: 0,
};

/**
 * What the rules decide for a message with these facts. Never throws: when the rules cannot
 * be read the message goes to the Inbox, and the failure is logged without a word of it.
 */
export function outcomeFor(sql: SqlStorage, facts: MessageFacts, mailbox: string): Outcome {
	try {
		const outcome = evaluate(
			blockedOf(sql).map((one) => one.sender),
			storedFilters(sql).map((one) => one.body),
			facts,
		);
		if (outcome.skipped > 0) log.warn("rules.skipped", { mailbox, skipped: outcome.skipped });
		return outcome;
	} catch (error) {
		log.error("rules.not_read", { mailbox, ...errorFields(error) });
		return { ...INBOX };
	}
}

/** The envelope sender of an arrival that is not filed yet. */
function envelopeOf(sql: SqlStorage, id: string): string {
	const row = [...sql.exec(`SELECT envelope_from FROM arrivals WHERE id = ?1`, id)][0];
	return typeof row?.envelope_from === "string" ? row.envelope_from : "";
}

/**
 * How an arrival was filed: as `originals.fileArrival` says, and `filed_away` for a message
 * that was stored but not in the Inbox, because the rules filed it elsewhere or its sender is
 * blocked. Only mail in the Inbox wakes the assistant: before the rules, nothing arrived
 * anywhere else, and mail a person filed away is not given to a model.
 */
export type Filing = originals.FiledAs | "filed_away";

/**
 * Files an arrival with the rules applied (ADR-0015, step f; ADR-0008, decision 5), and then
 * asks whether the automatic reply is owed. The message is stored whatever the rules and the
 * reply do: neither can fail the delivery, and a reply that cannot be made is not made.
 */
export async function file(
	ctx: DurableObjectState,
	id: string,
	filed: originals.Filed,
	now: number,
): Promise<Filing> {
	const { storage } = ctx;
	const mailbox = ctx.id.toString();
	const envelopeFrom = envelopeOf(storage.sql, id);
	// A message that could not be read has its envelope sender and nothing else.
	const facts =
		filed.kind === "parsed" && filed.facts !== undefined
			? factsOf(filed.facts)
			: factsOf({ from: envelopeFrom });
	const outcome = outcomeFor(storage.sql, facts, mailbox);
	const stored = originals.fileArrival(storage, id, filed, now, outcome);
	const result: Filing =
		stored === "filed" && (outcome.blocked || outcome.place !== "inbox") ? "filed_away" : stored;
	// Only a message that was read can be answered: of any other nothing is known.
	if (stored !== "filed" || filed.kind !== "parsed" || filed.facts === undefined) return result;
	try {
		const address = ctx.id.name;
		if (address === undefined) return result;
		const blocked = blockedOf(storage.sql).map((one) => one.sender);
		const answer = autoReply.consider(
			storage,
			{ address, envelopeFrom, facts, outcome, blocked },
			now,
		);
		if (answer === "queued") {
			log.info("auto_reply.queued", { mailbox });
			await alarm.set(storage, now);
		}
	} catch (error) {
		log.error("auto_reply.not_made", { mailbox, ...errorFields(error) });
	}
	return result;
}
