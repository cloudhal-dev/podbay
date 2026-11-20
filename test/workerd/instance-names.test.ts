// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * The Worker's entry exports the two Durable Object classes under the names `wrangler.jsonc`
 * gives them (ADR-0018, decision 3), wherever their code lives; and the mailbox object answers
 * through its binding.
 */
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import * as entry from "../../workers/app.ts";

describe("the Worker's entry", () => {
	it("exports MailboxDO and EmailAgent under those names", () => {
		expect(typeof entry.MailboxDO).toBe("function");
		expect(entry.MailboxDO.name).toBe("MailboxDO");
		expect(typeof entry.EmailAgent).toBe("function");
		expect(entry.EmailAgent.name).toBe("EmailAgent");
	});

	it("reaches the mailbox object by its binding", () => {
		const stub = env.MAILBOX.get(env.MAILBOX.idFromName("names@example.com"));
		expect(stub).toBeTruthy();
	});
});
