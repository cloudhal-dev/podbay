/**
 * Tier 3: the connection on which a mailbox tells the open app that something changed
 * (ADR-0013). This file holds who may open it and when it ends; what is told on it is in
 * `live-signal.test.ts`.
 *
 * - the route is in the route table, marked as an upgrade, with the right to read: a reader
 *   may listen, someone without a membership is told 404 whatever their instance role, and
 *   nobody listens without a session;
 * - the guard is stricter for it than for a read: a request that is not an upgrade is 426, an
 *   origin that is missing or is not the app's own is 403 before a session is looked for, and
 *   a session that was ended a moment ago is refused although its cookie still holds a copy;
 * - a connection ends where a right ends: removing a member, changing a role and deleting the
 *   mailbox close connections in the same request, and five minutes after the guard allowed
 *   it a connection is closed instead of told;
 * - the object knows a connection's person after it slept;
 * - the app says `ping` and nothing else, and the limits of decision 20 hold.
 */
import { evictDurableObject, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { LIVE_CLOSE_CODE, LIVE_CLOSED, LIVE_LIMITS, LIVE_PONG } from "../../shared/live.ts";
import { upgradeRefusal } from "../../workers/auth/middleware.ts";
import { ROUTE_TABLE } from "../../workers/auth/route-table.ts";
import { liveRequest } from "../../workers/durableObject/live.ts";
import {
	Browser,
	createMailbox,
	migrate,
	ORIGIN,
	seedMembership,
	seedUser,
	setupOwner,
	testEnv,
} from "./helpers.ts";
import {
	ageConnections,
	GOOD_FOR_MINUTES,
	handshake,
	inObject,
	livePath,
	mailboxStub,
	open,
	quiet,
	settled,
	type Tab,
} from "./live-helpers.ts";

const MAILBOX = "live@example.com";
const M = `/api/v1/mailboxes/${encodeURIComponent(MAILBOX)}`;

const browsers: Record<string, Browser> = {};
const ids: Record<string, string> = {};
const as = (who: string) => browsers[who] as Browser;

/** A mailbox of its own, with the owner and one reader, for a test that ends connections. */
async function ownMailbox(name: string) {
	const address = `${name}@example.com`;
	expect((await createMailbox(as("owner").cookie, address)).status).toBe(201);
	await seedMembership(address, ids.reader ?? "", "reader");
	return { address, base: `/api/v1/mailboxes/${encodeURIComponent(address)}` };
}

/** Something that changes the mailbox, so that it has something to tell. */
async function change(base: string, name: string) {
	const made = await as("owner").post(`${base}/labels`, { name });
	expect(made.status, `making the label ${name}`).toBe(201);
}

beforeAll(async () => {
	await migrate();
	expect((await setupOwner()).status).toBe(201);
	ids.admin = await seedUser("admin@example.com", "admin");
	ids.reader = await seedUser("reader@example.com", "member");
	ids.sender = await seedUser("sender@example.com", "member");
	ids.outsider = await seedUser("outsider@example.com", "member");
	for (const who of ["owner", "admin", "reader", "sender", "outsider"]) {
		browsers[who] = new Browser();
		expect((await as(who).signIn(`${who}@example.com`)).status, who).toBe(200);
	}
	expect((await createMailbox(as("owner").cookie, MAILBOX)).status).toBe(201);
	await seedMembership(MAILBOX, ids.reader, "reader");
	await seedMembership(MAILBOX, ids.sender, "sender");
});

describe("the route", () => {
	it("is in the route table, marked as an upgrade, and is the only route so marked", () => {
		expect(ROUTE_TABLE.filter((route) => route.upgrade === true)).toEqual([
			{
				method: "GET",
				path: "/api/v1/mailboxes/:mailboxId/live",
				right: "mailbox.read",
				upgrade: true,
			},
		]);
	});

	it.each(["owner", "sender", "reader"])("lets %s listen: whoever may read", async (who) => {
		const tab = await open(as(who), MAILBOX);
		expect(tab.states).toHaveLength(1);
		tab.socket.close(1000);
	});

	it.each(["outsider", "admin"])("answers 404 to %s, who is not a member", async (who) => {
		const res = await handshake(MAILBOX, { cookie: as(who).cookie });
		expect(res.status).toBe(404);
		expect(res.webSocket).toBeNull();
		expect(await res.json()).toEqual({ error: "Not found" });
	});

	it("answers the same 404 for a mailbox that does not exist and for a crafted name", async () => {
		for (const name of ["ghost@example.com", "../live@example.com", "live@example.com/.."]) {
			const res = await handshake(name, { cookie: as("owner").cookie });
			expect(res.status, name).toBe(404);
			expect(res.webSocket, name).toBeNull();
		}
	});

	it("answers 401 without a session, and a token in the address is not one", async () => {
		const res = await handshake(MAILBOX);
		expect(res.status).toBe(401);
		expect(res.webSocket).toBeNull();
		// Nothing in the address is ever looked at as proof: not a session token, not a key.
		const token = as("owner").cookie.split("=").slice(1).join("=").split(";")[0] ?? "";
		for (const query of [`?token=${token}`, `?session=${token}`, `?access_token=${token}`]) {
			const withToken = await SELF.fetch(`${ORIGIN}${livePath(MAILBOX)}${query}`, {
				headers: { upgrade: "websocket", origin: ORIGIN },
			});
			expect(withToken.status, query.split("=")[0]).toBe(401);
		}
		const bearer = await SELF.fetch(`${ORIGIN}${livePath(MAILBOX)}`, {
			headers: { upgrade: "websocket", origin: ORIGIN, authorization: `Bearer ${token}` },
		});
		expect(bearer.status).toBe(401);
	});

	it("answers 426 to a request that is not an upgrade, whoever asks", async () => {
		const answers: string[] = [];
		for (const cookie of [undefined, as("owner").cookie, as("outsider").cookie]) {
			const res = await handshake(MAILBOX, { cookie, upgrade: false });
			expect(res.status).toBe(426);
			expect(res.headers.get("upgrade")).toBe("websocket");
			answers.push(await res.text());
		}
		// One answer for all three: it says nothing about a session or a mailbox.
		expect(new Set(answers).size).toBe(1);
		// A request that only claims another protocol is no handshake either.
		const other = await SELF.fetch(`${ORIGIN}${livePath(MAILBOX)}`, {
			headers: { upgrade: "h2c", origin: ORIGIN, cookie: as("owner").cookie },
		});
		expect(other.status).toBe(426);
	});

	it("answers 403 to another origin, a sibling host and no origin, before the session", async () => {
		// A page of another site, a page of a sibling host (which a browser gives the cookie
		// to), a sandboxed page, the same host over another scheme, and no origin at all: a
		// program, which the route has no way in for.
		const foreign = [
			"https://elsewhere.test",
			"https://blog.podbay.test",
			"https://podbay.test.elsewhere.test",
			"http://podbay.test",
			"null",
			null,
		];
		const answers = new Set<string>();
		for (const origin of foreign) {
			for (const who of ["owner", "outsider", undefined]) {
				const res = await handshake(MAILBOX, { origin, cookie: who && as(who).cookie });
				expect(res.status, `${origin} as ${who}`).toBe(403);
				expect(res.webSocket, `${origin} as ${who}`).toBeNull();
				answers.add(await res.text());
			}
		}
		// The same answer with a member's session, a stranger's and none: the origin is asked
		// first, so a foreign page learns nothing about a session or a mailbox.
		expect([...answers]).toEqual([JSON.stringify({ error: "Cross-origin request refused" })]);
		expect((await handshake(MAILBOX, { origin: null, cookie: as("owner").cookie })).status).toBe(
			403,
		);
	});

	it("holds the origin of an upgrade in one function", () => {
		const ask = (headers: Record<string, string>) =>
			upgradeRefusal(new Request(`${ORIGIN}/api/v1/mailboxes/x/live`, { headers }));
		expect(ask({ upgrade: "websocket", origin: ORIGIN })).toBeNull();
		expect(ask({ upgrade: "WebSocket", origin: ORIGIN })).toBeNull();
		expect(ask({ origin: ORIGIN })).toBe(426);
		expect(ask({ upgrade: "websocket" })).toBe(403);
		expect(ask({ upgrade: "websocket", origin: "https://blog.podbay.test" })).toBe(403);
		expect(ask({ upgrade: "websocket", origin: `${ORIGIN}:8443` })).toBe(403);
		expect(ask({ upgrade: "websocket", origin: `${ORIGIN}/` })).toBe(403);
		// Not an upgrade and not the app's own: the first refusal says the least.
		expect(ask({ origin: "https://elsewhere.test" })).toBe(426);
	});

	it("refuses a session that was ended a moment ago, although its cookie still holds a copy", async () => {
		const browser = new Browser();
		expect((await browser.signIn("sender@example.com")).status).toBe(200);
		const before = await open(browser, MAILBOX);
		before.socket.close(1000);

		// The session ends on the server; the browser keeps its cookies, the cached copy too.
		await testEnv.DB.prepare(`delete from "session" where "userId" = ?1`).bind(ids.sender).run();
		// An ordinary read still passes on the copy in the cookie, for up to a minute.
		expect((await browser.fetch(`${M}/folders`)).status).toBe(200);
		// The connection is opened on the session in the database, and there is none.
		const res = await handshake(MAILBOX, { cookie: browser.cookie });
		expect(res.status).toBe(401);
		expect(res.webSocket).toBeNull();

		expect((await as("sender").signIn("sender@example.com")).status).toBe(200);
	});

	it("hands the object a request the Worker builds, with nothing of the browser's", () => {
		// What the object is handed is a request the Worker builds: who and when, nothing else.
		const built = liveRequest("person-1", 1_700_000_000_000);
		expect([...built.headers.keys()].sort()).toEqual([
			"upgrade",
			"x-podbay-allowed-at",
			"x-podbay-person",
		]);
		expect(new URL(built.url).search).toBe("");
		expect(built.headers.get("cookie")).toBeNull();
	});
});

describe("what the app may say", () => {
	it("is `ping`, which is answered `pong` and tells the mailbox nothing", async () => {
		const tab = await open(as("owner"), MAILBOX);
		tab.say("ping");
		await settled(() => tab.texts.includes(LIVE_PONG), "the answer to ping");
		tab.say("ping");
		await settled(() => tab.texts.filter((text) => text === LIVE_PONG).length === 2);
		expect(tab.closed).toBeNull();
		expect(tab.states).toHaveLength(1);
		// The platform answered: the object kept no record of a message, only of the answer.
		const answered = await inObject(MAILBOX, (state) =>
			state.getWebSockets().some((ws) => state.getWebSocketAutoResponseTimestamp(ws) !== null),
		);
		expect(answered).toBe(true);
		tab.socket.close(1000);
	});

	it.each([
		["another word", "hello"],
		["`ping` with anything around it", " ping"],
		["`PING`", "PING"],
		["a message of the protocol", JSON.stringify({ v: 1, type: "state", state: {} })],
		["a long message", "x".repeat(LIVE_LIMITS.messageBytes + 1)],
		["bytes", new Uint8Array([112, 105, 110, 103])],
	])("closes the connection for %s (1008)", async (_what, message) => {
		const tab = await open(as("owner"), MAILBOX);
		const other = await open(as("reader"), MAILBOX);
		tab.socket.send(message);
		await settled(() => tab.closed !== null, "the close");
		expect(tab.closed).toEqual({ code: LIVE_CLOSE_CODE, reason: LIVE_CLOSED.message });
		// It was answered nothing, and nobody else was told or closed.
		expect(tab.texts).toHaveLength(1);
		await quiet();
		expect(other.closed).toBeNull();
		expect(other.texts).toHaveLength(1);
		other.socket.close(1000);
	});
});

describe("a right that ends", () => {
	it("removing a member closes that person's connections in the same request, and no other", async () => {
		const { address, base } = await ownMailbox("removed");
		const theirs = [await open(as("reader"), address), await open(as("reader"), address)];
		const mine = await open(as("owner"), address);

		const removed = await as("owner").fetch(`${base}/members/${ids.reader}`, { method: "DELETE" });
		expect(removed.status).toBe(204);
		// In the same request: by the time it has answered, the object has closed them.
		const open_ = await inObject(address, (state) =>
			state.getWebSockets(ids.reader).filter((ws) => ws.readyState === 1),
		);
		expect(open_).toHaveLength(0);
		for (const tab of theirs) {
			await settled(() => tab.closed !== null, "the reader's connection closing");
			expect(tab.closed).toEqual({ code: LIVE_CLOSE_CODE, reason: LIVE_CLOSED.ended });
		}
		// What happens next is told to the owner and not to the person who was removed.
		await change(base, "After removal");
		await settled(() => mine.states.length === 2, "the owner being told");
		expect(mine.closed).toBeNull();
		for (const tab of theirs) expect(tab.texts).toHaveLength(1);
		// Coming back goes through the guard, which answers as for anyone who is not a member.
		expect((await handshake(address, { cookie: as("reader").cookie })).status).toBe(404);
		mine.socket.close(1000);
	});

	it("changing a role closes that person's connections in the same request", async () => {
		const { address, base } = await ownMailbox("demoted");
		const theirs = await open(as("reader"), address);
		const mine = await open(as("owner"), address);
		const changed = await as("owner").fetch(`${base}/members/${ids.reader}`, {
			method: "PUT",
			body: JSON.stringify({ role: "sender" }),
		});
		expect(changed.status).toBe(200);
		await settled(() => theirs.closed !== null, "the connection closing");
		expect(theirs.closed).toEqual({ code: LIVE_CLOSE_CODE, reason: LIVE_CLOSED.ended });
		await quiet();
		expect(mine.closed).toBeNull();
		// They still read the mailbox, so they come back through the guard and are let in.
		const again = await open(as("reader"), address);
		expect(again.states).toHaveLength(1);
		again.socket.close(1000);
		mine.socket.close(1000);
	});

	it("a change of members that is refused closes nothing", async () => {
		const { address, base } = await ownMailbox("kept");
		const mine = await open(as("owner"), address);
		// A mailbox keeps an owner: the request is refused and the index is not written.
		const refused = await as("owner").fetch(`${base}/members/${(await as("owner").me()).id}`, {
			method: "DELETE",
		});
		expect(refused.status).toBe(409);
		await quiet();
		expect(mine.closed).toBeNull();
		mine.socket.close(1000);
	});

	it("an administrator without a membership who removes a member closes their connections too", async () => {
		const { address, base } = await ownMailbox("managed");
		const theirs = await open(as("reader"), address);
		const removed = await as("admin").fetch(`${base}/members/${ids.reader}`, { method: "DELETE" });
		expect(removed.status).toBe(204);
		await settled(() => theirs.closed !== null, "the connection closing");
		expect(theirs.closed).toEqual({ code: LIVE_CLOSE_CODE, reason: LIVE_CLOSED.ended });
		// Managing is still not reading: the administrator cannot listen.
		expect((await handshake(address, { cookie: as("admin").cookie })).status).toBe(404);
	});

	it("deleting the mailbox closes every connection in the same request", async () => {
		const { address, base } = await ownMailbox("deleted");
		const tabs = [await open(as("owner"), address), await open(as("reader"), address)];
		expect((await as("owner").fetch(base, { method: "DELETE" })).status).toBe(204);
		for (const tab of tabs) {
			await settled(() => tab.closed !== null, "the connection closing");
			expect(tab.closed).toEqual({ code: LIVE_CLOSE_CODE, reason: LIVE_CLOSED.ended });
			expect(tab.texts).toHaveLength(1);
		}
		expect((await handshake(address, { cookie: as("owner").cookie })).status).toBe(404);
	});
});

describe("a connection is good for five minutes", () => {
	it("the next write closes an older connection instead of telling it", async () => {
		const { address, base } = await ownMailbox("aged");
		const old = await open(as("owner"), address);
		expect(await ageConnections(address, GOOD_FOR_MINUTES)).toBe(1);
		const fresh = await open(as("reader"), address);
		// A new connection already found the old one too old.
		await settled(() => old.closed !== null, "the old connection closing");
		expect(old.closed).toEqual({ code: LIVE_CLOSE_CODE, reason: LIVE_CLOSED.expired });

		const again = await open(as("owner"), address);
		expect(await ageConnections(address, GOOD_FOR_MINUTES)).toBe(2);
		const young = await open(as("owner"), address);
		await settled(() => again.closed !== null && fresh.closed !== null);
		await change(base, "Told to the young");
		await settled(() => young.states.length === 2, "the young connection being told");
		// The two that were allowed five minutes ago were closed, and told nothing first.
		expect(again.closed).toEqual({ code: LIVE_CLOSE_CODE, reason: LIVE_CLOSED.expired });
		expect(fresh.closed).toEqual({ code: LIVE_CLOSE_CODE, reason: LIVE_CLOSED.expired });
		expect(again.texts).toHaveLength(1);
		expect(fresh.texts).toHaveLength(1);
		young.socket.close(1000);
	});

	it("a write closes it at five minutes, with nothing sent on it, and not a minute before", async () => {
		const { address, base } = await ownMailbox("minutes");
		const nearly = await open(as("owner"), address);
		const over = await open(as("reader"), address);
		// One of them is a minute short of five minutes, the other exactly there.
		await inObject(address, (state) => {
			for (const ws of state.getWebSockets()) {
				const held = ws.deserializeAttachment() as { at: number; sent: string };
				const tags = state.getTags(ws);
				const back = tags.includes(ids.reader ?? "")
					? LIVE_LIMITS.goodForMs
					: LIVE_LIMITS.goodForMs - 60_000;
				ws.serializeAttachment({ ...held, at: held.at - back });
			}
		});
		await change(base, "Nearly");
		await settled(() => nearly.states.length === 2 && over.closed !== null);
		expect(over.closed).toEqual({ code: LIVE_CLOSE_CODE, reason: LIVE_CLOSED.expired });
		expect(over.texts).toHaveLength(1);
		expect(nearly.closed).toBeNull();
		nearly.socket.close(1000);
	});

	it("a time the object's clock has not reached does not keep a connection for longer", async () => {
		const { address } = await ownMailbox("ahead");
		const ahead = Date.now() + 60 * 60_000;
		// As the Worker hands it over, past the guard.
		const res = await mailboxStub(address).fetch(liveRequest("person-ahead", ahead));
		expect(res.status).toBe(101);
		const kept = await inObject(address, (state) =>
			state
				.getWebSockets("person-ahead")
				.map((ws) => (ws.deserializeAttachment() as { at: number }).at),
		);
		expect(kept).toHaveLength(1);
		expect(kept[0]).toBeLessThanOrEqual(Date.now());
		res.webSocket?.accept();
		res.webSocket?.close(1000);
	});
});

describe("after the object slept", () => {
	it("a connection found by its tag is still the same person's, and is told and closed as before", async () => {
		const { address, base } = await ownMailbox("slept");
		const mine = await open(as("owner"), address);
		const theirs = await open(as("reader"), address);
		await change(base, "Before sleep");
		await settled(() => mine.states.length === 2 && theirs.states.length === 2);

		// The object leaves memory with its connections open, as it does when idle.
		await evictDurableObject(mailboxStub(address));
		expect(mine.closed).toBeNull();
		expect(theirs.closed).toBeNull();

		// What it kept with each connection is there after the wake: whose it is, when the
		// guard allowed it, and what it was last told.
		const kept = await inObject(address, (state) =>
			state.getWebSockets().map((ws) => ({
				tags: state.getTags(ws),
				held: ws.deserializeAttachment() as { at: number; sent: string },
			})),
		);
		expect(kept.map((one) => one.tags).sort()).toEqual(
			[[(await as("owner").me()).id], [ids.reader]].sort(),
		);
		for (const one of kept) {
			expect(Date.now() - one.held.at).toBeLessThan(LIVE_LIMITS.goodForMs);
			expect(one.held.sent).toBe(JSON.stringify({ v: 1, type: "state", state: mine.last }));
		}
		const byTag = await inObject(address, (state) => ({
			reader: state.getWebSockets(ids.reader).length,
			nobody: state.getWebSockets("nobody").length,
		}));
		expect(byTag).toEqual({ reader: 1, nobody: 0 });

		// `ping` is still answered, and a wake by itself tells nothing a second time.
		theirs.say("ping");
		await settled(() => theirs.texts.includes(LIVE_PONG), "the answer to ping after sleep");
		await quiet();
		expect(mine.states).toHaveLength(2);

		// A change after the sleep is told once to both, and its counter went on from before.
		await evictDurableObject(mailboxStub(address));
		await change(base, "After sleep");
		await settled(() => mine.states.length === 3 && theirs.states.length === 3);
		expect(Number(mine.last.labels)).toBe(Number(mine.states[1]?.labels) + 1);

		// Removing the reader after another sleep closes the reader's connection, not the owner's.
		await evictDurableObject(mailboxStub(address));
		const removed = await as("owner").fetch(`${base}/members/${ids.reader}`, { method: "DELETE" });
		expect(removed.status).toBe(204);
		await settled(() => theirs.closed !== null, "the reader's connection closing");
		expect(theirs.closed).toEqual({ code: LIVE_CLOSE_CODE, reason: LIVE_CLOSED.ended });
		await quiet();
		expect(mine.closed).toBeNull();
		mine.socket.close(1000);
	});

	it("an old connection is still closed instead of told", async () => {
		const { address, base } = await ownMailbox("slept-old");
		const old = await open(as("owner"), address);
		await ageConnections(address, GOOD_FOR_MINUTES);
		await evictDurableObject(mailboxStub(address));
		await change(base, "After a long sleep");
		await settled(() => old.closed !== null, "the old connection closing");
		expect(old.closed).toEqual({ code: LIVE_CLOSE_CODE, reason: LIVE_CLOSED.expired });
		expect(old.texts).toHaveLength(1);
	});
});

describe("the limits", () => {
	it("a ninth connection of one person closes their oldest, and nobody else's", async () => {
		const { address } = await ownMailbox("ninth");
		const other = await open(as("reader"), address);
		const tabs: Tab[] = [];
		for (let n = 0; n < LIVE_LIMITS.perPerson; n++) {
			tabs.push(await open(as("owner"), address));
			// Each a moment after the one before, so "oldest" is never a tie.
			await inObject(address, (state) => {
				for (const ws of state.getWebSockets()) {
					const held = ws.deserializeAttachment() as { at: number; sent: string };
					ws.serializeAttachment({ ...held, at: held.at - 1000 });
				}
			});
		}
		await quiet();
		expect(tabs.every((tab) => tab.closed === null)).toBe(true);

		const ninth = await open(as("owner"), address);
		await settled(() => tabs[0]?.closed !== null, "the oldest closing");
		expect(tabs[0]?.closed).toEqual({ code: LIVE_CLOSE_CODE, reason: LIVE_CLOSED.limit });
		await quiet();
		expect(tabs.slice(1).every((tab) => tab.closed === null)).toBe(true);
		expect(ninth.closed).toBeNull();
		expect(other.closed).toBeNull();
		const open_ = await inObject(
			address,
			(state) => state.getWebSockets().filter((ws) => ws.readyState === 1).length,
		);
		expect(open_).toBe(LIVE_LIMITS.perPerson + 1);
		for (const tab of [...tabs, ninth, other]) tab.socket.close(1000);
	});

	it("the two hundred and first connection to a mailbox is refused with 503", async () => {
		const { address, base } = await ownMailbox("full");
		// Twenty-five people with eight connections each, taken by the object as the Worker
		// hands them over.
		const now = Date.now();
		const held: WebSocket[] = [];
		for (let n = 0; n < LIVE_LIMITS.perMailbox; n++) {
			const person = `person-${Math.floor(n / LIVE_LIMITS.perPerson)}`;
			const res = await mailboxStub(address).fetch(liveRequest(person, now));
			expect(res.status, `connection ${n + 1}`).toBe(101);
			if (res.webSocket === null) throw new Error("no connection");
			res.webSocket.accept();
			held.push(res.webSocket);
		}

		const refused = await handshake(address, { cookie: as("owner").cookie });
		expect(refused.status).toBe(503);
		expect(refused.webSocket).toBeNull();
		// Nobody was closed to make room, and the mailbox still works for that tab's asking.
		const open_ = await inObject(
			address,
			(state) => state.getWebSockets().filter((ws) => ws.readyState === 1).length,
		);
		expect(open_).toBe(LIVE_LIMITS.perMailbox);
		expect((await as("owner").fetch(`${base}/folders`)).status).toBe(200);

		// A place that comes free is taken by the next one.
		held[0]?.close(1000);
		let left: number = LIVE_LIMITS.perMailbox;
		for (let turn = 0; turn < 100 && left === LIVE_LIMITS.perMailbox; turn++) {
			left = await inObject(
				address,
				(state) => state.getWebSockets().filter((ws) => ws.readyState === 1).length,
			);
		}
		expect(left).toBe(LIVE_LIMITS.perMailbox - 1);
		const taken = await open(as("owner"), address);
		expect(taken.states).toHaveLength(1);
		for (const socket of held) socket.close(1000);
		taken.socket.close(1000);
	});

	it("the object refuses a request that is not the Worker's handshake", async () => {
		const stub = mailboxStub(MAILBOX);
		const ask = (request: Request) => stub.fetch(request);
		expect((await ask(new Request("https://mailbox.invalid/live"))).status).toBe(426);
		const nobody = new Request("https://mailbox.invalid/live", {
			headers: { upgrade: "websocket" },
		});
		expect((await ask(nobody)).status).toBe(400);
		const long = liveRequest("p".repeat(257), Date.now());
		expect((await ask(long)).status).toBe(400);
	});
});

describe("the log", () => {
	it("says that a connection opened and closed, with opaque ids, and never a message", async () => {
		const lines: string[] = [];
		const spy = vi.spyOn(console, "log").mockImplementation((line: unknown) => {
			lines.push(String(line));
		});
		try {
			const { address, base } = await ownMailbox("logged");
			const tab = await open(as("owner"), address);
			await change(base, "Logged label");
			await settled(() => tab.states.length === 2);
			tab.say("something else");
			await settled(() => tab.closed !== null);
			await quiet();

			const live = lines.filter((line) => line.includes('"event":"live.'));
			const events = live.map((line) => (JSON.parse(line) as { event: string }).event);
			expect(events).toContain("live.opened");
			expect(events).toContain("live.closed");
			const owner = (await as("owner").me()).id ?? "";
			for (const line of live) {
				const fields = JSON.parse(line) as Record<string, unknown>;
				// The mailbox is named by the id of its object, the person by their account's id.
				expect(fields.mailbox).toMatch(/^[0-9a-f]{64}$/);
				expect(Object.keys(fields).sort().join()).toMatch(
					/^(code,|connections,)?event,level,mailbox(,person)?(,why)?$/,
				);
				if (fields.person !== undefined) expect(fields.person).toBe(owner);
				// Not the address, not the label, not a counter or a word of a message.
				expect(line).not.toContain(address);
				expect(line).not.toContain("@");
				expect(line).not.toContain("Logged label");
				expect(line).not.toContain("something else");
				expect(line).not.toContain('"state"');
			}
		} finally {
			spy.mockRestore();
		}
	});
});
