import { describe, expect, it } from "vitest";
import {
	base64Bytes,
	MAX_ATTACHMENTS_BYTES,
	MAX_MESSAGE_BYTES,
	MAX_RECIPIENTS,
} from "../../shared/sending-limits.ts";
import { SendEmailRequestSchema } from "../../workers/lib/schemas.ts";

const message = (extra: Record<string, unknown> = {}) => ({
	to: "someone@elsewhere.test",
	from: "me@example.com",
	subject: "S",
	text: "T",
	...extra,
});
const file = (bytes: number) => ({
	content: Buffer.alloc(bytes, 1).toString("base64"),
	filename: "a.bin",
	type: "application/octet-stream",
	disposition: "attachment" as const,
});

describe("what a message being sent may hold", () => {
	it("counts what a base64 string holds without decoding it", () => {
		for (const size of [0, 1, 2, 3, 4, 5, 1000, 1001, 1002]) {
			expect(base64Bytes(Buffer.alloc(size, 7).toString("base64")), `${size}`).toBe(size);
		}
	});

	it("leaves room under the service's limit once the files are base64", () => {
		expect((MAX_ATTACHMENTS_BYTES * 4) / 3).toBeLessThan(MAX_MESSAGE_BYTES);
	});

	it("takes files up to the limit together, and refuses one byte more", () => {
		const half = MAX_ATTACHMENTS_BYTES / 2;
		expect(
			SendEmailRequestSchema.safeParse(message({ attachments: [file(half), file(half)] })).success,
		).toBe(true);
		const over = SendEmailRequestSchema.safeParse(
			message({ attachments: [file(half), file(half + 1)] }),
		);
		expect(over.success).toBe(false);
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
