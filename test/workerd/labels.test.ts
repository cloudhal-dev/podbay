/**
 * Tier 3: places and labels (ADR-0007).
 *
 * - a label belongs to one mailbox: its name is unique there without regard to case, and its id
 *   means nothing in another mailbox;
 * - seeing labels is reading; making, changing, removing and applying one is a change, so a
 *   reader is refused and someone without a membership is told nothing;
 * - labelling a conversation labels every message of it outside Spam and Trash, and a label's
 *   list never shows what is there;
 * - deleting a label deletes no mail, and deleting a message leaves no label row behind;
 * - nobody makes, renames or removes a place, and the folders people made before became labels.
 */
import {
	createExecutionContext,
	env,
	runInDurableObject,
	waitOnExecutionContext,
} from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { LABEL_LIMITS } from "../../shared/labels.ts";
import worker from "../../workers/app.ts";
import { applyMigrations, mailboxMigrations } from "../../workers/durableObject/migrations.ts";
import {
	Browser,
	createMailbox,
	inbound,
	json,
	migrate,
	mime,
	seedMembership,
	seedUser,
	setupOwner,
	testEnv,
} from "./helpers.ts";

const MAILBOX = "tags@example.com";
const OTHER = "other@example.com";
const M = `/api/v1/mailboxes/${encodeURIComponent(MAILBOX)}`;
const O = `/api/v1/mailboxes/${encodeURIComponent(OTHER)}`;

interface Label {
	id: string;
	name: string;
	color: number;
	total: number;
	unread: number;
}
interface Row {
	id: string;
	subject: string;
	thread_id: string | null;
	folder_id: string;
	labels: string[];
}

const browsers: Record<string, Browser> = {};
const as = (who: string) => browsers[who] as Browser;
const put = (who: string, path: string, body: unknown) =>
	as(who).fetch(path, { method: "PUT", body: JSON.stringify(body) });
const remove = (who: string, path: string) => as(who).fetch(path, { method: "DELETE" });

async function deliver(to: string, headers: Record<string, string>, body = "Hello") {
	const { message, rejections } = inbound(
		to,
		mime({ From: "ada@sender.test", To: to, ...headers }, body),
	);
	const ctx = createExecutionContext();
	await worker.email(message, env, ctx);
	await waitOnExecutionContext(ctx);
	expect(rejections).toEqual([]);
}

const inbox = async (who = "owner", base = M) =>
	(await json<{ emails: Row[] }>(await as(who).fetch(`${base}/emails?folder=inbox&threaded=true`)))
		.emails;
const bySubject = async (subject: string, base = M) => {
	const found = (await inbox("owner", base)).find((row) => row.subject === subject);
	if (!found) throw new Error(`no conversation "${subject}"`);
	return found;
};
const labels = async (who = "owner", base = M) =>
	json<Label[]>(await as(who).fetch(`${base}/labels`));
const named = async (name: string, base = M) => {
	const found = (await labels("owner", base)).find((label) => label.name === name);
	if (!found) throw new Error(`no label "${name}"`);
	return found;
};
const make = async (name: string, base = M) =>
	json<Label>(await as("owner").post(`${base}/labels`, { name }));
const withLabel = async (id: string) =>
	(await json<{ emails: Row[] }>(await as("owner").fetch(`${M}/search?label=${id}`))).emails;

/** Runs SQL inside the mailbox's own database. */
async function inMailbox<T>(
	address: string,
	run: (sql: SqlStorage, storage: DurableObjectStorage) => T,
) {
	const stub = testEnv.MAILBOX.get(testEnv.MAILBOX.idFromName(address));
	return runInDurableObject(stub, (_object, state) => run(state.storage.sql, state.storage));
}

beforeAll(async () => {
	await migrate();
	expect((await setupOwner()).status).toBe(201);
	browsers.owner = new Browser();
	expect((await browsers.owner.signIn("owner@example.com")).status).toBe(200);
	expect((await createMailbox(browsers.owner.cookie, MAILBOX)).status).toBe(201);
	expect((await createMailbox(browsers.owner.cookie, OTHER)).status).toBe(201);
	const reader = await seedUser("reader@example.com", "member");
	const sender = await seedUser("sender@example.com", "member");
	await seedUser("outsider@example.com", "member");
	await seedMembership(MAILBOX, reader, "reader");
	await seedMembership(MAILBOX, sender, "sender");
	for (const who of ["reader", "sender", "outsider"]) {
		browsers[who] = new Browser();
		expect((await as(who).signIn(`${who}@example.com`)).status).toBe(200);
	}
	browsers.nobody = new Browser();

	await deliver(MAILBOX, { Subject: "Plan", "Message-ID": "<plan-1@sender.test>" });
	await deliver(MAILBOX, {
		Subject: "Re: Plan",
		"Message-ID": "<plan-2@sender.test>",
		"In-Reply-To": "<plan-1@sender.test>",
		References: "<plan-1@sender.test>",
	});
	await deliver(MAILBOX, {
		Subject: "Re: Plan",
		"Message-ID": "<plan-3@sender.test>",
		"In-Reply-To": "<plan-2@sender.test>",
		References: "<plan-1@sender.test> <plan-2@sender.test>",
	});
	await deliver(MAILBOX, { Subject: "Invoice", "Message-ID": "<invoice@sender.test>" });
	await deliver(OTHER, { Subject: "Elsewhere", "Message-ID": "<else@sender.test>" });
});

describe("labels of a mailbox", () => {
	it("makes a label with an opaque id, lists it, renames and recolours it", async () => {
		const made = await as("owner").post(`${M}/labels`, { name: "  Projects ", color: 3 });
		expect(made.status).toBe(201);
		const label = await json<Label>(made);
		expect(label).toMatchObject({ name: "Projects", color: 3, total: 0, unread: 0 });
		expect(label.id).toMatch(/^lbl_[0-9a-f]{24}$/);

		const changed = await put("owner", `${M}/labels/${label.id}`, {
			name: "Projects/2026",
			color: 99,
		});
		expect(changed.status).toBe(200);
		expect(await json<Label>(changed)).toMatchObject({ name: "Projects/2026", color: 0 });
		expect((await labels()).map((l) => l.name)).toEqual(["Projects/2026"]);
	});

	it("keeps names unique without regard to case, and refuses a name that is not one", async () => {
		expect((await as("owner").post(`${M}/labels`, { name: "Clients" })).status).toBe(201);
		const again = await as("owner").post(`${M}/labels`, { name: "CLIENTS" });
		expect(again.status).toBe(409);
		expect(await json<{ code: string }>(again)).toMatchObject({ code: "LABEL_EXISTS" });

		const projects = await named("Projects/2026");
		const clash = await put("owner", `${M}/labels/${projects.id}`, { name: "clients" });
		expect(clash.status).toBe(409);

		for (const name of ["", "   ", 'a"b', "a//b", "x".repeat(LABEL_LIMITS.nameLength + 1)]) {
			expect((await as("owner").post(`${M}/labels`, { name })).status, name).toBe(400);
		}
		expect((await as("owner").post(`${M}/labels`, { color: 1 })).status).toBe(400);
		expect((await labels()).map((l) => l.name)).toEqual(["Clients", "Projects/2026"]);
	});

	it("lets a reader see labels and change nothing", async () => {
		expect((await labels("reader")).map((l) => l.name)).toEqual(["Clients", "Projects/2026"]);
		const label = await named("Clients");
		const plan = await bySubject("Re: Plan");
		const tries = [
			await as("reader").post(`${M}/labels`, { name: "Mine" }),
			await put("reader", `${M}/labels/${label.id}`, { name: "Renamed" }),
			await remove("reader", `${M}/labels/${label.id}`),
			await put("reader", `${M}/emails/${plan.id}/labels`, { add: [label.id], remove: [] }),
		];
		expect(tries.map((res) => res.status)).toEqual([403, 403, 403, 403]);
		expect((await labels()).map((l) => l.name)).toEqual(["Clients", "Projects/2026"]);
		expect((await bySubject("Re: Plan")).labels).toEqual([]);
	});

	it("tells someone without a membership nothing, and someone signed out less", async () => {
		const label = await named("Clients");
		for (const [who, status] of [
			["outsider", 404],
			["nobody", 401],
		] as const) {
			const tries = [
				await as(who).fetch(`${M}/labels`),
				await as(who).post(`${M}/labels`, { name: "Mine" }),
				await put(who, `${M}/labels/${label.id}`, { name: "Renamed" }),
				await remove(who, `${M}/labels/${label.id}`),
				await put(who, `${M}/emails/any/labels`, { add: [label.id], remove: [] }),
			];
			expect(
				tries.map((res) => res.status),
				who,
			).toEqual([status, status, status, status, status]);
		}
	});

	it("lets a sender label, as it may change the mailbox", async () => {
		const made = await as("sender").post(`${M}/labels`, { name: "From a sender" });
		expect(made.status).toBe(201);
		const { id } = await json<Label>(made);
		expect((await remove("sender", `${M}/labels/${id}`)).status).toBe(204);
	});
});

describe("labels on conversations", () => {
	it("labels every message of a conversation, and shows it on the line and the message", async () => {
		const clients = await named("Clients");
		const projects = await named("Projects/2026");
		const plan = await bySubject("Re: Plan");
		const done = await put("owner", `${M}/emails/${plan.id}/labels`, {
			add: [projects.id, clients.id],
			remove: [],
		});
		expect(done.status).toBe(200);
		// In the order of their names.
		expect(await json<{ labels: string[] }>(done)).toEqual({ labels: [clients.id, projects.id] });

		expect((await bySubject("Re: Plan")).labels).toEqual([clients.id, projects.id]);
		expect((await bySubject("Invoice")).labels).toEqual([]);
		const one = await json<Row>(await as("owner").fetch(`${M}/emails/${plan.id}`));
		expect(one.labels).toEqual([clients.id, projects.id]);

		const carried = await inMailbox(MAILBOX, (sql) => [
			...sql.exec(
				`SELECT e.subject, COUNT(*) AS n FROM email_labels el JOIN emails e ON e.id = el.email_id GROUP BY e.id ORDER BY e.subject`,
			),
		]);
		// The two replies are one conversation; the label went to both, and to nothing else.
		expect(carried).toEqual([
			{ subject: "Re: Plan", n: 2 },
			{ subject: "Re: Plan", n: 2 },
		]);
		expect((await labels()).map((l) => [l.name, l.total])).toEqual([
			["Clients", 2],
			["Projects/2026", 2],
		]);

		const taken = await put("owner", `${M}/emails/${plan.id}/labels`, {
			add: [],
			remove: [clients.id],
		});
		expect(await json<{ labels: string[] }>(taken)).toEqual({ labels: [projects.id] });
	});

	it("does not know a label of another mailbox, or something that is not a label id", async () => {
		const foreign = await make("Theirs", O);
		const plan = await bySubject("Re: Plan");
		const before = (await bySubject("Re: Plan")).labels;
		for (const id of [foreign.id, "inbox", "lbl_nope", `lbl_${"0".repeat(24)}`]) {
			const res = await put("owner", `${M}/emails/${plan.id}/labels`, { add: [id], remove: [] });
			expect(res.status, id).toBe(404);
		}
		expect(
			(await put("owner", `${M}/emails/no-such-message/labels`, { add: [], remove: [] })).status,
		).toBe(404);
		expect((await put("owner", `${M}/labels/${foreign.id}`, { name: "Taken" })).status).toBe(404);
		expect((await remove("owner", `${M}/labels/${foreign.id}`)).status).toBe(404);
		expect((await bySubject("Re: Plan")).labels).toEqual(before);
		expect((await labels("owner", O)).map((l) => l.name)).toEqual(["Theirs"]);
	});

	it("finds a label's messages, and never the ones in Trash or Spam", async () => {
		const { id } = await named("Projects/2026");
		expect((await withLabel(id)).map((row) => row.subject)).toEqual(["Re: Plan", "Re: Plan"]);

		const plan = await bySubject("Re: Plan");
		await as("owner").post(`${M}/emails/${plan.id}/move`, { folderId: "trash" });
		expect(await withLabel(id)).toHaveLength(1);
		expect((await labels()).find((l) => l.id === id)?.total).toBe(1);

		// The message keeps its label: restoring it restores the label.
		await as("owner").post(`${M}/emails/${plan.id}/move`, { folderId: "inbox" });
		expect(await withLabel(id)).toHaveLength(2);

		// A label that is asked for and is not one finds nothing, never everything.
		for (const bad of ["inbox", "", "lbl_x"]) {
			const res = await as("owner").fetch(`${M}/search?label=${bad}`);
			expect(await json<{ emails: Row[] }>(res)).toMatchObject({ emails: [] });
		}
	});

	it("holds a message to its limit of labels, and changes nothing when a request goes over", async () => {
		const invoice = await bySubject("Invoice");
		const many: string[] = [];
		for (let n = 0; n < LABEL_LIMITS.perMessage + 1; n++) many.push((await make(`Bulk ${n}`)).id);
		const fits = await put("owner", `${M}/emails/${invoice.id}/labels`, {
			add: many.slice(0, LABEL_LIMITS.perMessage),
			remove: [],
		});
		expect(fits.status).toBe(200);
		const over = await put("owner", `${M}/emails/${invoice.id}/labels`, {
			add: [many[LABEL_LIMITS.perMessage]],
			remove: [],
		});
		expect(over.status).toBe(409);
		expect(await json<{ code: string }>(over)).toMatchObject({ code: "LABEL_LIMIT" });
		expect((await bySubject("Invoice")).labels).toHaveLength(LABEL_LIMITS.perMessage);
		// More ids than one request may carry are refused before anything is read.
		const flood = await put("owner", `${M}/emails/${invoice.id}/labels`, {
			add: [...many, ...many],
			remove: [],
		});
		expect(flood.status).toBe(400);
	});

	it("holds a mailbox to its limit of labels", async () => {
		await inMailbox(OTHER, (sql) => {
			for (let n = 0; n < LABEL_LIMITS.perMailbox; n++) {
				sql.exec(
					`INSERT INTO labels (id, name, color, created_at) VALUES (?, ?, 0, '2026-01-01T00:00:00.000Z')`,
					`lbl_${n.toString(16).padStart(24, "0")}`,
					`Filled ${n}`,
				);
			}
		});
		const res = await as("owner").post(`${O}/labels`, { name: "One too many" });
		expect(res.status).toBe(409);
		expect(await json<{ code: string }>(res)).toMatchObject({ code: "LABEL_LIMIT" });
	});
});

describe("deleting", () => {
	it("deletes a label and no mail", async () => {
		const before = (await inbox()).map((row) => row.subject).sort();
		const projects = await named("Projects/2026");
		expect((await bySubject("Re: Plan")).labels).toEqual([projects.id]);
		expect((await remove("owner", `${M}/labels/${projects.id}`)).status).toBe(204);
		expect((await inbox()).map((row) => row.subject).sort()).toEqual(before);
		expect((await bySubject("Re: Plan")).labels).toEqual([]);
		const left = await inMailbox(MAILBOX, (sql) => [
			...sql.exec(`SELECT COUNT(*) AS n FROM email_labels WHERE label_id = ?`, projects.id),
		]);
		expect(left).toEqual([{ n: 0 }]);
		expect((await remove("owner", `${M}/labels/${projects.id}`)).status).toBe(404);
	});

	it("leaves no label row behind when a message is deleted for good", async () => {
		const invoice = await bySubject("Invoice");
		const rowsOf = () =>
			inMailbox(MAILBOX, (sql) => [
				...sql.exec(`SELECT COUNT(*) AS n FROM email_labels WHERE email_id = ?`, invoice.id),
			]);
		expect(await rowsOf()).toEqual([{ n: LABEL_LIMITS.perMessage }]);
		expect((await remove("owner", `${M}/emails/${invoice.id}`)).status).toBeLessThan(300);
		expect(await rowsOf()).toEqual([{ n: 0 }]);
	});
});

describe("places", () => {
	it("are fixed: nobody makes, renames or removes one", async () => {
		const places = await json<{ id: string }[]>(await as("owner").fetch(`${M}/folders`));
		expect(places.map((place) => place.id).sort()).toEqual([
			"archive",
			"draft",
			"inbox",
			"sent",
			"spam",
			"trash",
		]);
		const tries = [
			await as("owner").post(`${M}/folders`, { name: "Mine" }),
			await put("owner", `${M}/folders/inbox`, { name: "Renamed" }),
			await remove("owner", `${M}/folders/archive`),
		];
		for (const res of tries) expect(res.status).toBe(404);
		expect(await json<{ id: string }[]>(await as("owner").fetch(`${M}/folders`))).toHaveLength(6);
	});

	it("turns the folders people made before into labels, and loses no message", async () => {
		const address = "legacy@example.com";
		expect((await createMailbox(as("owner").cookie, address)).status).toBe(201);
		const L = `/api/v1/mailboxes/${encodeURIComponent(address)}`;
		for (const subject of ["In a folder", "In its twin", "In the inbox"]) {
			await deliver(address, {
				Subject: subject,
				"Message-ID": `<${subject.replace(/ /g, "-")}@sender.test>`,
			});
		}
		// The state of the previous release: two folders a person made, whose names differ only
		// in case, with a message in each.
		await inMailbox(address, (sql, storage) => {
			sql.exec(
				`INSERT INTO folders (id, name, is_deletable) VALUES ('work', 'Work', 1), ('work-2', 'WORK', 1)`,
			);
			sql.exec(`UPDATE emails SET folder_id = 'work' WHERE subject = 'In a folder'`);
			sql.exec(`UPDATE emails SET folder_id = 'work-2' WHERE subject = 'In its twin'`);
			sql.exec(`DELETE FROM d1_migrations WHERE name = '10_custom_folders_become_labels'`);
			applyMigrations(sql, mailboxMigrations, storage);
		});

		const made = await labels("owner", L);
		expect(made.map((l) => [l.name, l.total])).toEqual([["Work", 2]]);
		expect(made[0]?.id).toMatch(/^lbl_[0-9a-f]{24}$/);
		const state = await inMailbox(address, (sql) => ({
			emails: [...sql.exec(`SELECT subject, folder_id FROM emails ORDER BY subject`)],
			folders: [...sql.exec(`SELECT COUNT(*) AS n FROM folders WHERE is_deletable = 1`)],
		}));
		expect(state.emails).toEqual([
			{ subject: "In a folder", folder_id: "archive" },
			{ subject: "In its twin", folder_id: "archive" },
			{ subject: "In the inbox", folder_id: "inbox" },
		]);
		expect(state.folders).toEqual([{ n: 0 }]);
		const found = await json<{ emails: Row[] }>(
			await as("owner").fetch(`${L}/search?label=${made[0]?.id}`),
		);
		expect(found.emails.map((row) => row.subject).sort()).toEqual(["In a folder", "In its twin"]);
	});
});
