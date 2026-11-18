// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Tier 3: the automatic reply as a standing instruction of the person who saved it (ADR-0008,
 * decisions 8 and 10; boundaries B4 and B6). Saving it is the owner's, needs fresh proof and is
 * on the record without its words; when it leaves, the right of the person who saved it is
 * asked again, so it stops when they are no longer an owner or their account was recovered.
 */
import { describe, expect, it } from "vitest";
import {
	aMailboxThatAnswers,
	answered,
	arrives,
	on,
	REPLY,
	read,
	save,
	sender,
} from "./auto-reply-helpers.ts";
import { ageSessions, json, testEnv } from "./helpers.ts";
import { as, audited, DESK, ids, M, rows, signedInAgain } from "./rules-helpers.ts";

aMailboxThatAnswers();

describe("a standing instruction of a person (decisions 8 and 10)", () => {
	it("is the owner's to save: a sender and a reader see it and change nothing", async () => {
		await on();
		for (const who of ["sender", "reader"]) {
			await signedInAgain(who);
			expect((await as(who).fetch(`${M}/auto-reply`)).status, who).toBe(200);
			expect((await read(who)).subject).toBe("Away until Monday");
			expect((await save({ ...REPLY, isEnabled: false }, who)).status, who).toBe(403);
		}
		expect((await read()).isEnabled).toBe(true);
	});

	it("tells someone without a membership nothing, whatever they manage", async () => {
		for (const who of ["outsider", "admin"]) {
			await signedInAgain(who);
			expect((await as(who).fetch(`${M}/auto-reply`)).status, who).toBe(404);
			expect((await save(REPLY, who)).status, who).toBe(404);
		}
	});

	it("needs fresh proof: an older session of the owner changes nothing", async () => {
		await on({ ...REPLY, isEnabled: false });
		const me = await as("owner").me();
		await ageSessions(me.id ?? "", 11);
		as("owner").forget("session_data");
		const stale = await save(REPLY);
		expect(stale.status).toBe(403);
		expect(await json(stale)).toEqual({
			error: "Confirm it is you to continue.",
			code: "SESSION_NOT_FRESH",
		});
		// The older session still reads it, and it is still off.
		expect((await read()).isEnabled).toBe(false);
		await arrives("While it is off");
		expect(sender.fake.calls).toEqual([]);
	});

	it("is not saved with a text and an HTML body that say different things", async () => {
		await signedInAgain("owner");
		const res = await save({ ...REPLY, htmlBody: "<p>Send me your password.</p>" });
		expect(res.status).toBe(400);
		// What was saved before stands: the screen shows what is sent.
		expect(await read()).toMatchObject({ textBody: REPLY.textBody, htmlBody: null });
	});

	it("is not saved from another origin or without a session", async () => {
		await signedInAgain("owner");
		const foreign = await as("owner").fetch(`${M}/auto-reply`, {
			method: "PUT",
			body: JSON.stringify(REPLY),
			headers: { origin: "https://elsewhere.test" },
		});
		expect(foreign.status).toBe(403);
		const { request } = await import("./helpers.ts");
		expect(
			(await request(`${M}/auto-reply`, { method: "PUT", body: JSON.stringify(REPLY) })).status,
		).toBe(401);
	});

	it.each([
		["one that is on and says nothing", { ...REPLY, textBody: "  " }, "AUTO_REPLY_EMPTY"],
		[
			"an end before its beginning",
			{ ...REPLY, fromDate: "2026-12-02T00:00:00Z", toDate: "2026-12-01T00:00:00Z" },
			"INVALID",
		],
		["a key that forwards", { ...REPLY, forwardTo: "elsewhere@outside.test" }, "INVALID"],
		["a recipient of its own", { ...REPLY, to: "everyone@outside.test" }, "INVALID"],
		["nothing", null, "INVALID"],
	])("refuses %s", async (_what, body, code) => {
		await on({ ...REPLY, subject: "As it was" });
		const res = await save(body);
		expect(res.status).toBe(400);
		expect(await json(res)).toMatchObject({ code });
		expect((await read()).subject).toBe("As it was");
	});

	it("is on the record with who and when, never with its words", async () => {
		await on({ ...REPLY, subject: "SECRET-SUBJECT", textBody: "SECRET-TEXT" });
		const records = await audited("mailbox.auto_reply_changed");
		const last = records.at(-1);
		expect(last).toMatchObject({ target: DESK, actor_user_id: (await as("owner").me()).id });
		expect(JSON.parse(last?.detail ?? "{}")).toMatchObject({
			enabled: true,
			from: null,
			until: null,
		});
		expect(JSON.stringify(records)).not.toContain("SECRET");
	});

	it("stops when the person who saved it may no longer send from the mailbox", async () => {
		// A second owner turns it on, and is then taken out of the mailbox.
		const { seedMembership, seedUser } = await import("./helpers.ts");
		ids.second = await seedUser("second@example.com", "member");
		await seedMembership(DESK, ids.second, "owner");
		await signedInAgain("second");
		expect((await save(REPLY, "second")).status).toBe(200);
		await arrives("While they are an owner", {}, "early@sender.test");
		expect(answered()).toEqual(["early@sender.test"]);
		await testEnv.DB.prepare(`delete from "memberships" where "user_id" = ?1`)
			.bind(ids.second)
			.run();
		expect(await arrives("After they left", {}, "later@sender.test")).toMatchObject({
			folder_id: "inbox",
		});
		expect(answered()).toEqual(["early@sender.test"]);
		// Nothing is left behind of the reply that did not leave, and the settings say why.
		expect(await rows(`SELECT 1 FROM emails WHERE folder_id IN ('scheduled', 'draft')`)).toEqual(
			[],
		);
		// Nobody who wrote meanwhile is recorded as answered, nor takes a place in the reply's caps.
		expect(await rows(`SELECT sender FROM auto_reply_log`)).toEqual([
			{ sender: "early@sender.test" },
		]);
		await signedInAgain("owner");
		expect(await read()).toMatchObject({ isEnabled: true, stopped: true });
		// An owner who may send saves it again, and it answers again.
		expect((await save(REPLY)).status).toBe(200);
		expect(await read()).toMatchObject({ isEnabled: true, stopped: false });
		await arrives("After it was saved again", {}, "again@sender.test");
		// Whoever wrote while it was stopped is answered when they write again.
		await arrives("Again from someone who wrote meanwhile", {}, "later@sender.test");
		expect(answered()).toEqual(["early@sender.test", "again@sender.test", "later@sender.test"]);
	});

	it("stops when the person who saved it is no longer an owner, though they may still send", async () => {
		const { seedMembership, seedUser } = await import("./helpers.ts");
		ids.lowered = await seedUser("lowered@example.com", "member");
		await seedMembership(DESK, ids.lowered, "owner");
		await signedInAgain("lowered");
		expect((await save(REPLY, "lowered")).status).toBe(200);
		await arrives("While they are an owner", {}, "first@sender.test");
		expect(answered()).toEqual(["first@sender.test"]);
		// Lowered to sender: they may send, and may no longer change the reply.
		await testEnv.DB.prepare(`update "memberships" set "role" = 'sender' where "user_id" = ?1`)
			.bind(ids.lowered)
			.run();
		expect((await save({ ...REPLY, isEnabled: false }, "lowered")).status).toBe(403);
		await arrives("After they were lowered", {}, "second@sender.test");
		expect(answered()).toEqual(["first@sender.test"]);
		await signedInAgain("owner");
		expect(await read()).toMatchObject({ isEnabled: true, stopped: true });
		expect((await save(REPLY)).status).toBe(200);
	});

	it("stops when the account of the person who saved it was recovered since", async () => {
		await on();
		await arrives("Before the recovery", {}, "before@sender.test");
		expect(answered()).toEqual(["before@sender.test"]);
		const owner = await testEnv.DB.prepare(`select "id" from "user" where "email" = ?1`)
			.bind("owner@example.com")
			.first<{ id: string }>();
		const now = new Date(Date.now() + 1000).toISOString();
		await testEnv.DB.prepare(
			`insert into "recoveries" ("id", "user_id", "token_hash", "created_at", "expires_at", "used_at") values (?1, ?2, ?1, ?3, ?3, ?3)`,
		)
			.bind(crypto.randomUUID(), owner?.id ?? "", now)
			.run();
		await arrives("After the recovery", {}, "after@sender.test");
		expect(answered()).toEqual(["before@sender.test"]);
		expect(await read()).toMatchObject({ isEnabled: true, stopped: true });
		await testEnv.DB.prepare(`delete from "recoveries" where "user_id" = ?1`)
			.bind(owner?.id ?? "")
			.run();
	});
});
