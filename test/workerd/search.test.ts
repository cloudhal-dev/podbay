/**
 * Tier 3: searching a mailbox.
 *
 * A search that names no place leaves out what is in Spam and Trash; mail there is found by
 * asking there.
 */
import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../../workers/app.ts";
import { Browser, createMailbox, inbound, json, migrate, mime, setupOwner } from "./helpers.ts";

const MAILBOX = "search@example.com";
const M = `/api/v1/mailboxes/${encodeURIComponent(MAILBOX)}`;

interface Row {
	id: string;
	subject: string;
	folder_id: string;
}

const owner = new Browser();
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

describe("a search that names no place", () => {
	const found = async (query: string) =>
		json<{ emails: Row[]; totalCount: number }>(await owner.fetch(`${M}/search?${query}`));
	const deliver = async (subject: string) => {
		const { message, rejections } = inbound(
			MAILBOX,
			mime({ From: "ada@sender.test", To: MAILBOX, Subject: subject }),
		);
		const ctx = createExecutionContext();
		await worker.email?.(message as unknown as ForwardableEmailMessage, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(rejections).toEqual([]);
	};
	const move = async (subject: string, folderId: string) => {
		const row = (await list("inbox")).find((one) => one.subject === subject);
		const moved = await owner.fetch(`${M}/emails/${row?.id}/move`, {
			method: "POST",
			body: JSON.stringify({ folderId }),
		});
		expect(moved.status).toBe(200);
	};

	it("leaves out what is in Spam and Trash, and finds it when asked there", async () => {
		for (const subject of ["Findable kept", "Findable thrown away", "Findable unwanted"]) {
			await deliver(subject);
		}
		await move("Findable thrown away", "trash");
		await move("Findable unwanted", "spam");

		const everywhere = await found("query=Findable");
		expect(everywhere.emails.map((row) => row.subject)).toEqual(["Findable kept"]);
		// The count beside the list is the count of the list.
		expect(everywhere.totalCount).toBe(1);

		const trash = await found("query=Findable&folder=trash");
		expect(trash.emails.map((row) => row.subject)).toEqual(["Findable thrown away"]);
		const spam = await found("query=Findable&folder=spam");
		expect(spam.emails.map((row) => row.subject)).toEqual(["Findable unwanted"]);
		expect(spam.totalCount).toBe(1);
	});
});
