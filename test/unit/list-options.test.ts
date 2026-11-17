import { describe, expect, it } from "vitest";
import { LIST_ORDERS } from "../../shared/list-order.ts";
import {
	conversationOrderSql,
	messageOrderSql,
	parseListOrder,
} from "../../workers/lib/list-options.ts";

describe("the order of a list (ADR-0014)", () => {
	it.each([...LIST_ORDERS])("takes %s", (order) => {
		expect(parseListOrder(order)).toBe(order);
	});

	it.each([
		undefined,
		"",
		"oldest",
		"NEWEST",
		"date",
		"starred; DROP TABLE emails",
		"unread DESC",
		"1=1",
		7,
	])("refuses %j", (value) => {
		expect(parseListOrder(value)).toBeUndefined();
	});

	it("is newest first unless it says otherwise, and newest first inside each group", () => {
		expect(messageOrderSql(undefined)).toBe("date DESC");
		expect(messageOrderSql("newest", "e.")).toBe("e.date DESC");
		expect(messageOrderSql("unread", "e.")).toBe("e.read ASC, e.date DESC");
		expect(messageOrderSql("starred")).toBe("starred DESC, date DESC");

		const columns = { unread: "cs.unread", starred: "cs.starred", date: "l.date" };
		expect(conversationOrderSql(undefined, columns)).toBe("l.date DESC");
		expect(conversationOrderSql("unread", columns)).toBe("(cs.unread > 0) DESC, l.date DESC");
		expect(conversationOrderSql("starred", columns)).toBe("(cs.starred > 0) DESC, l.date DESC");
	});
});
