// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Tier 0: a request's body is read with a limit, and a body over the limit is refused without
 * being read to its end (the rules routes and a person's choices; ADR-0008).
 */
import { describe, expect, it } from "vitest";
import { bodyWithin } from "../../workers/lib/body.ts";

const KIB = 1024;

/** A body without a declared length that never ends, and how many chunks were taken from it. */
function endless(chunk = 64 * KIB) {
	const taken = { chunks: 0 };
	const stream = new ReadableStream<Uint8Array>({
		pull(controller) {
			taken.chunks += 1;
			controller.enqueue(new Uint8Array(chunk).fill(0x20));
		},
	});
	const request = new Request("https://podbay.test/", {
		method: "POST",
		body: stream,
		duplex: "half",
	} as RequestInit);
	return { request, taken };
}

describe("a body read with a limit", () => {
	it("stops at the limit when the body never ends, and says it is too large", async () => {
		const { request, taken } = endless();
		expect(await bodyWithin(request, 256 * KIB)).toBeNull();
		// Five chunks of 64 KiB pass 256 KiB; a reader that read to the end would never return.
		expect(taken.chunks).toBeLessThanOrEqual(6);
	});

	it("reads nothing when the declared length is over the limit", async () => {
		const request = new Request("https://podbay.test/", {
			method: "POST",
			headers: { "content-length": String(256 * KIB + 1) },
			body: "x",
		});
		expect(await bodyWithin(request, 256 * KIB)).toBeNull();
		expect(request.bodyUsed).toBe(false);
	});

	it("gives a body at the limit as it is", async () => {
		const text = `{"rules":[]${" ".repeat(256 * KIB - 12)}}`;
		expect(new TextEncoder().encode(text).length).toBe(256 * KIB);
		const request = new Request("https://podbay.test/", { method: "POST", body: text });
		expect(await bodyWithin(request, 256 * KIB)).toBe(text);
	});
});
