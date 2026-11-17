/**
 * Tier 3: what a mailbox tells the open app (ADR-0013). Who may listen, and when a connection
 * ends, is in `live.test.ts`.
 *
 * - nothing on the connection is mail: marked content fed through every kind of write appears
 *   in no message, and every message is the one shape, four counters, under 256 bytes;
 * - each counter moves for what it should, only grows, and does not move for a read;
 * - one message for each call that changed something, never the same state twice;
 * - the signal cannot be forgotten: every method of the mailbox object is watched, the test
 *   lists them, and one that changes a row without being known here fails it;
 * - the counters are stored, and come with the database of the release before.
 */
import {
	createExecutionContext,
	env,
	evictDurableObject,
	runInDurableObject,
	waitOnExecutionContext,
} from "cloudflare:test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	LIVE_KINDS,
	LIVE_LIMITS,
	type LiveKind,
	type LiveState,
	liveMessage,
} from "../../shared/live.ts";
import worker from "../../workers/app.ts";
import { MailboxDO } from "../../workers/durableObject/index.ts";
import { ABOUT, WATCHED, watch } from "../../workers/durableObject/live.ts";
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
} from "./helpers.ts";
import { counters, inObject, mailboxStub, open, quiet, settled, type Tab } from "./live-helpers.ts";

/** Words that stand for mail: wherever a test can put content, it puts this. */
const MARK = "QZXMARKQZX";
const SHAPE =
	/^\{"v":1,"type":"state","state":\{"delivery":"\d+","mail":"\d+","labels":"\d+","settings":"\d+"\}\}$/;

const browsers: Record<string, Browser> = {};
const as = (who: string) => browsers[who] as Browser;
let readerId = "";

async function ownMailbox(name: string) {
	const address = `${name}@example.com`;
	expect((await createMailbox(as("owner").cookie, address)).status).toBe(201);
	await seedMembership(address, readerId, "reader");
	return { address, base: `/api/v1/mailboxes/${encodeURIComponent(address)}` };
}

async function deliver(to: string, raw: string, from = `${MARK}@sender.test`) {
	const { message, rejections } = inbound(to, raw, { from });
	const ctx = createExecutionContext();
	await worker.email(message, env, ctx);
	await waitOnExecutionContext(ctx);
	expect(rejections).toEqual([]);
}

/** A message whose every part a sender controls carries the mark. */
function marked(to: string, subject: string, extra: Record<string, string> = {}) {
	return mime(
		{
			From: `${MARK} Sender <${MARK}@sender.test>`,
			To: to,
			Subject: `${MARK} ${subject}`,
			"Message-ID": `<${MARK}-${subject.replace(/\W/g, "")}@sender.test>`,
			"X-Marked": MARK,
			...extra,
		},
		`${MARK} body of ${subject}`,
	);
}

/** The typed stub: the calls of the mailbox object, as the Worker makes them. */
const object = (address: string) => mailboxStub(address) as unknown as DurableObjectStub<MailboxDO>;

const idOf = (address: string, subject: string) =>
	inObject(address, (state) =>
		String(
			[...state.storage.sql.exec(`SELECT id FROM emails WHERE subject LIKE ?`, `%${subject}%`)][0]
				?.id,
		),
	);

/** Every text a tab was sent is the one shape, small, and free of anything that is mail. */
function expectOnlyCounters(tab: Tab, address: string) {
	expect(tab.texts.length).toBeGreaterThan(0);
	for (const text of tab.texts) {
		expect(text).toMatch(SHAPE);
		expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(LIVE_LIMITS.messageBytes);
		expect(text).not.toContain(MARK);
		expect(text.toLowerCase()).not.toContain(MARK.toLowerCase());
		expect(text).not.toContain("@");
		expect(text).not.toContain(address);
	}
	// Never the same state twice, and no counter ever went back.
	const states = tab.states;
	for (let n = 1; n < states.length; n++) {
		const before = states[n - 1] as LiveState;
		const after = states[n] as LiveState;
		expect(after, `message ${n + 1}`).not.toEqual(before);
		for (const kind of LIVE_KINDS) {
			expect(Number(after[kind]), `${kind} in message ${n + 1}`).toBeGreaterThanOrEqual(
				Number(before[kind]),
			);
		}
	}
}

beforeAll(async () => {
	await migrate();
	expect((await setupOwner()).status).toBe(201);
	readerId = await seedUser("reader@example.com", "member");
	for (const who of ["owner", "reader"]) {
		browsers[who] = new Browser();
		expect((await as(who).signIn(`${who}@example.com`)).status, who).toBe(200);
	}
});

describe("what is told", () => {
	/** The object's methods that ran while the test fed content through the routes. */
	const ran = new Set<string>();
	const originals = new Map<string, PropertyDescriptor>();

	beforeAll(() => {
		for (const name of Object.getOwnPropertyNames(MailboxDO.prototype)) {
			const descriptor = Object.getOwnPropertyDescriptor(MailboxDO.prototype, name);
			if (name === "constructor" || typeof descriptor?.value !== "function") continue;
			originals.set(name, descriptor);
			const method = descriptor.value as (...args: unknown[]) => unknown;
			Object.defineProperty(MailboxDO.prototype, name, {
				...descriptor,
				value(this: unknown, ...args: unknown[]) {
					ran.add(name);
					return method.apply(this, args);
				},
			});
		}
	});
	afterAll(() => {
		for (const [name, descriptor] of originals) {
			Object.defineProperty(MailboxDO.prototype, name, descriptor);
		}
	});

	it("marked content fed through every kind of write appears in no message, and each counter moves for what it should", async () => {
		const { address, base } = await ownMailbox("marked");
		const mine = await open(as("owner"), address);
		const theirs = await open(as("reader"), address);
		const start = await counters(address);
		expect(start).toEqual({ delivery: 0, mail: 0, labels: 0, settings: 0 });
		expect(mine.last).toEqual({ delivery: "0", mail: "0", labels: "0", settings: "0" });

		/** Does one thing and holds the counters to exactly what it should move. */
		async function step(what: string, moves: LiveKind[], act: () => Promise<unknown>) {
			const before = await counters(address);
			const told = mine.texts.length;
			await act();
			const after = await counters(address);
			const moved = LIVE_KINDS.filter((kind) => after[kind] !== before[kind]);
			expect(moved, what).toEqual(LIVE_KINDS.filter((kind) => moves.includes(kind)));
			for (const kind of LIVE_KINDS) {
				expect(after[kind], `${what}: ${kind}`).toBeGreaterThanOrEqual(before[kind]);
			}
			const now = Object.fromEntries(LIVE_KINDS.map((kind) => [kind, String(after[kind])]));
			if (moves.length > 0) {
				// Both tabs are told the state the database has, the reader as well as the owner.
				await settled(
					() =>
						JSON.stringify(mine.last) === JSON.stringify(now) &&
						JSON.stringify(theirs.last) === JSON.stringify(now),
					`${what}: being told`,
				);
			} else {
				await quiet();
				expect(mine.texts.length, `${what}: nothing is told`).toBe(told);
			}
		}
		const ok = async (res: Promise<Response>, status = 200) => {
			const answer = await res;
			expect(answer.status).toBe(status);
			return answer;
		};
		const owner = as("owner");
		const put = (path: string, body: unknown) =>
			owner.fetch(`${base}${path}`, {
				method: "PUT",
				body: typeof body === "string" ? body : JSON.stringify(body),
			});
		const del = (path: string) => owner.fetch(`${base}${path}`, { method: "DELETE" });

		// ── Mail arrives ──
		await step("mail arrives", ["delivery", "mail"], () =>
			deliver(address, marked(address, "First")),
		);
		await step("mail arrives with a file", ["delivery", "mail"], () =>
			deliver(
				address,
				[
					`From: ${MARK} <${MARK}@sender.test>`,
					`To: ${address}`,
					`Subject: ${MARK} Filed`,
					"MIME-Version: 1.0",
					'Content-Type: multipart/mixed; boundary="b"',
					"",
					"--b",
					"Content-Type: text/plain",
					"",
					`${MARK} text`,
					"--b",
					`Content-Type: text/plain; name="${MARK}.txt"`,
					`Content-Disposition: attachment; filename="${MARK}.txt"`,
					"",
					`${MARK} file`,
					"--b--",
					"",
				].join("\r\n"),
			),
		);
		const first = await idOf(address, "First");
		const filed = await idOf(address, "Filed");

		// ── Reading moves nothing ──
		await step("reading", [], async () => {
			for (const path of [
				"",
				"/emails?folder=inbox",
				"/emails?folder=inbox&threaded=true",
				`/emails/${first}`,
				`/emails/${first}/original`,
				`/threads/${first}`,
				"/folders",
				"/labels",
				`/search?query=${MARK}`,
				`/known-addresses?q=${MARK.slice(0, 3)}`,
				"/members",
			]) {
				await ok(owner.fetch(`${base}${path}`));
			}
		});

		// ── Read, starred, moved ──
		await step("marked read", ["mail"], () => ok(put(`/emails/${first}`, { read: true })));
		await step("starred", ["mail"], () => ok(put(`/emails/${first}`, { starred: true })));
		await step("a change that names nothing", [], () => ok(put(`/emails/${first}`, {})));
		const thread = await inObject(address, (state) =>
			String(
				[...state.storage.sql.exec(`SELECT thread_id FROM emails WHERE id = ?`, filed)][0]
					?.thread_id,
			),
		);
		await step("a conversation read", ["mail"], () =>
			ok(owner.post(`${base}/threads/${thread}/read`)),
		);
		await step("a conversation that is read already", [], () =>
			ok(owner.post(`${base}/threads/${thread}/read`)),
		);
		await step("moved", ["mail"], () =>
			ok(owner.post(`${base}/emails/${first}/move`, { folderId: "archive" })),
		);
		await step("a move to no place", [], () =>
			ok(owner.post(`${base}/emails/${first}/move`, { folderId: MARK }), 400),
		);

		// ── Labels ──
		let label = "";
		await step("a label made", ["labels"], async () => {
			label = (
				await json<{ id: string }>(
					await ok(owner.post(`${base}/labels`, { name: `${MARK} label` }), 201),
				)
			).id;
		});
		await step("a label renamed", ["labels"], () =>
			ok(put(`/labels/${label}`, { name: `${MARK} renamed` })),
		);
		await step("a label recoloured", ["labels"], () => ok(put(`/labels/${label}`, { color: 3 })));
		await step("a label that exists already", [], () =>
			ok(owner.post(`${base}/labels`, { name: `${MARK} renamed` }), 409),
		);
		await step("a label given", ["mail"], () =>
			ok(put(`/emails/${first}/labels`, { add: [label], remove: [] })),
		);
		await step("a label taken", ["mail"], () =>
			ok(put(`/emails/${first}/labels`, { add: [], remove: [label] })),
		);
		await step("a label given again", ["mail"], () =>
			ok(put(`/emails/${first}/labels`, { add: [label], remove: [] })),
		);
		await step("a label deleted, with what carried it", ["labels", "mail"], () =>
			ok(del(`/labels/${label}`), 204),
		);

		// ── Drafts and their files ──
		let draft = "";
		await step("a draft saved", ["mail"], async () => {
			const made = await ok(
				owner.post(`${base}/drafts`, {
					to: `${MARK}@elsewhere.test`,
					subject: `${MARK} draft`,
					body: `<p>${MARK}</p>`,
				}),
				201,
			);
			draft = (await json<{ id: string }>(made)).id;
		});
		await step("a draft saved over", ["mail"], () =>
			ok(
				put(`/drafts/${draft}`, {
					to: `${MARK}@elsewhere.test`,
					subject: `${MARK} again`,
					body: MARK,
				}),
			),
		);
		let file = "";
		await step("a file declared, whose bytes are not there yet", [], async () => {
			const declared = await ok(
				owner.post(`${base}/drafts/${draft}/attachments`, {
					filename: `${MARK}.txt`,
					type: "text/plain",
					size: MARK.length,
				}),
				201,
			);
			file = (await json<{ id: string }>(declared)).id;
		});
		await step("a file stored", ["mail"], () =>
			ok(put(`/drafts/${draft}/attachments/${file}`, MARK)),
		);
		await step("a file taken off", ["mail"], () =>
			ok(del(`/drafts/${draft}/attachments/${file}`), 204),
		);

		// ── Sending ──
		const message = {
			to: `${MARK}@elsewhere.test`,
			from: address,
			subject: `${MARK} sent`,
			html: `<p>${MARK}</p>`,
		};
		await step("a draft sent", ["mail"], () =>
			ok(owner.post(`${base}/emails`, { ...message, draft_id: draft }), 202),
		);
		await step("a message sent", ["mail"], () => ok(owner.post(`${base}/emails`, message), 202));
		await step("a reply sent", ["mail"], () =>
			ok(owner.post(`${base}/emails/${filed}/reply`, message), 202),
		);
		await step("a forward sent", ["mail"], () =>
			ok(owner.post(`${base}/emails/${filed}/forward`, message), 202),
		);
		await step("a draft discarded", ["mail"], async () => {
			const made = await ok(
				owner.post(`${base}/drafts`, { subject: `${MARK} gone`, body: MARK }),
				201,
			);
			await ok(del(`/emails/${(await json<{ id: string }>(made)).id}`), 204);
		});

		// What was written is really there: the test fed content, and the mailbox holds it.
		const held = await inObject(address, (state) =>
			Number(
				[
					...state.storage.sql.exec(
						`SELECT COUNT(*) AS n FROM emails WHERE subject LIKE ?`,
						`%${MARK}%`,
					),
				][0]?.n,
			),
		);
		expect(held).toBeGreaterThanOrEqual(6);

		// ── Many conversations at once ──
		let deed = "";
		await step("a deed on ticked lines", ["mail"], async () => {
			const done = await ok(
				owner.post(`${base}/bulk`, { ids: [first], change: { starred: false } }),
			);
			deed = (await json<{ deed: string }>(done)).deed;
		});
		await step("a deed taken back", ["mail"], () => ok(owner.post(`${base}/bulk/${deed}/undo`)));
		await step("a filter that is only counted", [], async () => {
			const counted = await ok(
				owner.post(`${base}/bulk`, { filter: { query: MARK }, change: { move: "trash" } }),
			);
			deed = (await json<{ deed: string }>(counted)).deed;
		});
		await step("a step of a filter deed", ["mail"], () =>
			ok(owner.post(`${base}/bulk/${deed}/run`)),
		);
		await step("a deed that is not one", [], () =>
			ok(owner.post(`${base}/bulk/deed_000000000000000000000000/run`), 404),
		);

		// ── Deleting for good, emptying ──
		await step("mail arrives again", ["delivery", "mail"], () =>
			deliver(address, marked(address, "Doomed")),
		);
		const doomed = await idOf(address, "Doomed");
		await step("a message deleted for good", ["mail"], () => ok(del(`/emails/${doomed}`), 204));
		await step("a message that is not there", [], () => ok(del(`/emails/${doomed}`), 404));
		await step("Trash emptied", ["mail"], async () => {
			const emptied = await json<{ deleted: number }>(
				await ok(owner.post(`${base}/folders/trash/empty`)),
			);
			expect(emptied.deleted).toBeGreaterThan(0);
		});
		await step("an empty place emptied", [], () => ok(owner.post(`${base}/folders/trash/empty`)));

		// ── Settings, and what is not one of the four kinds ──
		await step("the settings saved", ["settings"], () =>
			ok(
				put("", {
					settings: { fromName: `${MARK} name`, signature: { enabled: true, text: MARK } },
				}),
			),
		);
		await step("settings that are refused", [], () => ok(put("", { settings: "x" }), 400));
		await step("known addresses forgotten", [], () => ok(del("/known-addresses"), 204));

		// ── What is refused tells nobody ──
		await step("a reader's change, refused", [], () =>
			ok(as("reader").post(`${base}/emails/${first}/move`, { folderId: "trash" }), 403),
		);

		// Everything both tabs were ever sent.
		expectOnlyCounters(mine, address);
		expectOnlyCounters(theirs, address);
		expect(theirs.texts).toEqual(mine.texts);
		// Every kind of write was fed through: the methods of the object that change mail and
		// did not run here are the ones about a failure on the way, tested where they belong.
		const writers = methods().filter((name) => !READS.includes(name) && !HANDLERS.includes(name));
		expect(writers.filter((name) => !ran.has(name)).sort()).toEqual([
			"dropArrival", // an arrival that failed (test/workerd/original.test.ts)
			"forgetAddress", // one known address
			"purge", // the mailbox deleted
		]);
		mine.socket.close(1000);
		theirs.socket.close(1000);
	});

	it("one message for each call that changed something, and none for one that did not", async () => {
		const { address } = await ownMailbox("calls");
		await deliver(address, marked(address, "Counted"));
		const id = await idOf(address, "Counted");
		const tab = await open(as("owner"), address);
		const stub = object(address);

		const told = async (act: () => Promise<unknown>) => {
			const before = tab.texts.length;
			await act();
			await quiet();
			return tab.texts.length - before;
		};
		expect(await told(() => stub.moveEmail(id, "archive"))).toBe(1);
		expect(await told(() => stub.updateEmail(id, { starred: true }))).toBe(1);
		// A call that changes many rows is one call.
		expect(
			await told(() =>
				stub.bulk({ ids: [id], unit: "conversation", change: { read: true, starred: false } }),
			),
		).toBe(1);
		expect(await told(() => stub.getEmail(id))).toBe(0);
		expect(await told(() => stub.getEmails({ folder: "archive" }))).toBe(0);
		expect(await told(() => stub.moveEmail(id, "no-such-place"))).toBe(0);
		expect(await told(() => stub.updateEmail(id, {}))).toBe(0);
		expect(await told(() => stub.markThreadRead("no-such-thread"))).toBe(0);
		expect(await told(() => stub.deleteEmail("no-such-message"))).toBe(0);
		// Three calls at once are three messages, each a state of its own.
		expect(
			await told(() =>
				Promise.all([
					stub.updateEmail(id, { read: false }),
					stub.updateEmail(id, { read: true }),
					stub.moveEmail(id, "inbox"),
				]),
			),
		).toBe(3);
		expect(new Set(tab.texts).size).toBe(tab.texts.length);
		tab.socket.close(1000);
	});

	it("a tab that opens later is told where the mailbox is, once", async () => {
		const { address, base } = await ownMailbox("later");
		await deliver(address, marked(address, "Before the tab"));
		expect((await as("owner").post(`${base}/labels`, { name: "Before" })).status).toBe(201);
		const tab = await open(as("owner"), address);
		await quiet();
		expect(tab.states).toEqual([{ delivery: "1", mail: "1", labels: "1", settings: "0" }]);
		tab.socket.close(1000);
	});
});

// ── The signal cannot be forgotten ─────────────────────────────────

const methods = () =>
	Object.getOwnPropertyNames(MailboxDO.prototype).filter((name) => name !== "constructor");

/** The methods that only read. Each is called below and must change no row. */
const READS = [
	"allKeys",
	"batchToEmpty",
	"checkSendRateLimit",
	"completeAddress",
	"countEmails",
	"countSearchResults",
	"countThreadedEmails",
	"draftFile",
	"findThreadBySubject",
	"findThreadOfReferences",
	"getAttachment",
	"getEmail",
	"getEmails",
	"getFolders",
	"getLabels",
	"getThreadEmails",
	"getThreadedEmails",
	"holdsFiles",
	"messageKeys",
	"originalOf",
	"searchEmails",
];
/** The connection itself: taking one, ending one. They change no row either. */
const HANDLERS = ["closeLive", "fetch", "webSocketClose", "webSocketMessage"];
/** Every other method writes, and this is what a call of it that changed a row is about. */
const WRITES: Record<string, LiveKind[]> = {
	// Mail
	createEmail: ["mail"],
	deleteEmail: ["mail"],
	emptyBatch: ["mail"],
	filesStored: ["mail"],
	labelConversation: ["mail"],
	markStored: ["mail"],
	markThreadRead: ["mail"],
	moveEmail: ["mail"],
	removeFile: ["mail"],
	runDeed: ["mail"],
	saveDraft: ["mail"],
	sendDraft: ["mail"],
	undoDeed: ["mail"],
	updateEmail: ["mail"],
	// Mail, when lines were ticked; nothing, when a filter was only counted
	bulk: ["mail"],
	// Arrival
	fileArrival: ["delivery", "mail"],
	// Labels
	createLabel: ["labels"],
	updateLabel: ["labels"],
	deleteLabel: ["labels", "mail"],
	// Settings: the method moves its own counter
	settingsSaved: [],
	// Rows no read of mail shows
	beginArrival: [],
	claimArrival: [],
	declareFile: [],
	dropArrival: [],
	forgetAddress: [],
	forgetAddresses: [],
	purge: [],
};

describe("the signal cannot be forgotten", () => {
	it("every method of the mailbox object is watched", () => {
		const unwatched = methods().filter((name) => {
			const method = Object.getOwnPropertyDescriptor(MailboxDO.prototype, name)?.value as
				| { [WATCHED]?: boolean }
				| undefined;
			return method?.[WATCHED] !== true;
		});
		expect(unwatched).toEqual([]);
		// The object's whole surface is its prototype: nothing callable is set on an instance.
		expect(methods().length).toBeGreaterThan(40);
	});

	it("every method is known here as a read or by what it is about: a new one fails this", () => {
		const known = [...READS, ...HANDLERS, ...Object.keys(WRITES)].sort();
		expect(known).toEqual([...methods()].sort());
		expect(new Set(known).size).toBe(known.length);
	});

	it("what a method is about is what the object's own list says, and mail when it says nothing", () => {
		for (const [name, kinds] of Object.entries(WRITES)) {
			const about = ABOUT[name] ?? ["mail"];
			const said = typeof about === "function" ? about({ deed: "d", more: false }) : [...about];
			expect([...said].sort(), name).toEqual([...kinds].sort());
		}
		// The list names no method that is not there, and no read.
		for (const name of Object.keys(ABOUT)) {
			expect(methods(), name).toContain(name);
			expect(READS, name).not.toContain(name);
		}
		// A filter that was only counted is about nothing.
		const bulk = ABOUT.bulk;
		expect(
			typeof bulk === "function" && bulk({ deed: "d", conversations: 3, messages: 4 }),
		).toEqual([]);
		expect(typeof bulk === "function" && bulk("not_found")).toEqual([]);
		expect(typeof bulk === "function" && bulk(undefined)).toEqual([]);
	});

	describe("a read changes no row", () => {
		const address = "reads@example.com";
		const SAMPLE: Record<string, unknown[]> = {
			allKeys: [],
			batchToEmpty: ["trash", new Date().toISOString()],
			checkSendRateLimit: [],
			completeAddress: ["a"],
			countEmails: [{ folder: "inbox" }],
			countSearchResults: [{ query: "seed" }],
			countThreadedEmails: ["inbox"],
			draftFile: ["seed-draft", "seed-file"],
			findThreadBySubject: ["Seed"],
			findThreadOfReferences: [["<seed@sender.test>"], "Seed"],
			getAttachment: ["seed-file"],
			getEmail: ["seed-1"],
			getEmails: [{ folder: "inbox" }],
			getFolders: [],
			getLabels: [],
			getThreadEmails: ["seed-thread"],
			getThreadedEmails: [{ folder: "inbox" }],
			holdsFiles: ["seed-draft"],
			messageKeys: ["seed-1"],
			originalOf: ["seed-1"],
			searchEmails: [{ query: "seed" }],
		};

		beforeAll(async () => {
			expect((await createMailbox(as("owner").cookie, address)).status).toBe(201);
			// Put there directly: seeding is the test's, not a method of the object.
			await inObject(address, (state) => {
				const now = new Date().toISOString();
				const sql = state.storage.sql;
				sql.exec(
					`INSERT INTO emails (id, folder_id, subject, sender, recipient, date, body, thread_id, message_id)
						VALUES ('seed-1', 'inbox', 'Seed', 'ada@sender.test', ?, ?, 'seed', 'seed-thread', '<seed@sender.test>'),
							('seed-draft', 'draft', 'Seed draft', ?, 'to@elsewhere.test', ?, 'seed', NULL, NULL),
							('seed-trash', 'trash', 'Seed gone', 'ada@sender.test', ?, ?, 'seed', NULL, NULL)`,
					address,
					now,
					address,
					now,
					address,
					now,
				);
				sql.exec(
					`INSERT INTO attachments (id, email_id, filename, mimetype, size) VALUES ('seed-file', 'seed-draft', 'a.txt', 'text/plain', 1)`,
				);
				sql.exec(
					`INSERT INTO labels (id, name, color, created_at) VALUES ('lbl_000000000000000000000001', 'Seed', 0, ?)`,
					now,
				);
				sql.exec(
					`INSERT INTO known_addresses (id, address, use_count, last_used_at, created_at) VALUES ('k1', 'ada@elsewhere.test', 1, ?, ?)`,
					now,
					now,
				);
			});
		});

		it("has a call for every read", () => {
			expect(Object.keys(SAMPLE).sort()).toEqual([...READS].sort());
		});

		it.each(READS)("%s", async (name) => {
			const tab = await open(as("owner"), address);
			const result = await runInDurableObject(mailboxStub(address), async (instance, state) => {
				const changes = () =>
					Number([...state.storage.sql.exec(`SELECT total_changes() AS n`)][0]?.n);
				const before = changes();
				const call = (
					instance as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>
				)[name];
				if (call === undefined) throw new Error(`no method ${name}`);
				const answer = await call.apply(instance, SAMPLE[name] ?? []);
				return { changed: changes() - before, answered: answer !== undefined };
			});
			// It found what was seeded, so it did read, and it changed nothing.
			expect(result).toEqual({ changed: 0, answered: true });
			expect(await counters(address)).toEqual({ delivery: 0, mail: 0, labels: 0, settings: 0 });
			await quiet();
			expect(tab.texts).toHaveLength(1);
			tab.socket.close(1000);
		});
	});

	it("a method written tomorrow raises the signal without knowing that there is one", async () => {
		const { address } = await ownMailbox("tomorrow");
		const tab = await open(as("owner"), address);
		await runInDurableObject(mailboxStub(address), async (_instance, state) => {
			// The next writer's class: one method that writes, one that reads, one that fails
			// after it wrote. None of them names a counter or a connection.
			class Tomorrow {
				constructor(readonly ctx: DurableObjectState) {}
				async snooze() {
					this.ctx.storage.sql.exec(
						`INSERT INTO emails (id, folder_id, subject, sender, recipient, date, body) VALUES ('t-1', 'inbox', ?, 'a@sender.test', 'b@example.com', ?, 'x')`,
						MARK,
						new Date().toISOString(),
					);
					return "snoozed";
				}
				async look() {
					return [...this.ctx.storage.sql.exec(`SELECT COUNT(*) AS n FROM emails`)][0]?.n;
				}
				async fail() {
					this.ctx.storage.sql.exec(`UPDATE emails SET read = 1 WHERE id = 't-1'`);
					throw new Error("after the write");
				}
			}
			watch(Tomorrow.prototype, (one) => one.ctx);
			const one = new Tomorrow(state);
			expect(await one.snooze()).toBe("snoozed");
			expect(await one.look()).toBe(1);
			await expect(one.fail()).rejects.toThrow("after the write");
		});
		await settled(() => tab.states.length === 3, "being told of both writes");
		// The write moved `mail`, the read moved nothing, and the write that failed is told too.
		expect(await counters(address)).toEqual({ delivery: 0, mail: 2, labels: 0, settings: 0 });
		expect(tab.states.map((state) => state.mail)).toEqual(["0", "1", "2"]);
		expectOnlyCounters(tab, address);
		tab.socket.close(1000);
	});
});

describe("the counters are stored", () => {
	it("go on from where they were after the object left memory", async () => {
		const { address, base } = await ownMailbox("stored");
		await deliver(address, marked(address, "Kept"));
		expect((await as("owner").post(`${base}/labels`, { name: "Kept" })).status).toBe(201);
		const before = await counters(address);
		expect(before).toEqual({ delivery: 1, mail: 1, labels: 1, settings: 0 });
		await evictDurableObject(mailboxStub(address));
		expect(await counters(address)).toEqual(before);
		await deliver(address, marked(address, "After"));
		expect(await counters(address)).toEqual({ delivery: 2, mail: 2, labels: 1, settings: 0 });
	});

	it("the message is built from the four counters and from nothing else a caller holds", () => {
		const state = {
			delivery: "1",
			mail: "2",
			labels: "3",
			settings: "4",
			subject: MARK,
		} as LiveState;
		expect(liveMessage(state)).toBe(
			'{"v":1,"type":"state","state":{"delivery":"1","mail":"2","labels":"3","settings":"4"}}',
		);
	});

	it("come with the database of the release before, at nought, and leave the mail as it is", async () => {
		const { address } = await ownMailbox("upgraded");
		await deliver(address, marked(address, "Old mail"));
		const mail = () =>
			inObject(address, (state) =>
				[
					...state.storage.sql.exec(`SELECT id, subject, folder_id, read FROM emails ORDER BY id`),
				].map((row) => ({ ...row })),
			);
		const before = await mail();
		expect(before).toHaveLength(1);

		await inObject(address, (state) => {
			const sql = state.storage.sql;
			// The database as the release before left it: no table, no record of the migration.
			sql.exec(`DROP TABLE states`);
			sql.exec(`DELETE FROM d1_migrations WHERE name = '16_states'`);
			applyMigrations(sql, mailboxMigrations, state.storage);
			// Applying it again changes nothing.
			applyMigrations(sql, mailboxMigrations, state.storage);
		});
		expect(await counters(address)).toEqual({ delivery: 0, mail: 0, labels: 0, settings: 0 });
		const columns = await inObject(address, (state) =>
			[...state.storage.sql.exec(`PRAGMA table_info(states)`)].map((row) => String(row.name)),
		);
		expect(columns).toEqual(["kind", "value"]);
		expect(await mail()).toEqual(before);
		expect(mailboxMigrations.at(-1)?.name).toBe("16_states");
		// And it counts from there.
		await deliver(address, marked(address, "New mail"));
		expect(await counters(address)).toEqual({ delivery: 1, mail: 1, labels: 0, settings: 0 });
	});
});
