import { describe, expect, it } from "vitest";
import { mailboxAddressFor, routeInbound } from "../../workers/lib/inbound.ts";

describe("mailboxAddressFor", () => {
	it("lower-cases and trims", () => {
		expect(mailboxAddressFor("  Hello@Example.COM ")).toBe("hello@example.com");
	});

	it("removes a subaddress", () => {
		expect(mailboxAddressFor("hello+invoices@example.com")).toBe("hello@example.com");
	});

	it.each([
		"",
		"no-at-sign",
		"@example.com",
		"two@@example.com",
		"a@b@example.com",
		"hello@localhost",
		"hello@example..com",
		"../../secrets@example.com",
		"mailboxes/x@example.com",
		"he llo@example.com",
		"hello@exa mple.com",
		"hello\n@example.com",
		"+tag@example.com",
		`${"a".repeat(65)}@example.com`,
		`a@${"b".repeat(250)}.com`,
	])("rejects %j", (address) => {
		expect(mailboxAddressFor(address)).toBeNull();
	});
});

describe("routeInbound", () => {
	const exists = (known: string[]) => async (id: string) => known.includes(id);

	it("delivers to the mailbox of the envelope recipient", async () => {
		expect(await routeInbound("Hello@example.com", [], exists(["hello@example.com"]))).toEqual({
			deliver: true,
			mailboxId: "hello@example.com",
		});
	});

	it("rejects a recipient with no mailbox", async () => {
		expect(await routeInbound("nobody@example.com", [], exists(["hello@example.com"]))).toEqual({
			deliver: false,
			reason: "Unknown recipient",
		});
	});

	it("rejects a recipient outside the allow-list, even if a mailbox exists", async () => {
		const decision = await routeInbound(
			"other@example.com",
			["Hello@example.com"],
			exists(["hello@example.com", "other@example.com"]),
		);
		expect(decision).toEqual({ deliver: false, reason: "Unknown recipient" });
	});

	it("never looks up a malformed recipient", async () => {
		let looked = false;
		const decision = await routeInbound("../x@example.com", [], async () => {
			looked = true;
			return true;
		});
		expect(decision).toEqual({ deliver: false, reason: "Invalid recipient address" });
		expect(looked).toBe(false);
	});
});
