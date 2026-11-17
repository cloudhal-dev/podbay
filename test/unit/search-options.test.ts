import { describe, expect, it } from "vitest";
import {
	buildSearchQuery,
	NO_SEARCH_OPTIONS,
	parseSearchQuery,
	searchOptionsOf,
} from "../../app/lib/search-parser.ts";

describe("search options", () => {
	it("writes nothing for no options", () => {
		expect(buildSearchQuery(NO_SEARCH_OPTIONS)).toBe("");
		expect(buildSearchQuery({ ...NO_SEARCH_OPTIONS, from: "  ", words: " \n " })).toBe("");
	});

	it("writes a query the parser reads back as the same search", () => {
		const options = {
			words: "quarterly  plan",
			from: "ada@example.com",
			to: "Grace Hopper",
			subject: "Re: the pod bay",
			folder: "inbox",
			label: "Clients/Acme Ltd",
			hasAttachment: true,
			unreadOnly: true,
			after: "2026-01-01",
			before: "2026-06-30",
		};
		const query = buildSearchQuery(options);
		expect(query).toBe(
			'from:ada@example.com to:"Grace Hopper" subject:"Re: the pod bay" in:inbox label:"Clients/Acme Ltd" has:attachment is:unread after:2026-01-01 before:2026-06-30 quarterly plan',
		);
		expect(parseSearchQuery(query)).toMatchObject({
			query: "quarterly plan",
			from: "ada@example.com",
			to: "Grace Hopper",
			subject: "Re: the pod bay",
			folder: "inbox",
			label: "Clients/Acme Ltd",
			has_attachment: true,
			is_read: false,
		});
		expect(searchOptionsOf(query)).toEqual({ ...options, words: "quarterly plan" });
	});

	it("cannot be made to close a quoted value early", () => {
		const query = buildSearchQuery({ ...NO_SEARCH_OPTIONS, subject: 'a" in:trash "b' });
		expect(query).toBe('subject:"a in:trash b"');
		expect(parseSearchQuery(query)).toMatchObject({ subject: "a in:trash b", query: "" });
		expect(parseSearchQuery(query).folder).toBeUndefined();
	});

	it("fills the dialog from what the search box says", () => {
		expect(searchOptionsOf("from:ada is:unread hello")).toEqual({
			...NO_SEARCH_OPTIONS,
			from: "ada",
			unreadOnly: true,
			words: "hello",
		});
	});
});
