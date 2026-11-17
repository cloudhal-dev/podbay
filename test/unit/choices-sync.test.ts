// @vitest-environment jsdom
/**
 * Tier 0: the browser's copy of a person's choices and their account (ADR-0012, decisions 5 to
 * 8), with a document for the page and a stand-in for the Worker's two routes.
 *
 * - the copy draws the first paint, before anything is asked;
 * - the account wins for the choices that travel; the device keeps its own;
 * - a change applies at once and is sent with only the keys that changed;
 * - a change that could not be sent stays in force, and goes at the next contact;
 * - someone else's copy is replaced; the first browser brings its choices along, once.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const KEY = "podbay.display";

interface Sent {
	method: string;
	body: Record<string, unknown> | null;
}

/** The Worker's two routes, as far as the app sees them. */
function account(start: { document?: Record<string, unknown>; rev?: number } = {}) {
	const state = {
		document: { v: 1, ...start.document } as Record<string, unknown>,
		rev: start.rev ?? (start.document ? 1 : 0),
		offline: false,
		/** While set, an answer to a reading is made at once and handed over only when it ends. */
		slow: null as Promise<void> | null,
		requests: [] as Sent[],
	};
	const answer = () =>
		new Response(JSON.stringify({ choices: state.document, rev: state.rev }), {
			headers: { "content-type": "application/json" },
		});
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init?: RequestInit) => {
			expect(url).toBe("/api/v1/me/choices");
			if (state.offline) throw new TypeError("Failed to fetch");
			const method = init?.method ?? "GET";
			const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
			state.requests.push({ method, body });
			if (method === "PUT" && body !== null) {
				for (const [key, value] of Object.entries(body)) {
					if (value === null) delete state.document[key];
					else state.document[key] = value;
				}
				state.rev += 1;
			}
			const made = answer();
			if (method === "GET" && state.slow !== null) await state.slow;
			return made;
		}),
	);
	return {
		state,
		puts: () => state.requests.filter((one) => one.method === "PUT").map((one) => one.body),
	};
}

/** The app's module as a page load gives it: read once from what the browser kept. */
async function load(copy?: Record<string, unknown>) {
	vi.resetModules();
	if (copy !== undefined) window.localStorage.setItem(KEY, JSON.stringify(copy));
	return import("../../app/hooks/useDisplay.ts");
}

const kept = () => JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as Record<string, unknown>;
const mode = () => document.documentElement.getAttribute("data-mode");

beforeEach(() => {
	window.localStorage.clear();
	document.documentElement.removeAttribute("data-mode");
	document.documentElement.lang = "";
	// The page's device prefers light, and never changes its mind.
	vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => {} }));
	window.matchMedia = globalThis.matchMedia;
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("the first paint", () => {
	it("is drawn from the browser's copy, in its language and appearance, before anything is asked", async () => {
		const server = account({ document: { language: "en", appearance: "light" } });
		const { useDisplay } = await load({ language: "tr", appearance: "dark", owner: "u1" });
		expect(document.documentElement.lang).toBe("tr");
		expect(mode()).toBe("dark");
		expect(useDisplay.getState()).toMatchObject({ language: "tr", appearance: "dark" });
		expect(server.state.requests).toEqual([]);
	});

	it("is the defaults in a browser that kept nothing, or something unreadable", async () => {
		account();
		const { useDisplay, DEFAULT_CHOICES } = await load();
		expect(useDisplay.getState()).toMatchObject(DEFAULT_CHOICES);
		expect(mode()).toBe("light");
		window.localStorage.setItem(KEY, "{not json");
		const again = await load();
		expect(again.useDisplay.getState()).toMatchObject(DEFAULT_CHOICES);
	});
});

describe("the account wins for what travels", () => {
	it("replaces the travelling choices with the account's, and leaves the device its own", async () => {
		const server = account({ document: { pageSize: 10, appearance: "dark" }, rev: 3 });
		const { useDisplay, syncChoices } = await load({
			owner: "u1",
			pageSize: 100,
			snippets: false,
			density: "compact",
			readingPane: "right",
			notifications: true,
		});
		expect(useDisplay.getState().pageSize).toBe(100);
		await syncChoices("u1");
		expect(useDisplay.getState()).toMatchObject({
			// The account's; what it does not hold is the default again.
			pageSize: 10,
			appearance: "dark",
			snippets: true,
			// The device's.
			density: "compact",
			readingPane: "right",
			notifications: true,
		});
		expect(mode()).toBe("dark");
		// Nothing was sent: the account already had its say.
		expect(server.puts()).toEqual([]);
		// The copy is the cache for the next first paint.
		expect(kept()).toMatchObject({ owner: "u1", pageSize: 10, appearance: "dark", unsent: [] });
	});

	it("keeps the copy when the account cannot be asked", async () => {
		const server = account({ document: { pageSize: 10 } });
		server.state.offline = true;
		const { useDisplay, syncChoices } = await load({ owner: "u1", pageSize: 100 });
		await syncChoices("u1");
		expect(useDisplay.getState().pageSize).toBe(100);
	});
});

describe("a change", () => {
	it("applies at once and is sent with only the keys that changed; a default is null", async () => {
		const server = account({ document: { language: "tr" } });
		const { useDisplay, syncChoices } = await load({ owner: "u1", language: "tr" });
		await syncChoices("u1");

		useDisplay.getState().choose({ pageSize: 50 });
		expect(useDisplay.getState().pageSize).toBe(50);
		await vi.waitFor(() => expect(server.puts()).toEqual([{ pageSize: 50 }]));

		useDisplay.getState().choose({ pageSize: 25, appearance: "dark" });
		expect(mode()).toBe("dark");
		await vi.waitFor(() =>
			expect(server.puts()[1]).toEqual({ pageSize: null, appearance: "dark" }),
		);
		expect(server.state.document).toEqual({ v: 1, language: "tr", appearance: "dark" });
		await vi.waitFor(() => expect(kept().unsent).toEqual([]));
	});

	it("of a choice that stays with the device is never sent", async () => {
		const server = account();
		const { useDisplay, syncChoices } = await load({ owner: "u1" });
		await syncChoices("u1");
		const state = useDisplay.getState();
		state.setDensity("compact");
		state.setReadingPane("below");
		state.choose({ notifications: true });
		await syncChoices("u1");
		expect(useDisplay.getState()).toMatchObject({
			density: "compact",
			readingPane: "below",
			notifications: true,
		});
		expect(server.puts()).toEqual([]);
		expect(server.state.document).toEqual({ v: 1 });
	});

	it("that could not be sent stays in force, is remembered, and goes at the next contact", async () => {
		const server = account({ document: { pageSize: 10 } });
		const first = await load({ owner: "u1", pageSize: 10 });
		await first.syncChoices("u1");

		server.state.offline = true;
		first.useDisplay.getState().choose({ snippets: false });
		await vi.waitFor(() => expect(kept().unsent).toEqual(["snippets"]));
		expect(first.useDisplay.getState().snippets).toBe(false);
		expect(server.state.document).toEqual({ v: 1, pageSize: 10 });

		// The page is loaded again later; meanwhile another device changed another choice.
		server.state.offline = false;
		server.state.document.pageSize = 100;
		const later = await load();
		expect(later.useDisplay.getState()).toMatchObject({ snippets: false, pageSize: 10 });
		await later.syncChoices("u1");
		expect(server.puts()).toEqual([{ snippets: false }]);
		expect(server.state.document).toEqual({ v: 1, pageSize: 100, snippets: false });
		// Both hold: the one made here and the one made elsewhere.
		expect(later.useDisplay.getState()).toMatchObject({ snippets: false, pageSize: 100 });
		expect(kept().unsent).toEqual([]);
	});
});

describe("an answer that is older than what is on screen", () => {
	it("is not laid over a change that the account took meanwhile", async () => {
		const server = account({ document: { pageSize: 10 } });
		const { useDisplay, syncChoices } = await load({ owner: "u1", pageSize: 10 });
		await syncChoices("u1");

		// A reading is on its way, and slow; the person changes a choice before it is back.
		let arrive = () => {};
		server.state.slow = new Promise<void>((resolve) => {
			arrive = resolve;
		});
		const reading = syncChoices("u1");
		await vi.waitFor(() =>
			expect(server.state.requests.filter((one) => one.method === "GET")).toHaveLength(2),
		);
		useDisplay.getState().choose({ pageSize: 50 });
		await vi.waitFor(() => expect(server.puts()).toEqual([{ pageSize: 50 }]));
		await vi.waitFor(() => expect(kept().unsent).toEqual([]));

		arrive();
		await reading;
		expect(useDisplay.getState().pageSize).toBe(50);
		expect(server.state.document).toEqual({ v: 1, pageSize: 50 });
	});
});

describe("whose the copy is", () => {
	it("replaces the travelling part when someone else signs in on the same browser", async () => {
		const server = account({ document: { language: "tr" } });
		const { useDisplay, syncChoices } = await load({
			owner: "u1",
			pageSize: 100,
			sendAndArchive: true,
			unsent: ["sendAndArchive"],
			density: "compact",
		});
		const reading = syncChoices("u2");
		// At once, before the account answers: nothing of the first person is left in force.
		expect(useDisplay.getState()).toMatchObject({ pageSize: 25, sendAndArchive: false });
		await reading;
		expect(useDisplay.getState()).toMatchObject({
			pageSize: 25,
			sendAndArchive: false,
			language: "tr",
			density: "compact",
		});
		// What the first person had not sent is not sent as the second.
		expect(server.puts()).toEqual([]);
		expect(kept()).toMatchObject({ owner: "u2", unsent: [] });
	});

	it("brings the first browser's choices along when the account has none, once", async () => {
		const server = account();
		// A copy from before choices were kept with the account: it names nobody.
		const { useDisplay, syncChoices } = await load({
			pageSize: 50,
			afterFiling: "older",
			density: "compact",
			notifications: true,
		});
		await syncChoices("u1");
		expect(server.puts()).toEqual([{ pageSize: 50, afterFiling: "older" }]);
		expect(server.state.document).toEqual({ v: 1, pageSize: 50, afterFiling: "older" });
		expect(useDisplay.getState()).toMatchObject({ pageSize: 50, afterFiling: "older" });

		await syncChoices("u1");
		expect(server.puts()).toHaveLength(1);
	});

	it("sends nothing from a browser that has only the defaults: no row is made for nobody's choice", async () => {
		const server = account();
		const { syncChoices } = await load({ density: "compact" });
		await syncChoices("u1");
		expect(server.puts()).toEqual([]);
		expect(server.state.rev).toBe(0);
		expect(kept().owner).toBe("u1");
	});

	it("does not bring a copy along when the account already has a document: the account wins", async () => {
		const server = account({ document: { appearance: "dark" } });
		const { useDisplay, syncChoices } = await load({ pageSize: 50 });
		await syncChoices("u1");
		expect(server.puts()).toEqual([]);
		expect(useDisplay.getState()).toMatchObject({ pageSize: 25, appearance: "dark" });
	});
});
