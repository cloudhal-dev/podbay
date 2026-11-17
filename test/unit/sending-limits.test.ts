import { describe, expect, it } from "vitest";
import {
	MAX_ATTACHMENTS_BYTES,
	MAX_MESSAGE_BYTES,
	MAX_RECIPIENTS,
	messageBytes,
} from "../../shared/sending-limits.ts";
import { SendEmailRequestSchema } from "../../workers/lib/schemas.ts";

const message = (extra: Record<string, unknown> = {}) => ({
	to: "someone@elsewhere.test",
	from: "me@example.com",
	subject: "S",
	text: "T",
	...extra,
});
describe("what a message being sent may hold", () => {
	it("leaves room under the service's limit once the files are base64", () => {
		expect((MAX_ATTACHMENTS_BYTES * 4) / 3).toBeLessThan(MAX_MESSAGE_BYTES);
	});

	it("weighs the text of a message, so text alone cannot pass what the service takes", () => {
		expect(messageBytes({ html: "ab", text: "ş" })).toBe(4);
		const room = MAX_MESSAGE_BYTES - messageBytes(message());
		expect(SendEmailRequestSchema.safeParse(message({ html: "h".repeat(room) })).success).toBe(
			true,
		);
		expect(SendEmailRequestSchema.safeParse(message({ html: "h".repeat(room + 1) })).success).toBe(
			false,
		);
	});

	it("carries no files itself: a message with files names its draft", () => {
		const parsed = SendEmailRequestSchema.parse(
			message({ draft_id: "d-1", attachments: [{ content: "AAAA", filename: "a.bin" }] }),
		);
		expect(parsed.draft_id).toBe("d-1");
		expect("attachments" in parsed).toBe(false);
	});

	it("takes the service's number of recipients across To, Cc and Bcc, and refuses one more", () => {
		const people = (count: number) =>
			Array.from({ length: count }, (_v, n) => `p${n}@elsewhere.test`);
		const full = message({
			to: people(MAX_RECIPIENTS - 2),
			cc: "c@elsewhere.test",
			bcc: ["b@elsewhere.test"],
		});
		expect(SendEmailRequestSchema.safeParse(full).success).toBe(true);
		const over = message({
			to: people(MAX_RECIPIENTS - 1),
			cc: "c@elsewhere.test",
			bcc: ["b@elsewhere.test"],
		});
		expect(SendEmailRequestSchema.safeParse(over).success).toBe(false);
	});
});
