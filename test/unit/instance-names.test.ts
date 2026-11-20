// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * What an instance depends on keeps its name (ADR-0018, decision 3): the Worker's name, its
 * bindings, the Durable Object classes and their migration tags. Moving code never touches
 * these; each is written out here, and the Worker's entry exporting the two classes under these
 * names is held in the Workers runtime (`test/workerd/instance-names.test.ts`).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** `wrangler.jsonc` without its comments, which are prose. */
const config = JSON.parse(
	readFileSync("wrangler.jsonc", "utf8")
		.replace(/^\s*\/\/.*$/gm, "")
		.replace(/,(\s*[}\]])/g, "$1"),
) as {
	name: string;
	send_email: { name: string }[];
	d1_databases: { binding: string; migrations_dir: string }[];
	r2_buckets: { binding: string }[];
	ai: { binding: string };
	durable_objects: { bindings: { name: string; class_name: string }[] };
	migrations: { tag: string; new_sqlite_classes?: string[] }[];
};

describe("the names an instance depends on", () => {
	it("are the Worker's, its bindings' and its classes', as they were", () => {
		expect(config.name).toBe("podbay");
		expect(config.send_email.map((one) => one.name)).toEqual(["EMAIL"]);
		expect(config.d1_databases.map((one) => [one.binding, one.migrations_dir])).toEqual([
			["DB", "migrations"],
		]);
		expect(config.r2_buckets.map((one) => one.binding)).toEqual(["BUCKET"]);
		expect(config.ai.binding).toBe("AI");
		expect(config.durable_objects.bindings.map((one) => [one.name, one.class_name])).toEqual([
			["MAILBOX", "MailboxDO"],
			["EMAIL_AGENT", "EmailAgent"],
		]);
		expect(config.migrations).toEqual([
			{ tag: "v1", new_sqlite_classes: ["MailboxDO"] },
			{ tag: "v2", new_sqlite_classes: ["EmailAgent"] },
		]);
	});
});
