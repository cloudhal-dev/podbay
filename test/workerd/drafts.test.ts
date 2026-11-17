/**
 * Tier 3: saving a draft (rule S13, boundary B4).
 *
 * Saving a draft again replaces the draft that was saved before, by its id. Replacing deletes,
 * so the id must be a draft's: with the id of a message anywhere else the save is refused, and
 * the message stays.
 */
import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../../workers/app.ts";
import { Browser, createMailbox, inbound, json, migrate, mime, setupOwner } from "./helpers.ts";

const MAILBOX = "drafts@example.com";
const M = `/api/v1/mailboxes/${encodeURIComponent(MAILBOX)}`;

interface Row {
	id: string;
	subject: string;
	folder_id: string;
}

const owner = new Browser();
const save = (body: Record<string, unknown>) =>
	owner.fetch(`${M}/drafts`, { method: "POST", body: JSON.stringify(body) });
const list = async (folder: string) =>
	(await json<{ emails: Row[] }>(await owner.fetch(`${M}/emails?folder=${folder}`))).emails;

beforeAll(async () => {
	await migrate();
	expect((await setupOwner()).status).toBe(201);
	expect((await owner.signIn("owner@example.com")).status).toBe(200);
	expect((await createMailbox(owner.cookie, MAILBOX)).status).toBe(201);

	const { message, rejections } = inbound(
		MAILBOX,
		mime({ From: "ada@sender.test", To: MAILBOX, Subject: "Kept in the inbox" }),
	);
	const ctx = createExecutionContext();
	await worker.email?.(message as unknown as ForwardableEmailMessage, env, ctx);
	await waitOnExecutionContext(ctx);
	expect(rejections).toEqual([]);
});

describe("saving a draft", () => {
	it("replaces the draft that was saved before, and leaves one", async () => {
		const first = await save({ to: "someone@elsewhere.test", subject: "First", body: "<p>1</p>" });
		expect(first.status).toBe(201);
		const { id } = await json<{ id: string }>(first);

		const second = await save({
			to: "someone@elsewhere.test",
			subject: "Second",
			body: "<p>2</p>",
			draft_id: id,
		});
		expect(second.status).toBe(201);
		expect((await list("draft")).map((row) => row.subject)).toEqual(["Second"]);
	});

	it("refuses to replace a message that is not a draft, and the message stays", async () => {
		const [received] = await list("inbox");
		expect(received?.subject).toBe("Kept in the inbox");
		const before = (await list("draft")).length;

		const refused = await save({
			subject: "In its place",
			body: "<p>x</p>",
			draft_id: received?.id,
		});
		expect(refused.status).toBe(409);
		expect((await list("inbox")).map((row) => row.subject)).toEqual(["Kept in the inbox"]);
		expect(await list("draft")).toHaveLength(before);
	});

	it("saves a new draft when the one it names is gone", async () => {
		const before = (await list("draft")).length;
		const saved = await save({
			subject: "After the old one went",
			body: "<p>y</p>",
			draft_id: "gone",
		});
		expect(saved.status).toBe(201);
		expect(await list("draft")).toHaveLength(before + 1);
	});
});
