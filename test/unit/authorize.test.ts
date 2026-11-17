import { describe, expect, it } from "vitest";
import {
	ACTIONS,
	type Action,
	type Actor,
	authorize,
	INSTANCE_ROLES,
	MAILBOX_ROLES,
} from "../../workers/auth/authorize.ts";
import { pathParam } from "../../workers/auth/middleware.ts";
import { ROUTE_TABLE, rightFor } from "../../workers/auth/route-table.ts";

const actor = (instanceRole: Actor["instanceRole"], mailboxRole: Actor["mailboxRole"]): Actor => ({
	userId: "u1",
	instanceRole,
	mailboxRole,
});
const MAILBOX_ACTIONS: Action[] = [
	"mailbox.read",
	"mailbox.write",
	"mailbox.send",
	"mailbox.manage",
];

describe("authorize", () => {
	it("managing is not reading: no instance role opens a mailbox without a membership", () => {
		for (const role of INSTANCE_ROLES) {
			for (const action of MAILBOX_ACTIONS) {
				expect(authorize(actor(role, null), action), `${role} ${action}`).toBe("not_found");
			}
		}
	});

	it("gives each membership exactly its rights", () => {
		const expected: Record<string, Action[]> = {
			owner: ["mailbox.read", "mailbox.write", "mailbox.send", "mailbox.manage"],
			sender: ["mailbox.read", "mailbox.write", "mailbox.send"],
			reader: ["mailbox.read"],
		};
		for (const role of MAILBOX_ROLES) {
			for (const action of MAILBOX_ACTIONS) {
				const want = expected[role]?.includes(action) ? "allow" : "forbidden";
				expect(authorize(actor("member", role), action), `${role} ${action}`).toBe(want);
			}
		}
	});

	it("a membership is not changed by the instance role", () => {
		expect(authorize(actor("owner", "reader"), "mailbox.send")).toBe("forbidden");
		expect(authorize(actor("admin", "reader"), "mailbox.manage")).toBe("forbidden");
	});

	it("lets owners and administrators manage the instance, and nobody else", () => {
		expect(authorize(actor("owner", null), "instance.manage")).toBe("allow");
		expect(authorize(actor("admin", null), "instance.manage")).toBe("allow");
		expect(authorize(actor("member", "owner"), "instance.manage")).toBe("forbidden");
	});

	it("allows the session right to anyone signed in", () => {
		for (const role of INSTANCE_ROLES)
			expect(authorize(actor(role, null), "session")).toBe("allow");
	});

	it("knows every action", () => {
		for (const action of ACTIONS) {
			expect(["allow", "forbidden", "not_found"]).toContain(
				authorize(actor("member", "reader"), action),
			);
		}
	});
});

describe("route table", () => {
	it("has no duplicate entry", () => {
		const keys = ROUTE_TABLE.map((r) => `${r.method} ${r.path}`);
		expect(new Set(keys).size).toBe(keys.length);
	});

	it("names a known right for every entry", () => {
		for (const route of ROUTE_TABLE) expect(["public", ...ACTIONS]).toContain(route.right);
	});

	it("keeps the public set small and explicit", () => {
		expect(
			ROUTE_TABLE.filter((r) => r.right === "public").map((r) => `${r.method} ${r.path}`),
		).toEqual([
			"ALL /api/auth/*",
			"GET /api/health",
			"GET /api/setup/status",
			"POST /api/setup/owner",
			"GET /api/invitations/:token",
			"POST /api/invitations/:token/accept",
			"GET /api/recovery/:token",
			"POST /api/recovery/:token",
			"POST /api/setup/recovery",
		]);
	});

	it("gives every mailbox route a mailbox right", () => {
		for (const route of ROUTE_TABLE.filter((r) => r.path.includes(":mailboxId"))) {
			expect(route.right.startsWith("mailbox."), `${route.method} ${route.path}`).toBe(true);
		}
	});

	it("needs a right stronger than reading for every route that changes a mailbox", () => {
		for (const route of ROUTE_TABLE.filter(
			(r) => r.path.includes(":mailboxId") && r.method !== "GET",
		)) {
			expect(route.right, `${route.method} ${route.path}`).not.toBe("mailbox.read");
		}
	});

	it("does not know an unlisted route", () => {
		expect(rightFor("GET", "/api/v1/everything")).toBeUndefined();
		expect(rightFor("DELETE", "/api/v1/me")).toBeUndefined();
	});
});

describe("pathParam", () => {
	const pattern = "/api/v1/mailboxes/:mailboxId/emails/:id";

	it("reads a parameter by its position in the pattern", () => {
		expect(pathParam(pattern, "/api/v1/mailboxes/hello%40example.com/emails/42", "mailboxId")).toBe(
			"hello@example.com",
		);
		expect(pathParam(pattern, "/api/v1/mailboxes/a/emails/42", "id")).toBe("42");
	});

	it("returns nothing for a missing parameter or a malformed escape", () => {
		expect(pathParam(pattern, "/api/v1/mailboxes/a/emails/42", "threadId")).toBeUndefined();
		expect(pathParam(pattern, "/api/v1/mailboxes/%E0%A4%A/emails/42", "mailboxId")).toBeUndefined();
		expect(pathParam(pattern, "/api/v1", "mailboxId")).toBeUndefined();
	});
});
