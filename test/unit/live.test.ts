/**
 * Tier 0: the message a mailbox sends the open app, and the app's end of the connection
 * (ADR-0013).
 *
 * - the message is four counters and a version, written and read by one schema; the reader
 *   ignores a field or a kind it does not know and says so when the version is not one it knows;
 * - the app waits a second, then double, up to a minute, each time by a random part less;
 * - it refetches at once for the first message and then at most once a second;
 * - a version it does not know ends the connection for good, and the app goes on asking;
 * - it says `ping` every minute and nothing else, opens a new connection after about four
 *   minutes, and closes the old one only when the new one has spoken;
 * - the page's content policy is not widened for it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	LIVE_TIMING,
	LiveConnection,
	type LiveSocket,
	liveUrl,
	liveWait,
} from "../../app/lib/live.ts";
import {
	LIVE_CLOSE_CODE,
	LIVE_CLOSED,
	LIVE_KINDS,
	LIVE_LIMITS,
	LIVE_PING,
	LIVE_PONG,
	LIVE_VERSION,
	type LiveKind,
	type LiveState,
	liveMessage,
	movedKinds,
	readLiveMessage,
} from "../../modules/mail/shared/live.ts";
import { PAGE_CONTENT_POLICY } from "../../shared/security-headers.ts";

const state = (delivery = 0, mail = 0, labels = 0, settings = 0): LiveState => ({
	delivery: String(delivery),
	mail: String(mail),
	labels: String(labels),
	settings: String(settings),
});

describe("the message", () => {
	it("has the sticky names the record fixed", () => {
		expect(LIVE_VERSION).toBe(1);
		expect(LIVE_KINDS).toEqual(["delivery", "mail", "labels", "settings"]);
		expect([LIVE_PING, LIVE_PONG]).toEqual(["ping", "pong"]);
		expect(LIVE_CLOSE_CODE).toBe(1008);
		expect(LIVE_LIMITS).toMatchObject({
			perPerson: 8,
			perMailbox: 200,
			goodForMs: 300_000,
			pingEveryMs: 60_000,
			pongWithinMs: 10_000,
			messageBytes: 256,
		});
		// The app comes back before the object would close it.
		expect(LIVE_LIMITS.renewAfterMs).toBeLessThan(LIVE_LIMITS.goodForMs);
	});

	it("is exactly the shape of the record", () => {
		expect(JSON.parse(liveMessage(state(41, 1203, 9, 3)))).toEqual({
			v: 1,
			type: "state",
			state: { delivery: "41", mail: "1203", labels: "9", settings: "3" },
		});
	});

	it("carries the four counters and nothing else its writer was handed", () => {
		const handed = {
			...state(1, 2, 3, 4),
			subject: "Hello",
			sender: "ada@sender.test",
			unread: "7",
		};
		const text = liveMessage(handed);
		expect(Object.keys(JSON.parse(text).state)).toEqual([...LIVE_KINDS]);
		expect(text).not.toContain("Hello");
		expect(text).not.toContain("@");
		expect(text).not.toContain("unread");
	});

	it("is refused when a counter is not a number, so nothing else can stand in its place", () => {
		for (const value of ["", "abc", "1 OR 1", "ada@sender.test", "-1", "1.5", "9".repeat(21)]) {
			expect(() => liveMessage({ ...state(), mail: value }), value).toThrow();
		}
		expect(() => liveMessage({ delivery: "1", mail: "1", labels: "1" } as LiveState)).toThrow();
		expect(() => liveMessage({ ...state(), mail: 3 as unknown as string })).toThrow();
	});

	it("stays under 256 bytes with the largest counters a mailbox can reach", () => {
		const largest = String(Number.MAX_SAFE_INTEGER);
		const text = liveMessage({
			delivery: largest,
			mail: largest,
			labels: largest,
			settings: largest,
		});
		expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(LIVE_LIMITS.messageBytes);
		// Even 20 digits each fit.
		const longest = "9".repeat(20);
		expect(
			liveMessage({ delivery: longest, mail: longest, labels: longest, settings: longest }).length,
		).toBeLessThanOrEqual(LIVE_LIMITS.messageBytes);
	});

	it("is read back as it was written", () => {
		expect(readLiveMessage(liveMessage(state(1, 2, 3, 4)))).toEqual({
			is: "state",
			state: state(1, 2, 3, 4),
		});
	});
});

describe("reading a message", () => {
	const read = (value: unknown) => readLiveMessage(JSON.stringify(value));

	it("ignores a field and a kind it does not know", () => {
		expect(
			read({
				v: 1,
				type: "state",
				since: "yesterday",
				state: { ...state(1, 2, 3, 4), snoozed: "9", people: { a: 1 } },
			}),
		).toEqual({ is: "state", state: state(1, 2, 3, 4) });
	});

	it("takes the kinds a message carries and leaves the others as they were held", () => {
		const partial = read({ v: 1, type: "state", state: { mail: "7" } });
		expect(partial).toEqual({ is: "state", state: { mail: "7" } });
		// What is not carried has not moved.
		expect(movedKinds(state(1, 2, 3, 4), { mail: "7" })).toEqual(["mail"]);
		expect(movedKinds(state(1, 7, 3, 4), { mail: "7" })).toEqual([]);
	});

	it("does not take a counter that is not text of digits", () => {
		expect(
			read({ v: 1, type: "state", state: { delivery: 4, mail: "x", labels: null, settings: "2" } }),
		).toEqual({ is: "state", state: { settings: "2" } });
	});

	it("passes over a type it does not know, in a version it knows", () => {
		expect(read({ v: 1, type: "presence", who: "someone" })).toEqual({ is: "nothing" });
		expect(read({ v: 1, type: "state" })).toEqual({ is: "nothing" });
		expect(read({ v: 1, type: "state", state: "41" })).toEqual({ is: "nothing" });
		expect(read({ v: 1 })).toEqual({ is: "nothing" });
	});

	it.each([
		["a later version", JSON.stringify({ v: 2, type: "state", state: state() })],
		["a version as text", JSON.stringify({ v: "1", type: "state", state: state() })],
		["no version", JSON.stringify({ type: "state", state: state() })],
		["a list", JSON.stringify([{ v: 1 }])],
		["a word", "hello"],
		["nothing", ""],
		["something very long", `{"v":1,"type":"state","pad":"${"x".repeat(5000)}"}`],
	])("says that it does not know %s", (_what, text) => {
		expect(readLiveMessage(text)).toEqual({ is: "unknown" });
	});

	it("does not know what is not text", () => {
		for (const value of [undefined, null, 1, {}, new ArrayBuffer(4)]) {
			expect(readLiveMessage(value)).toEqual({ is: "unknown" });
		}
	});

	it("compares counters and never calculates with them", () => {
		// A counter that is smaller than the one held has still moved: a mailbox made again at
		// the same address starts over.
		expect(movedKinds(state(5, 5, 5, 5), state(5, 2, 5, 5))).toEqual(["mail"]);
		expect(movedKinds(state(1, 1, 1, 1), state(1, 1, 1, 1))).toEqual([]);
		expect(movedKinds(state(1, 1, 1, 1), state(2, 2, 2, 2))).toEqual([...LIVE_KINDS]);
		// With nothing held, everything it carries may have moved.
		expect(movedKinds(null, state())).toEqual([...LIVE_KINDS]);
		expect(movedKinds(null, { labels: "3" })).toEqual(["labels"]);
	});
});

describe("the wait before another attempt", () => {
	it("is a second, then double, up to a minute", () => {
		const whole = [0, 1, 2, 3, 4, 5, 6, 7, 20, 1000].map((failures) => liveWait(failures, 0));
		expect(whole).toEqual([1000, 2000, 4000, 8000, 16_000, 32_000, 60_000, 60_000, 60_000, 60_000]);
	});

	it("is by a random part less, and never less than half", () => {
		for (let failures = 0; failures < 12; failures++) {
			const whole = liveWait(failures, 0);
			expect(liveWait(failures, 1)).toBe(whole / 2);
			for (const random of [0.001, 0.25, 0.5, 0.75, 0.999]) {
				const wait = liveWait(failures, random);
				expect(wait).toBeGreaterThanOrEqual(whole / 2);
				expect(wait).toBeLessThanOrEqual(whole);
			}
			expect(liveWait(failures, 0.25)).toBeLessThan(whole);
		}
	});

	it("stays inside its bounds whatever it is handed", () => {
		for (const random of [-1, 2, Number.NaN]) {
			const wait = liveWait(3, random);
			expect(wait >= 4000 && wait <= 8000, String(random)).toBe(true);
		}
		expect(liveWait(-5, 0)).toBe(1000);
		expect(liveWait(0, 0)).toBe(LIVE_TIMING.firstWaitMs);
		expect(liveWait(99, 0)).toBe(LIVE_TIMING.longestWaitMs);
	});
});

describe("the address", () => {
	it("is the app's own host, the route of the record, and nothing more", () => {
		expect(liveUrl("team@example.com", { protocol: "https:", host: "mail.example.com" })).toBe(
			"wss://mail.example.com/api/v1/mailboxes/team%40example.com/live",
		);
		expect(liveUrl("a/b?c#d", { protocol: "http:", host: "localhost:5173" })).toBe(
			"ws://localhost:5173/api/v1/mailboxes/a%2Fb%3Fc%23d/live",
		);
		// Never a token, a key or anything else in the address.
		expect(new URL(liveUrl("x@example.com", { protocol: "https:", host: "h.test" })).search).toBe(
			"",
		);
	});

	it("is reached under a content policy that names no host and no WebSocket scheme", () => {
		expect(PAGE_CONTENT_POLICY).toContain("connect-src 'self';");
		expect(PAGE_CONTENT_POLICY).not.toMatch(/\bwss?:/);
	});
});

// ── The app's end of the connection ────────────────────────────────

/** A socket as the browser gives one, driven by the test. */
class FakeSocket implements LiveSocket {
	readonly sent: string[] = [];
	closedWith: number | null = null;
	#message: ((event: { data: unknown }) => void)[] = [];
	#close: ((event: { reason?: string }) => void)[] = [];

	constructor(readonly url: string) {}

	send(text: string): void {
		this.sent.push(text);
	}
	close(code?: number): void {
		this.closedWith = code ?? 1005;
	}
	addEventListener(type: "message" | "close", listener: never): void {
		if (type === "message") this.#message.push(listener);
		else this.#close.push(listener);
	}
	/** The object says something. */
	says(data: unknown): void {
		for (const listener of this.#message) listener({ data });
	}
	tells(next: LiveState): void {
		this.says(liveMessage(next));
	}
	/** The connection ends, by the object or by the network. */
	drops(reason = ""): void {
		for (const listener of this.#close) listener({ reason });
	}
}

function tab(options: { random?: number } = {}) {
	const sockets: FakeSocket[] = [];
	const moved: LiveKind[][] = [];
	const connected: boolean[] = [];
	const connection = new LiveConnection({
		url: "wss://app.test/api/v1/mailboxes/x/live",
		open: (url) => {
			const socket = new FakeSocket(url);
			sockets.push(socket);
			return socket;
		},
		onMoved: (kinds) => moved.push(kinds),
		onConnected: (is) => connected.push(is),
		random: () => options.random ?? 0,
	});
	return {
		connection,
		sockets,
		moved,
		connected,
		last: () => sockets.at(-1) as FakeSocket,
		isConnected: () => connected.at(-1) === true,
	};
}

describe("the app's connection", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-11-17T12:00:00Z"));
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("is one connection, and is one only when the mailbox has spoken", () => {
		const { connection, sockets, isConnected, moved } = tab();
		connection.start();
		connection.start();
		expect(sockets).toHaveLength(1);
		expect(isConnected()).toBe(false);
		sockets[0]?.tells(state(1, 5, 2, 0));
		expect(isConnected()).toBe(true);
		// The first message: a tab that held nothing learns at once that it may be behind.
		expect(moved).toEqual([[...LIVE_KINDS]]);
		// It says nothing by itself.
		expect(sockets[0]?.sent).toEqual([]);
	});

	it("refetches at once for the first message and then at most once a second", () => {
		const { connection, last, moved } = tab();
		connection.start();
		last().tells(state(0, 0, 0, 0));
		expect(moved).toHaveLength(1);

		vi.advanceTimersByTime(5000);
		last().tells(state(0, 1, 0, 0));
		// At once: nothing was told for longer than a second.
		expect(moved).toHaveLength(2);
		expect(moved[1]).toEqual(["mail"]);

		// A burst: forty messages in four hundred milliseconds are one refetch, a second on.
		for (let n = 2; n <= 41; n++) {
			vi.advanceTimersByTime(10);
			last().tells(state(n % 3 === 0 ? 1 : 0, n, 0, 0));
		}
		expect(moved).toHaveLength(2);
		vi.advanceTimersByTime(599);
		expect(moved).toHaveLength(2);
		vi.advanceTimersByTime(1);
		expect(moved).toHaveLength(3);
		// Everything that moved in the burst, each kind once.
		expect([...(moved[2] ?? [])].sort()).toEqual(["delivery", "mail"]);

		// While messages keep coming for five seconds: one refetch a second, never more.
		const before = moved.length;
		for (let n = 0; n < 50; n++) {
			vi.advanceTimersByTime(100);
			last().tells(state(1, 100 + n, 0, 0));
		}
		vi.advanceTimersByTime(1000);
		expect(moved.length - before).toBeGreaterThanOrEqual(5);
		expect(moved.length - before).toBeLessThanOrEqual(6);
	});

	it("does not refetch for a state it has seen", () => {
		const { connection, last, moved } = tab();
		connection.start();
		last().tells(state(1, 1, 1, 1));
		vi.advanceTimersByTime(2000);
		last().tells(state(1, 1, 1, 1));
		vi.advanceTimersByTime(2000);
		expect(moved).toHaveLength(1);
	});

	it("falls back to asking when the version is one it does not know", () => {
		const { connection, sockets, isConnected, moved, connected } = tab();
		connection.start();
		sockets[0]?.says(JSON.stringify({ v: 2, type: "state", state: state(9, 9, 9, 9) }));
		// It did not take the message for a state, closed the connection and is not connected.
		expect(moved).toEqual([]);
		expect(sockets[0]?.closedWith).toBe(1000);
		expect(isConnected()).toBe(false);
		expect(connected).not.toContain(true);
		// And it does not come back: this tab's code cannot learn the version by waiting.
		sockets[0]?.drops();
		vi.advanceTimersByTime(60 * 60_000);
		expect(sockets).toHaveLength(1);
	});

	it("falls back in the same way after it was connected", () => {
		const { connection, sockets, isConnected } = tab();
		connection.start();
		sockets[0]?.tells(state());
		expect(isConnected()).toBe(true);
		sockets[0]?.says("not a message");
		expect(isConnected()).toBe(false);
		vi.advanceTimersByTime(60 * 60_000);
		expect(sockets).toHaveLength(1);
	});

	it("ignores a kind and a type it does not know, and stays connected", () => {
		const { connection, last, moved, isConnected, sockets } = tab();
		connection.start();
		last().tells(state(1, 1, 1, 1));
		vi.advanceTimersByTime(2000);
		last().says(JSON.stringify({ v: 1, type: "presence", who: ["someone"] }));
		last().says(
			JSON.stringify({ v: 1, type: "state", state: { ...state(1, 1, 1, 1), snoozed: "4" } }),
		);
		vi.advanceTimersByTime(2000);
		expect(moved).toHaveLength(1);
		expect(isConnected()).toBe(true);
		expect(sockets).toHaveLength(1);
		// A kind it knows, beside one it does not, still counts.
		last().says(
			JSON.stringify({ v: 1, type: "state", state: { ...state(1, 2, 1, 1), snoozed: "5" } }),
		);
		expect(moved.at(-1)).toEqual(["mail"]);
	});

	it("tries again after a second, then double, up to a minute, and starts over once a connection has held", () => {
		const { connection, sockets, last, isConnected } = tab();
		connection.start();
		const waits = [1000, 2000, 4000, 8000, 16_000, 32_000, 60_000, 60_000];
		for (const [n, wait] of waits.entries()) {
			last().drops();
			vi.advanceTimersByTime(wait - 1);
			expect(sockets, `before attempt ${n + 2}`).toHaveLength(n + 1);
			vi.advanceTimersByTime(1);
			expect(sockets, `attempt ${n + 2}`).toHaveLength(n + 2);
		}
		// A connection that opens and drops at once has not held: the wait stays long.
		last().tells(state());
		expect(isConnected()).toBe(true);
		last().drops();
		expect(isConnected()).toBe(false);
		vi.advanceTimersByTime(59_999);
		const before = sockets.length;
		vi.advanceTimersByTime(1);
		expect(sockets).toHaveLength(before + 1);

		// One that held for ten seconds has: the next wait is a second again.
		last().tells(state());
		vi.advanceTimersByTime(LIVE_TIMING.heldAfterMs);
		last().drops();
		vi.advanceTimersByTime(999);
		expect(sockets).toHaveLength(before + 1);
		vi.advanceTimersByTime(1);
		expect(sockets).toHaveLength(before + 2);
	});

	it("waits by a random part less", () => {
		const { connection, sockets, last } = tab({ random: 1 });
		connection.start();
		last().drops();
		vi.advanceTimersByTime(499);
		expect(sockets).toHaveLength(1);
		vi.advanceTimersByTime(1);
		expect(sockets).toHaveLength(2);
	});

	it("does not hurry back when it was closed to make room for a ninth tab", () => {
		const { connection, sockets, last } = tab();
		connection.start();
		last().tells(state());
		vi.advanceTimersByTime(30_000);
		last().drops(LIVE_CLOSED.limit);
		vi.advanceTimersByTime(59_999);
		expect(sockets).toHaveLength(1);
		vi.advanceTimersByTime(1);
		expect(sockets).toHaveLength(2);
	});

	it("keeps what it held while it was away, and refetches only what moved meanwhile", () => {
		const { connection, last, moved } = tab();
		connection.start();
		last().tells(state(1, 1, 1, 1));
		vi.advanceTimersByTime(20_000);
		last().drops();
		vi.advanceTimersByTime(1000);
		last().tells(state(1, 1, 1, 1));
		expect(moved).toHaveLength(1);
		last().drops();
		vi.advanceTimersByTime(60_000);
		last().tells(state(1, 1, 2, 1));
		expect(moved.at(-1)).toEqual(["labels"]);
	});

	it("says `ping` once a minute and nothing else", () => {
		const { connection, last } = tab();
		connection.start();
		last().tells(state());
		const socket = last();
		for (let minute = 1; minute <= 3; minute++) {
			vi.advanceTimersByTime(LIVE_LIMITS.pingEveryMs);
			expect(socket.sent).toHaveLength(minute);
			socket.says(LIVE_PONG);
		}
		expect(new Set(socket.sent)).toEqual(new Set(["ping"]));
	});

	it("takes a connection that does not answer within ten seconds for gone", () => {
		const { connection, sockets, isConnected } = tab();
		connection.start();
		sockets[0]?.tells(state());
		vi.advanceTimersByTime(LIVE_LIMITS.pingEveryMs);
		expect(sockets[0]?.sent).toEqual(["ping"]);
		vi.advanceTimersByTime(LIVE_LIMITS.pongWithinMs - 1);
		expect(isConnected()).toBe(true);
		vi.advanceTimersByTime(1);
		expect(isConnected()).toBe(false);
		expect(sockets[0]?.closedWith).toBe(1000);
		// It held for more than ten seconds, so it comes back after a second.
		vi.advanceTimersByTime(1000);
		expect(sockets).toHaveLength(2);
	});

	it("an answer in time keeps it", () => {
		const { connection, sockets, isConnected } = tab();
		connection.start();
		sockets[0]?.tells(state());
		vi.advanceTimersByTime(LIVE_LIMITS.pingEveryMs + LIVE_LIMITS.pongWithinMs - 1);
		sockets[0]?.says(LIVE_PONG);
		vi.advanceTimersByTime(30_000);
		expect(isConnected()).toBe(true);
		expect(sockets).toHaveLength(1);
	});

	it("opens a new connection after about four minutes and closes the old one once the new one has spoken", () => {
		const { connection, sockets, isConnected, moved, connected } = tab();
		connection.start();
		const first = sockets[0] as FakeSocket;
		first.tells(state(1, 1, 1, 1));
		const answering = setInterval(() => first.says(LIVE_PONG), 1000);
		vi.advanceTimersByTime(LIVE_LIMITS.renewAfterMs - 1);
		expect(sockets).toHaveLength(1);
		vi.advanceTimersByTime(1);
		expect(sockets).toHaveLength(2);
		// Before the object would close it, and with the old one still telling.
		expect(LIVE_LIMITS.renewAfterMs).toBeLessThan(LIVE_LIMITS.goodForMs);
		expect(first.closedWith).toBeNull();
		first.tells(state(1, 2, 1, 1));
		expect(moved.at(-1)).toEqual(["mail"]);

		const second = sockets[1] as FakeSocket;
		second.tells(state(1, 2, 1, 1));
		clearInterval(answering);
		expect(first.closedWith).toBe(1000);
		// The person saw nothing of it: never a moment without a connection, no refetch.
		expect(connected.filter((is) => !is)).toEqual([]);
		expect(isConnected()).toBe(true);
		expect(moved).toHaveLength(2);
		// The old one closing afterwards changes nothing.
		first.drops();
		expect(isConnected()).toBe(true);
		vi.advanceTimersByTime(5000);
		expect(sockets).toHaveLength(2);
		// The new one is the one that is pinged now.
		vi.advanceTimersByTime(LIVE_LIMITS.pingEveryMs);
		expect(second.sent).toEqual(["ping"]);
		expect(first.sent.every((text) => text === "ping")).toBe(true);
	});

	it("comes back a little before four minutes when chance says so, never later", () => {
		const { connection, sockets } = tab({ random: 1 });
		connection.start();
		const first = sockets[0] as FakeSocket;
		first.tells(state());
		const answering = setInterval(() => first.says(LIVE_PONG), 1000);
		vi.advanceTimersByTime(LIVE_LIMITS.renewAfterMs * 0.9 - 1);
		expect(sockets).toHaveLength(1);
		vi.advanceTimersByTime(1);
		expect(sockets).toHaveLength(2);
		clearInterval(answering);
	});

	it("a new connection that fails leaves the old one telling, and is tried again", () => {
		const { connection, sockets, isConnected } = tab();
		connection.start();
		const first = sockets[0] as FakeSocket;
		first.tells(state());
		const answering = setInterval(() => first.says(LIVE_PONG), 1000);
		vi.advanceTimersByTime(LIVE_LIMITS.renewAfterMs);
		expect(sockets).toHaveLength(2);
		sockets[1]?.drops();
		expect(isConnected()).toBe(true);
		expect(first.closedWith).toBeNull();
		vi.advanceTimersByTime(1000);
		expect(sockets).toHaveLength(3);
		// The object closes the old one at five minutes; the app is then without, and tries.
		sockets[2]?.drops();
		first.drops(LIVE_CLOSED.expired);
		clearInterval(answering);
		expect(isConnected()).toBe(false);
		vi.advanceTimersByTime(2000);
		expect(sockets.length).toBeGreaterThanOrEqual(4);
	});

	it("stopped, it closes what it has, tries nothing more and refetches nothing", () => {
		const { connection, sockets, isConnected, moved } = tab();
		connection.start();
		sockets[0]?.tells(state());
		vi.advanceTimersByTime(900);
		sockets[0]?.tells(state(0, 1, 0, 0));
		connection.stop();
		expect(sockets[0]?.closedWith).toBe(1000);
		expect(isConnected()).toBe(false);
		sockets[0]?.drops();
		sockets[0]?.tells(state(0, 2, 0, 0));
		vi.advanceTimersByTime(60 * 60_000);
		expect(sockets).toHaveLength(1);
		expect(moved).toHaveLength(1);
	});

	it("a socket that cannot even be made is a failed attempt like any other", () => {
		let made = 0;
		const connection = new LiveConnection({
			url: "wss://app.test/live",
			open: () => {
				made += 1;
				throw new Error("refused");
			},
			onMoved: () => {},
			onConnected: () => {},
			random: () => 0,
		});
		connection.start();
		expect(made).toBe(1);
		vi.advanceTimersByTime(1000);
		expect(made).toBe(2);
		vi.advanceTimersByTime(2000);
		expect(made).toBe(3);
		connection.stop();
	});
});
