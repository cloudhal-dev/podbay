// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * The addresses a mailbox has written to (ADR-0012, decisions 13 to 23).
 *
 * A mailbox learns an address in one place only: `learn`, which the mailbox object calls where
 * it stores a message a person sent. Nothing on the way of incoming mail, of a draft, of the
 * assistant or of MCP calls it, so nothing a stranger sends can add an address or a name.
 *
 * What is kept for an address is the address in lower case, a name that may be absent, how
 * many messages went to it, and when it was first and last written to. Nothing of a message.
 */
import {
	KNOWN_LIMITS,
	type KnownAddress,
	typedForCompletion,
	typedLength,
} from "../../shared/known-addresses";

/** The recipients of a stored sent message, as its row has them, and who sent it. */
export interface SentTo {
	sender: string;
	recipient: string;
	cc?: string | null;
	bcc?: string | null;
}

export interface Learned {
	/** Addresses recorded for this message, each once. */
	recorded: number;
	/** Addresses that could not be recorded. They are counted and never named. */
	skipped: number;
}

/** Whether something is one whole address the table can keep. */
function keepable(address: string): boolean {
	if (typedLength(address) > KNOWN_LIMITS.address) return false;
	const at = address.indexOf("@");
	return (
		at > 0 &&
		at === address.lastIndexOf("@") &&
		at < address.length - 1 &&
		!/[\s<>,;]/.test(address)
	);
}

/** Everyone a message went to, in lower case and each once, without the mailbox itself. */
function recipientsOf(message: SentTo): { addresses: string[]; unkeepable: number } {
	const own = message.sender.trim().toLowerCase();
	const addresses = new Set<string>();
	let unkeepable = 0;
	for (const field of [message.recipient, message.cc, message.bcc]) {
		for (const piece of (field ?? "").split(",")) {
			const address = piece.trim().toLowerCase();
			if (address === "" || address === own) continue;
			if (keepable(address)) addresses.add(address);
			else unkeepable += 1;
		}
	}
	return { addresses: [...addresses], unkeepable };
}

/**
 * Forgets what is too old and what is over the limit: an address not written to for two
 * years, and above the limit the least recently used.
 */
function forgetOld(sql: SqlStorage, now: number): void {
	sql.exec(
		`DELETE FROM known_addresses WHERE last_used_at < ?1`,
		new Date(now - KNOWN_LIMITS.forgottenAfterMs).toISOString(),
	);
	const held = Number([...sql.exec(`SELECT COUNT(*) AS n FROM known_addresses`)][0]?.n ?? 0);
	if (held <= KNOWN_LIMITS.addresses) return;
	sql.exec(
		`DELETE FROM known_addresses WHERE id IN (
			SELECT id FROM known_addresses ORDER BY last_used_at ASC, use_count ASC, id ASC LIMIT ?1
		)`,
		held - KNOWN_LIMITS.addresses,
	);
}

/**
 * Records whom a sent message went to: To, Cc and Bcc, except the mailbox's own address. An
 * address that is known already is counted once more and is the most recent again.
 *
 * It never throws: the message is stored and will be sent whatever happens here. An address
 * that cannot be recorded is skipped and counted.
 */
export function learn(sql: SqlStorage, message: SentTo, now: number): Learned {
	const learned: Learned = { recorded: 0, skipped: 0 };
	let addresses: string[] = [];
	try {
		const to = recipientsOf(message);
		addresses = to.addresses;
		learned.skipped = to.unkeepable;
	} catch {
		return { recorded: 0, skipped: 1 };
	}
	const at = new Date(now).toISOString();
	for (const address of addresses) {
		try {
			// The sending bodies carry no name for a recipient yet (decision 16), so none is given
			// here; a name the row has is kept.
			sql.exec(
				`INSERT INTO known_addresses (id, address, name, name_key, use_count, last_used_at, created_at)
				 VALUES (?1, ?2, NULL, NULL, 1, ?3, ?3)
				 ON CONFLICT (address) DO UPDATE SET use_count = use_count + 1, last_used_at = excluded.last_used_at`,
				crypto.randomUUID(),
				address,
				at,
			);
			learned.recorded += 1;
		} catch {
			learned.skipped += 1;
		}
	}
	try {
		if (learned.recorded > 0) forgetOld(sql, now);
	} catch {
		// Forgetting is tried again at the next send.
	}
	return learned;
}

/**
 * The known addresses that what was typed could become, best first: more used, then more
 * recent. What was typed must begin the address, the part after its `@`, or the name. It is
 * compared as text, without regard to case, and is never part of a pattern: nothing typed is a
 * wildcard, and the limit on the length of a pattern does not apply. At most a handful, and
 * no way to ask for the rest.
 */
export function complete(sql: SqlStorage, typed: string): KnownAddress[] {
	const wanted = typedForCompletion(typed)?.toLowerCase();
	if (wanted === undefined || wanted === "") return [];
	const length = typedLength(wanted);
	const rows = sql.exec(
		`SELECT id, address, name FROM known_addresses
		 WHERE substr(address, 1, ?2) = ?1
		    OR substr(address, instr(address, '@') + 1, ?2) = ?1
		    OR (name_key IS NOT NULL AND substr(name_key, 1, ?2) = ?1)
		 ORDER BY use_count DESC, last_used_at DESC, address ASC
		 LIMIT ?3`,
		wanted,
		length,
		KNOWN_LIMITS.suggestions,
	);
	return [...rows].map((row) => ({
		id: String(row.id),
		address: String(row.address),
		name: row.name === null ? null : String(row.name),
	}));
}

/** Forgets one address. False when there is none with this id. */
export function forgetOne(sql: SqlStorage, id: string): boolean {
	const there = [...sql.exec(`SELECT 1 FROM known_addresses WHERE id = ?1`, id)].length > 0;
	if (there) sql.exec(`DELETE FROM known_addresses WHERE id = ?1`, id);
	return there;
}

/** Forgets every address. Says how many there were, and nothing else about them. */
export function forgetAll(sql: SqlStorage): number {
	const held = Number([...sql.exec(`SELECT COUNT(*) AS n FROM known_addresses`)][0]?.n ?? 0);
	sql.exec(`DELETE FROM known_addresses`);
	return held;
}
