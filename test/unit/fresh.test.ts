/**
 * Fresh proof (rule S10): when a session counts as fresh, which routes need it, and that every
 * Better Auth path Podbay names in its rules is a real endpoint of the installed version.
 */
import { DatabaseSync } from "node:sqlite";
import { betterAuth } from "better-auth";
import { describe, expect, it } from "vitest";
import { NOT_FRESH_CODE } from "../../shared/fresh-proof.ts";
import {
	FRESH_AUTH_PATHS,
	FRESH_SECONDS,
	isFresh,
	REFUSED_AUTH_PATHS,
	SECOND_STEP_VERIFY_PATHS,
} from "../../workers/auth/fresh.ts";
import { authOptions } from "../../workers/auth/options.ts";
import { ROUTE_TABLE } from "../../workers/auth/route-table.ts";

describe("isFresh", () => {
	const now = Date.parse("2026-11-17T12:00:00Z");
	const ago = (seconds: number) => new Date(now - seconds * 1000);

	it("holds for ten minutes after signing in, and not a second longer", () => {
		expect(FRESH_SECONDS).toBe(600);
		expect(isFresh(ago(0), now)).toBe(true);
		expect(isFresh(ago(599), now)).toBe(true);
		expect(isFresh(ago(600), now)).toBe(false);
		expect(isFresh(ago(86_400), now)).toBe(false);
	});

	it("reads the forms a date is stored in", () => {
		expect(isFresh(ago(30).toISOString(), now)).toBe(true);
		expect(isFresh(ago(30).getTime(), now)).toBe(true);
	});

	it("takes a date it cannot read, or one from the future, as no proof", () => {
		expect(isFresh("not a date", now)).toBe(false);
		expect(isFresh(Number.NaN, now)).toBe(false);
		expect(isFresh(new Date(now + 5 * 60_000), now)).toBe(false);
	});
});

describe("the routes that need fresh proof", () => {
	it("are exactly the sensitive changes of the design", () => {
		const fresh = ROUTE_TABLE.filter((r) => r.fresh).map((r) => `${r.method} ${r.path}`);
		expect(fresh.sort()).toEqual(
			[
				"POST /api/v1/keys",
				"POST /api/v1/invitations",
				"POST /api/v1/users/:userId/recovery",
				"DELETE /api/v1/mailboxes/:mailboxId",
				"POST /api/v1/mailboxes/:mailboxId/members",
				"PUT /api/v1/mailboxes/:mailboxId/members/:userId",
				"DELETE /api/v1/mailboxes/:mailboxId/members/:userId",
			].sort(),
		);
	});

	it("never include a route that needs no session, or one that only reads", () => {
		for (const route of ROUTE_TABLE.filter((r) => r.fresh)) {
			expect(route.right, route.path).not.toBe("public");
			expect(route.method, route.path).not.toBe("GET");
		}
	});

	it("use the code Better Auth uses for its own fresh-session endpoints", () => {
		expect(NOT_FRESH_CODE).toBe("SESSION_NOT_FRESH");
	});
});

describe("the Better Auth paths named in Podbay's rules", () => {
	const auth = betterAuth(
		authOptions({
			database: new DatabaseSync(":memory:"),
			baseURL: "https://podbay.test",
			secret: "x".repeat(32),
		}),
	);
	const endpoints = new Set(
		Object.values(auth.api as Record<string, { path?: string }>).map((endpoint) => endpoint.path),
	);

	it.each([...FRESH_AUTH_PATHS, ...SECOND_STEP_VERIFY_PATHS, ...REFUSED_AUTH_PATHS])(
		"%s is an endpoint of the installed version",
		(path) => {
			// A rule for a path that no longer exists protects nothing: an upgrade that renames an
			// endpoint must fail here.
			expect(endpoints.has(path)).toBe(true);
		},
	);

	it("cover every endpoint that changes how a person signs in", () => {
		const changing = [...endpoints].filter(
			(path): path is string =>
				typeof path === "string" &&
				/^\/(two-factor\/(enable|disable|generate-backup-codes|get-totp-uri)|passkey\/delete-passkey|change-password|change-email|delete-user)$/.test(
					path,
				),
		);
		expect(changing.length).toBeGreaterThan(0);
		for (const path of changing) expect(FRESH_AUTH_PATHS.has(path), path).toBe(true);
	});
});
