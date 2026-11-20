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
import { ROUTE_TABLE, type RouteRight, rightFor } from "../../workers/auth/route-table.ts";

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

	it("lets whoever manages the instance see and change members without a membership, and nothing else", () => {
		for (const role of ["owner", "admin"] as const) {
			expect(authorize(actor(role, null), "mailbox.members.read")).toBe("allow");
			expect(authorize(actor(role, null), "mailbox.members.manage")).toBe("allow");
			for (const action of MAILBOX_ACTIONS) {
				expect(authorize(actor(role, null), action), `${role} ${action}`).toBe("not_found");
			}
		}
		expect(authorize(actor("member", null), "mailbox.members.read")).toBe("not_found");
		expect(authorize(actor("member", null), "mailbox.members.manage")).toBe("not_found");
	});

	it("lets every member see the members, and only an owner of the mailbox change them", () => {
		for (const role of MAILBOX_ROLES) {
			expect(authorize(actor("member", role), "mailbox.members.read")).toBe("allow");
			expect(authorize(actor("member", role), "mailbox.members.manage")).toBe(
				role === "owner" ? "allow" : "forbidden",
			);
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
	/**
	 * Every route with its right and its flags, written out. A change to who may call a route is
	 * a change to this list, made on purpose; moving the code that holds the table or the rights
	 * leaves it as it is.
	 */
	it("keeps every route with its right and its flags", () => {
		const written = ROUTE_TABLE.map((r) =>
			[
				r.method,
				r.path,
				r.right,
				...(["fresh", "upgrade", "sensitive"] as const).filter((f) => r[f]),
			].join(" "),
		);
		expect(written).toEqual([
			"ALL /api/auth/* public",
			"GET /api/health public",
			"GET /api/setup/status public",
			"POST /api/setup/owner public",
			"GET /api/invitations/:token public",
			"POST /api/invitations/:token/accept public",
			"GET /api/recovery/:token public",
			"POST /api/recovery/:token public",
			"POST /api/setup/recovery public",
			"GET /api/v1/me session",
			"GET /api/v1/me/choices session",
			"PUT /api/v1/me/choices session",
			"GET /api/v1/config session",
			"GET /api/v1/mailboxes session",
			"POST /api/v1/mailboxes instance.manage",
			"GET /api/v1/registry/mailboxes instance.manage",
			"GET /api/v1/keys session",
			"POST /api/v1/keys session fresh",
			"DELETE /api/v1/keys/:keyId session",
			"GET /api/v1/users instance.manage",
			"POST /api/v1/users/:userId/recovery instance.manage fresh",
			"GET /api/v1/invitations instance.manage",
			"POST /api/v1/invitations instance.manage fresh",
			"DELETE /api/v1/invitations/:invitationId instance.manage",
			"GET /api/v1/mailboxes/:mailboxId mailbox.read",
			"PUT /api/v1/mailboxes/:mailboxId mailbox.manage sensitive",
			"DELETE /api/v1/mailboxes/:mailboxId mailbox.manage fresh",
			"GET /api/v1/mailboxes/:mailboxId/live mailbox.read upgrade",
			"GET /api/v1/mailboxes/:mailboxId/members mailbox.members.read",
			"GET /api/v1/mailboxes/:mailboxId/members/history mailbox.members.manage",
			"POST /api/v1/mailboxes/:mailboxId/members mailbox.members.manage fresh",
			"PUT /api/v1/mailboxes/:mailboxId/members/:userId mailbox.members.manage fresh",
			"DELETE /api/v1/mailboxes/:mailboxId/members/:userId mailbox.members.manage fresh",
			"GET /api/v1/mailboxes/:mailboxId/emails mailbox.read",
			"POST /api/v1/mailboxes/:mailboxId/emails mailbox.send",
			"POST /api/v1/mailboxes/:mailboxId/drafts mailbox.write",
			"PUT /api/v1/mailboxes/:mailboxId/drafts/:draftId mailbox.write",
			"POST /api/v1/mailboxes/:mailboxId/drafts/:draftId/attachments mailbox.write",
			"POST /api/v1/mailboxes/:mailboxId/drafts/:draftId/attachments/copy mailbox.write",
			"PUT /api/v1/mailboxes/:mailboxId/drafts/:draftId/attachments/:attachmentId mailbox.write",
			"DELETE /api/v1/mailboxes/:mailboxId/drafts/:draftId/attachments/:attachmentId mailbox.write",
			"GET /api/v1/mailboxes/:mailboxId/emails/:id mailbox.read",
			"PUT /api/v1/mailboxes/:mailboxId/emails/:id mailbox.write",
			"DELETE /api/v1/mailboxes/:mailboxId/emails/:id mailbox.write",
			"POST /api/v1/mailboxes/:mailboxId/emails/:id/move mailbox.write",
			"POST /api/v1/mailboxes/:mailboxId/emails/:id/reply mailbox.send",
			"POST /api/v1/mailboxes/:mailboxId/emails/:id/forward mailbox.send",
			"POST /api/v1/mailboxes/:mailboxId/emails/:id/unsend mailbox.send",
			"POST /api/v1/mailboxes/:mailboxId/emails/:id/reschedule mailbox.send",
			"GET /api/v1/mailboxes/:mailboxId/emails/:emailId/attachments/:attachmentId mailbox.read",
			"POST /api/v1/mailboxes/:mailboxId/emails/:emailId/attachments/:attachmentId/download mailbox.read",
			"GET /api/v1/mailboxes/:mailboxId/emails/:id/original mailbox.read",
			"POST /api/v1/mailboxes/:mailboxId/emails/:id/original/download mailbox.read",
			"GET /api/v1/mailboxes/:mailboxId/threads/:threadId mailbox.read",
			"POST /api/v1/mailboxes/:mailboxId/threads/:threadId/read mailbox.write",
			"GET /api/v1/mailboxes/:mailboxId/folders mailbox.read",
			"POST /api/v1/mailboxes/:mailboxId/folders/:folderId/empty mailbox.write",
			"POST /api/v1/mailboxes/:mailboxId/bulk mailbox.write",
			"POST /api/v1/mailboxes/:mailboxId/bulk/:deedId/run mailbox.write",
			"POST /api/v1/mailboxes/:mailboxId/bulk/:deedId/undo mailbox.write",
			"GET /api/v1/mailboxes/:mailboxId/labels mailbox.read",
			"POST /api/v1/mailboxes/:mailboxId/labels mailbox.write",
			"PUT /api/v1/mailboxes/:mailboxId/labels/:labelId mailbox.write",
			"DELETE /api/v1/mailboxes/:mailboxId/labels/:labelId mailbox.write",
			"PUT /api/v1/mailboxes/:mailboxId/emails/:emailId/labels mailbox.write",
			"GET /api/v1/mailboxes/:mailboxId/search mailbox.read",
			"GET /api/v1/mailboxes/:mailboxId/known-addresses mailbox.write",
			"DELETE /api/v1/mailboxes/:mailboxId/known-addresses/:knownId mailbox.write",
			"DELETE /api/v1/mailboxes/:mailboxId/known-addresses mailbox.manage",
			"GET /api/v1/mailboxes/:mailboxId/rules mailbox.read",
			"PUT /api/v1/mailboxes/:mailboxId/rules mailbox.manage",
			"POST /api/v1/mailboxes/:mailboxId/blocked-senders mailbox.manage",
			"DELETE /api/v1/mailboxes/:mailboxId/blocked-senders mailbox.manage",
			"GET /api/v1/mailboxes/:mailboxId/auto-reply mailbox.read",
			"PUT /api/v1/mailboxes/:mailboxId/auto-reply mailbox.manage fresh",
		]);
	});

	it("knows no action that is not written down", () => {
		// @ts-expect-error: an action that is not in the list is not an action.
		const unknown: Action = "mailbox.everything";
		expect(ACTIONS).not.toContain(unknown);
		// @ts-expect-error: nor is a right a route can name.
		const right: RouteRight = "instance.everything";
		expect(["public", ...ACTIONS]).not.toContain(right);
	});

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
		// Two POSTs change nothing: one downloads an attachment the reader acknowledged, the
		// other the original of a message (ADR-0015, decisions 15 and 20). Each is a POST so that
		// only the app's own origin can make it, and a reader may read what the message holds.
		const READS_BY_POST = [
			`POST ${"/api/v1/mailboxes/:mailboxId"}/emails/:emailId/attachments/:attachmentId/download`,
			`POST ${"/api/v1/mailboxes/:mailboxId"}/emails/:id/original/download`,
		];
		const changing = ROUTE_TABLE.filter((r) => r.path.includes(":mailboxId") && r.method !== "GET");
		for (const route of changing) {
			const name = `${route.method} ${route.path}`;
			if (READS_BY_POST.includes(name)) expect(route.right, name).toBe("mailbox.read");
			else expect(route.right, name).not.toBe("mailbox.read");
		}
		expect(changing.filter((r) => r.right === "mailbox.read")).toHaveLength(READS_BY_POST.length);
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
