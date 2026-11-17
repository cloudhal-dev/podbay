/**
 * Keys for programs: what a key may do given its own access and its owner's membership, and the
 * shape of a token. The store and the endpoint are tested in test/workerd-agent/mcp.test.ts.
 */
import { describe, expect, it } from "vitest";
import { MCP_TOOLS } from "../../shared/mcp-tools.ts";
import { MAILBOX_ROLES } from "../../workers/auth/authorize.ts";
import { KEY_ACCESS, KEY_PREFIX, keyAllows, newKeyToken } from "../../workers/auth/keys.ts";

describe("keyAllows", () => {
	it("lets every key read, whatever its access and its owner's role", () => {
		for (const access of KEY_ACCESS) {
			for (const role of MAILBOX_ROLES) expect(keyAllows(access, role, "read")).toBe(true);
		}
	});

	it("lets a key change mail only when both the key and the membership allow it", () => {
		const allowed = KEY_ACCESS.flatMap((access) =>
			MAILBOX_ROLES.filter((role) => keyAllows(access, role, "write")).map(
				(role) => `${access}:${role}`,
			),
		);
		expect(allowed.sort()).toEqual(["write:owner", "write:sender"]);
	});
});

describe("newKeyToken", () => {
	it("is a prefixed, URL-safe value with 256 bits from the system's random source", () => {
		const token = newKeyToken();
		expect(token.startsWith(KEY_PREFIX)).toBe(true);
		expect(token.slice(KEY_PREFIX.length)).toMatch(/^[A-Za-z0-9_-]{43}$/);
	});

	it("never repeats", () => {
		expect(new Set(Array.from({ length: 200 }, newKeyToken)).size).toBe(200);
	});
});

describe("the MCP tool list", () => {
	it("has no tool that sends, forwards or deletes for good", () => {
		const names = MCP_TOOLS.map((tool) => tool.name);
		expect(names.filter((name) => /send|forward|delete|purge/.test(name))).toEqual([]);
		expect(new Set(names).size).toBe(names.length);
	});

	it("marks every tool that changes a mailbox, so a read-only key is refused there", () => {
		const reading = MCP_TOOLS.filter((tool) => !tool.changes).map((tool) => tool.name);
		expect(reading.sort()).toEqual(
			["get_email", "get_thread", "list_emails", "list_mailboxes", "search_emails"].sort(),
		);
	});
});
