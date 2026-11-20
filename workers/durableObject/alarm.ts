// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * The mailbox object's one alarm (ADR-0016, decisions 17 and 18).
 *
 * An object has a single alarm, so everything the mailbox waits for is kept in rows and the
 * alarm is set to the earliest of those times (docs/cloudflare/ledger.json). `set` is the one
 * function that sets it. Every write that changes one of the times calls it, and so does the
 * end of every run.
 *
 * **Each kind of waiting is one entry of `TIMED`**: the times it waits for, and what it does
 * when the alarm runs. Outgoing mail is the only kind today. Snooze ([ADR-0010]) adds an entry
 * before it (waking snoozed mail is local and safe to repeat, so it goes first), with the
 * `snoozed_until` of each snoozed message as its times; `set` and `wake` stay as they are.
 *
 * **Asleep, late, twice, lost.** Asleep: nothing is in memory, a run reads rows. Late: a run
 * acts on the state it finds, never on the clock alone. Twice: a run that finds nothing due
 * does nothing. Lost: the platform tries a handler that throws only six times, so `wake`
 * catches every error of every kind and always sets the next alarm; and whenever the object
 * wakes for any reason, `repair` sets the alarm again when something waits and none is set.
 */
import { errorFields, log } from "@podbay/platform/log";
import { type Leaver, leave } from "./leaving";
import { leavingTimes } from "./submissions";

/** One kind of thing the mailbox waits for. */
interface Timed {
	name: string;
	/** Every time this kind waits for, in milliseconds. */
	times(sql: SqlStorage, now: number): number[];
	/**
	 * What it does when the alarm runs. It may answer a time before which the mailbox need not
	 * be woken for it again, when something stood in its way.
	 */
	run(object: Leaver, clock: () => number): Promise<number | undefined>;
}

/** Everything the mailbox waits for, in the order a run takes it. ADR-0010 adds snooze first. */
const TIMED: readonly Timed[] = [{ name: "leaving", times: leavingTimes, run: leave }];

/** How soon a kind that threw is looked at again. */
const AFTER_AN_ERROR_MS = 60_000;

/** The earliest of all the times the mailbox waits for, or `null` when it waits for nothing. */
export function nextTime(sql: SqlStorage, now: number): number | null {
	const times = TIMED.flatMap((kind) => kind.times(sql, now));
	return times.length === 0 ? null : Math.min(...times);
}

/**
 * Sets the alarm to the earliest time the mailbox waits for, or takes it off when it waits
 * for nothing. `notBefore` holds it back after a run that could not do its work. Returns the
 * time it is set to.
 */
export async function set(
	storage: DurableObjectStorage,
	now: number,
	notBefore?: number,
): Promise<number | null> {
	const earliest = nextTime(storage.sql, now);
	if (earliest === null) {
		await storage.deleteAlarm();
		return null;
	}
	const at = Math.max(earliest, notBefore ?? 0);
	await storage.setAlarm(at);
	return at;
}

/**
 * A run of the alarm. Each kind is guarded, so one cannot stop another, and nothing thrown
 * leaves this function: whatever happened, the next alarm is set.
 */
export async function wake(object: Leaver, clock: () => number = Date.now): Promise<void> {
	const mailbox = object.ctx.id.toString();
	let notBefore: number | undefined;
	const hold = (until: number | undefined) => {
		if (until !== undefined) notBefore = Math.max(notBefore ?? 0, until);
	};
	for (const kind of TIMED) {
		try {
			hold(await kind.run(object, clock));
		} catch (error) {
			log.error("alarm.run_failed", { mailbox, kind: kind.name, ...errorFields(error) });
			hold(clock() + AFTER_AN_ERROR_MS);
		}
	}
	try {
		await set(object.ctx.storage, clock(), notBefore);
	} catch (error) {
		log.error("alarm.not_set", { mailbox, ...errorFields(error) });
		// The times could not be read. The mailbox is woken again all the same, so that what
		// waits is not left without an alarm.
		try {
			await object.ctx.storage.setAlarm(clock() + AFTER_AN_ERROR_MS);
		} catch (again) {
			log.error("alarm.not_set", { mailbox, ...errorFields(again) });
		}
	}
}

/**
 * Called whenever the object wakes: when something waits and no alarm is set, sets it. An
 * alarm can be lost (a handler that threw six times, an alarm held too long while an
 * account's spending limit blocked its objects); the rows are still there.
 */
export function repair(ctx: DurableObjectState): void {
	void ctx.blockConcurrencyWhile(async () => {
		try {
			const now = Date.now();
			if (nextTime(ctx.storage.sql, now) === null) return;
			if ((await ctx.storage.getAlarm()) === null) await set(ctx.storage, now);
		} catch (error) {
			log.error("alarm.not_repaired", { mailbox: ctx.id.toString(), ...errorFields(error) });
		}
	});
}
