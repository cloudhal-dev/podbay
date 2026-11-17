import { describe, expect, it } from "vitest";
import {
	BULK_LIMITS,
	BulkRequestSchema,
	changesSomething,
	isDeedId,
	labelsOf,
	namesSomething,
	newDeedId,
} from "../../shared/bulk.ts";

const LABEL = "lbl_000000000000000000000001";
const ok = (value: unknown) => BulkRequestSchema.safeParse(value).success;

describe("the request that acts on many conversations (ADR-0014, decision 30)", () => {
	it("takes ids or a filter with a change from the closed set", () => {
		expect(ok({ ids: ["a"], change: { move: "archive" } })).toBe(true);
		expect(ok({ ids: ["a"], unit: "message", change: { read: true, starred: false } })).toBe(true);
		expect(
			ok({
				filter: { folder: "inbox", query: "invoice", is_read: false },
				change: { labels: { add: [LABEL] }, move: "archive" },
			}),
		).toBe(true);
	});

	it.each([
		["Sent as a target", { ids: ["a"], change: { move: "sent" } }],
		["Drafts as a target", { ids: ["a"], change: { move: "draft" } }],
		["deleting for good", { ids: ["a"], change: { delete: true } }],
		["sending", { ids: ["a"], change: { send: true } }],
		["a unit that is not one", { ids: ["a"], unit: "thread", change: { read: true } }],
		["a field no search has", { filter: { body: "x" }, change: { read: true } }],
		["no ids", { ids: [], change: { read: true } }],
		["an id that is empty", { ids: [""], change: { read: true } }],
		["no change", { ids: ["a"] }],
	])("refuses %s", (_what, request) => {
		expect(ok(request)).toBe(false);
	});

	it("holds every limit", () => {
		const ids = (count: number) => Array.from({ length: count }, (_value, n) => `m-${n}`);
		const labels = (count: number) =>
			Array.from({ length: count }, (_value, n) => `lbl_${String(n).padStart(24, "0")}`);
		expect(ok({ ids: ids(BULK_LIMITS.ids), change: { read: true } })).toBe(true);
		expect(ok({ ids: ids(BULK_LIMITS.ids + 1), change: { read: true } })).toBe(false);
		expect(ok({ ids: ["x".repeat(BULK_LIMITS.idLength)], change: { read: true } })).toBe(true);
		expect(ok({ ids: ["x".repeat(BULK_LIMITS.idLength + 1)], change: { read: true } })).toBe(false);
		expect(ok({ ids: ["a"], change: { labels: { add: labels(BULK_LIMITS.labels) } } })).toBe(true);
		expect(ok({ ids: ["a"], change: { labels: { add: labels(6), remove: labels(5) } } })).toBe(
			false,
		);
		const long = "x".repeat(BULK_LIMITS.text + 1);
		for (const field of ["folder", "query", "from", "to", "subject", "date_start", "date_end"]) {
			expect(ok({ filter: { [field]: long.slice(1) }, change: { read: true } }), field).toBe(true);
			expect(ok({ filter: { [field]: long }, change: { read: true } }), field).toBe(false);
		}
	});

	it("knows a filter that names nothing, and a change that changes nothing", () => {
		expect(namesSomething({})).toBe(false);
		expect(namesSomething({ query: "", folder: "" })).toBe(false);
		expect(namesSomething({ has_attachment: false })).toBe(false);
		expect(namesSomething({ folder: "inbox" })).toBe(true);
		expect(namesSomething({ is_read: false })).toBe(true);
		expect(namesSomething({ label: LABEL })).toBe(true);

		expect(changesSomething({})).toBe(false);
		expect(changesSomething({ labels: { add: [], remove: [] } })).toBe(false);
		expect(changesSomething({ read: false })).toBe(true);
		expect(labelsOf({ labels: { add: [LABEL, LABEL] } })).toEqual({ add: [LABEL], remove: [] });
	});

	it("makes opaque ids for deeds", () => {
		const id = newDeedId();
		expect(isDeedId(id)).toBe(true);
		expect(newDeedId()).not.toBe(id);
		for (const not of ["", "deed_", "deed_xyz", `${id}0`, id.toUpperCase(), 7, null]) {
			expect(isDeedId(not), String(not)).toBe(false);
		}
	});
});
