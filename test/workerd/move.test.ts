/**
 * The route that moves one message (issue #31). A message is in Sent because the sending
 * service took it, and in Drafts because it is a draft, so:
 *
 * - Sent is never a target, for mail that arrived, a draft or mail that left;
 * - Drafts takes back a draft from wherever it was moved, which is how the app undoes deleting
 *   one, and a message taken back from Scheduled, which is a draft again;
 * - Drafts never takes mail that arrived, also old mail without an original, nor mail that left.
 *
 * Every message here is made the way the product makes it: delivered to the `email` handler,
 * written through the drafts route, or sent and let leave with a send binding of the tests.
 */
import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../../workers/app.ts";
import { Browser, createMailbox, inbound, json, migrate, mime, setupOwner } from "./helpers.ts";
import { fakeSender, HOUR, inMailbox, letLeave, placeOf, rowsOf } from "./sending-helpers.ts";

const owner = new Browser();
const base = (address: string) => `/api/v1/mailboxes/${encodeURIComponent(address)}`;

let made = 0;
async function mailbox(name: string): Promise<string> {
	made += 1;
	const address = `${name}-${made}@example.com`;
	expect((await createMailbox(owner.cookie, address)).status).toBe(201);
	return address;
}

const move = (address: string, id: string, folderId: string) =>
	owner.post(`${base(address)}/emails/${id}/move`, { folderId });

async function received(address: string, subject: string, withId = true): Promise<string> {
	const raw = mime({
		From: "ada@sender.test",
		To: address,
		Subject: subject,
		...(withId ? { "Message-ID": `<${subject.replaceAll(" ", "-")}@sender.test>` } : {}),
	});
	const { message } = inbound(address, raw);
	const ctx = createExecutionContext();
	await worker.email(message, env, ctx);
	await waitOnExecutionContext(ctx);
	const rows = await rowsOf<{ id: string }>(
		address,
		`SELECT id FROM emails WHERE subject = '${subject}'`,
	);
	expect(rows).toHaveLength(1);
	return rows[0]?.id as string;
}

async function draft(address: string, subject: string): Promise<string> {
	const res = await owner.post(`${base(address)}/drafts`, {
		to: "to@elsewhere.test",
		subject,
		body: "<p>Not yet</p>",
	});
	expect(res.status).toBe(201);
	return (await json<{ id: string }>(res)).id;
}

const message = (address: string, more: Record<string, unknown> = {}) => ({
	to: "to@elsewhere.test",
	from: address,
	subject: "Hello",
	html: "<p>Hello</p>",
	...more,
});

async function sent(address: string): Promise<string> {
	await fakeSender(address);
	const res = await owner.post(`${base(address)}/emails`, message(address));
	expect(res.status).toBe(202);
	const { id } = await json<{ id: string }>(res);
	await letLeave(address);
	expect(await placeOf(address, id)).toBe("sent");
	return id;
}

async function refused(address: string, id: string, folderId: string, place: string) {
	const res = await move(address, id, folderId);
	expect(res.status, `${place} → ${folderId}`).toBe(400);
	expect((await json<{ code: string }>(res)).code).toBe("NOT_A_TARGET");
	expect(await placeOf(address, id)).toBe(place);
}

beforeAll(async () => {
	await migrate();
	expect((await setupOwner()).status).toBe(201);
	expect((await owner.signIn("owner@example.com")).status).toBe(200);
});

describe("the route that moves one message", () => {
	it("never takes Sent as a target, for mail that arrived, a draft or mail that left", async () => {
		const address = await mailbox("sent");
		const arrived = await received(address, "arrived");
		const written = await draft(address, "written");
		const left = await sent(address);

		await refused(address, arrived, "sent", "inbox");
		await refused(address, written, "sent", "draft");
		// Mail that left and was deleted does not go back to Sent by a move either.
		expect((await move(address, left, "trash")).status).toBe(200);
		await refused(address, left, "sent", "trash");
	});

	it("takes a deleted draft back into Drafts, which is the app's Undo", async () => {
		const address = await mailbox("undo");
		const written = await draft(address, "written");
		expect((await move(address, written, "trash")).status).toBe(200);
		expect(await placeOf(address, written)).toBe("trash");
		expect((await move(address, written, "draft")).status).toBe(200);
		expect(await placeOf(address, written)).toBe("draft");
		// Back in Drafts it is a draft again: it is saved over and can be sent.
		const saved = await owner.fetch(`${base(address)}/drafts/${written}`, {
			method: "PUT",
			body: JSON.stringify({ to: "to@elsewhere.test", subject: "again", body: "<p>Now</p>" }),
		});
		expect(saved.status).toBe(200);
	});

	it("takes back into Drafts a message taken back from Scheduled", async () => {
		const address = await mailbox("unsent");
		await fakeSender(address);
		const later = { send_at: new Date(Date.now() + HOUR).toISOString() };
		const res = await owner.post(`${base(address)}/emails`, message(address, later));
		expect(res.status).toBe(202);
		const { id } = await json<{ id: string }>(res);
		expect((await owner.post(`${base(address)}/emails/${id}/unsend`)).status).toBe(200);
		expect(await placeOf(address, id)).toBe("draft");
		expect((await move(address, id, "trash")).status).toBe(200);
		expect((await move(address, id, "draft")).status).toBe(200);
		expect(await placeOf(address, id)).toBe("draft");
	});

	it("never takes mail that arrived or mail that left into Drafts", async () => {
		const address = await mailbox("drafts");
		const arrived = await received(address, "arrived");
		// A sender may leave the Message-ID out: the message is still not one the mailbox wrote.
		const anonymous = await received(address, "no id", false);
		const old = await received(address, "old mail");
		// Mail stored before originals were kept has no original, and still its header list.
		await inMailbox(address, (sql) => {
			sql.exec(`UPDATE emails SET raw_key = NULL, raw_size = NULL WHERE id = ?1`, old);
		});
		const left = await sent(address);

		await refused(address, arrived, "draft", "inbox");
		await refused(address, anonymous, "draft", "inbox");
		await refused(address, old, "draft", "inbox");
		await refused(address, left, "draft", "sent");
		expect((await move(address, arrived, "trash")).status).toBe(200);
		await refused(address, arrived, "draft", "trash");
	});

	it("refuses a request without a place, and still moves mail between the other places", async () => {
		const address = await mailbox("plain");
		const arrived = await received(address, "arrived");
		for (const body of [{}, { folderId: 7 }, null]) {
			const res = await owner.post(`${base(address)}/emails/${arrived}/move`, body);
			expect(res.status).toBe(400);
		}
		for (const place of ["archive", "spam", "trash", "inbox"]) {
			expect((await move(address, arrived, place)).status, place).toBe(200);
			expect(await placeOf(address, arrived)).toBe(place);
		}
	});
});
