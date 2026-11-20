import { describe, expect, it } from "vitest";
import {
	SenderValidationError,
	validateSender,
} from "../../modules/mail/worker/lib/email-helpers.ts";

describe("validateSender", () => {
	it("accepts the mailbox's own address, case-insensitively", () => {
		expect(validateSender("ada@sender.test", "Hello@Example.com", "hello@example.com")).toEqual({
			toStr: "ada@sender.test",
			fromEmail: "hello@example.com",
			fromDomain: "example.com",
		});
	});

	it("accepts the named form", () => {
		const from = { email: "hello@example.com", name: "Hello" };
		expect(validateSender(["a@x.test", "B@x.test"], from, "hello@example.com").toStr).toBe(
			"a@x.test, b@x.test",
		);
	});

	it("refuses to send as another address", () => {
		expect(() => validateSender("ada@sender.test", "ceo@example.com", "hello@example.com")).toThrow(
			SenderValidationError,
		);
	});

	it("refuses another domain that shares the local part", () => {
		expect(() => validateSender("ada@sender.test", "hello@evil.test", "hello@example.com")).toThrow(
			SenderValidationError,
		);
	});
});
