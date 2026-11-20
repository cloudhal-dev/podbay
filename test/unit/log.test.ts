import { errorFields, logLine, redact } from "@podbay/platform/log";
import { describe, expect, it } from "vitest";

describe("redact", () => {
	it("masks every address", () => {
		expect(redact("mail for Ada <ada@sender.test> and hello+tag@example.co.uk")).toBe(
			"mail for Ada <<address>> and <address>",
		);
	});

	it("caps a long string", () => {
		const out = redact("x".repeat(2000));
		expect(out.length).toBeLessThanOrEqual(501);
		expect(out.endsWith("…")).toBe(true);
	});

	it("leaves ordinary text alone", () => {
		expect(redact("Mailbox not found")).toBe("Mailbox not found");
	});
});

describe("logLine", () => {
	it("writes one JSON object with level and event first", () => {
		const line = logLine("warn", "agent.autodraft_skipped_injection", {
			emailId: "e-1",
			attempts: 2,
		});
		expect(JSON.parse(line)).toEqual({
			level: "warn",
			event: "agent.autodraft_skipped_injection",
			emailId: "e-1",
			attempts: 2,
		});
		expect(Object.keys(JSON.parse(line)).slice(0, 2)).toEqual(["level", "event"]);
	});

	it("redacts string fields and drops undefined ones", () => {
		const parsed = JSON.parse(
			logLine("error", "send.failed", {
				message: "550 no such user bob@example.com",
				gone: undefined,
			}),
		);
		expect(parsed.message).toBe("550 no such user <address>");
		expect("gone" in parsed).toBe(false);
	});

	it("does not let a field overwrite the level or the event", () => {
		const parsed = JSON.parse(logLine("info", "real.event", { level: "error", event: "fake" }));
		expect(parsed).toEqual({ level: "info", event: "real.event" });
	});
});

describe("errorFields", () => {
	it("keeps the name and the message of an Error, redacted on output", () => {
		const fields = errorFields(new TypeError("cannot deliver to carol@example.org"));
		expect(fields).toEqual({ error: "TypeError", message: "cannot deliver to carol@example.org" });
		expect(logLine("error", "x", fields)).not.toContain("carol@example.org");
	});

	it("handles a thrown value that is not an Error", () => {
		expect(errorFields("boom")).toEqual({ error: "non-error", message: "boom" });
	});
});
