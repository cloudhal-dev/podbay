import { describe, expect, it } from "vitest";
import { unsubscribeOf } from "../../app/lib/unsubscribe.ts";

const headers = (value: string) => JSON.stringify([{ key: "list-unsubscribe", value }]);

describe("how to leave a mailing list", () => {
	it("takes a page over a message, whichever comes first", () => {
		const both = headers("<mailto:leave@lists.test?subject=stop>, <https://lists.test/leave?u=1>");
		expect(unsubscribeOf(both)).toEqual({
			kind: "web",
			url: "https://lists.test/leave?u=1",
			host: "lists.test",
		});
	});

	it("falls back to a message, with the subject the list asks for or a plain one", () => {
		expect(unsubscribeOf(headers("<mailto:leave@lists.test?subject=stop%20it>"))).toEqual({
			kind: "mail",
			address: "leave@lists.test",
			subject: "stop it",
		});
		expect(unsubscribeOf(headers("<mailto:leave@lists.test>"))).toMatchObject({
			subject: "unsubscribe",
		});
	});

	it("reads the header whatever its case and whichever shape the headers are stored in", () => {
		const object = JSON.stringify({ "List-Unsubscribe": "<https://lists.test/leave>" });
		expect(unsubscribeOf(object)).toMatchObject({ kind: "web", host: "lists.test" });
		const named = JSON.stringify([{ name: "List-Unsubscribe", value: "<https://lists.test/x>" }]);
		expect(unsubscribeOf(named)).toMatchObject({ kind: "web" });
	});

	it.each([
		["no headers", null],
		["headers that are not JSON", "{not json"],
		["no such header", JSON.stringify([{ key: "subject", value: "Hi" }])],
		["a plain http page", headers("<http://lists.test/leave>")],
		["a script address", headers("<javascript:alert(1)>")],
		["a data address", headers("<data:text/html,<script>alert(1)</script>>")],
		["a page with credentials in its address", headers("<https://user:pass@lists.test/leave>")],
		["a message to something that is not an address", headers("<mailto:not-an-address>")],
		["a message to several addresses", headers("<mailto:a@x.test,b@y.test>")],
		["an address without brackets", headers("https://lists.test/leave")],
		["a value that is not text", JSON.stringify([{ key: "list-unsubscribe", value: 7 }])],
		["a header that goes on for ever", headers(`<https://lists.test/${"a".repeat(3000)}>`)],
	])("offers nothing for %s", (_name, raw) => {
		expect(unsubscribeOf(raw)).toBeNull();
	});

	it("does not let a subject carry a second header line", () => {
		const raw = headers("<mailto:leave@lists.test?subject=stop%0D%0ABcc%3A%20evil%40x.test>");
		const found = unsubscribeOf(raw);
		expect(found).toMatchObject({ kind: "mail", address: "leave@lists.test" });
		expect(found && "subject" in found ? found.subject : "").not.toMatch(/[\r\n]/);
	});
});
