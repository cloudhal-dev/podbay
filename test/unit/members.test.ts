/** The text a membership change is recorded with, and reading it back for the mailbox's owners. */
import { describe, expect, it } from "vitest";
import { membershipDetail, parseMembershipDetail } from "../../workers/auth/people.ts";

describe("the record of a membership change", () => {
	it("says whose membership, which role and in which capacity, and reads back the same", () => {
		const cases = [
			{ userId: "u2", actorUserId: "u1", role: "reader", as: "owner" },
			{ userId: "u1", actorUserId: "u1", role: "owner", as: "manager" },
			{ userId: "u2", actorUserId: "u1", as: "manager" },
			{ userId: "u1", actorUserId: "u1", as: "owner" },
		] as const;
		for (const input of cases) {
			expect(parseMembershipDetail(membershipDetail(input))).toEqual({
				userId: input.userId,
				self: input.userId === input.actorUserId,
				role: "role" in input ? input.role : null,
				as: input.as,
			});
		}
	});

	it("marks a self-grant by a manager unmistakably", () => {
		expect(
			membershipDetail({ userId: "u1", actorUserId: "u1", role: "owner", as: "manager" }),
		).toBe("self: u1, role: owner, as: manager");
	});

	it("reads the rows written before the capacity was recorded", () => {
		expect(parseMembershipDetail("user: u2, role: sender")).toEqual({
			userId: "u2",
			self: false,
			role: "sender",
			as: "owner",
		});
		expect(parseMembershipDetail("user: u2")).toEqual({
			userId: "u2",
			self: false,
			role: null,
			as: "owner",
		});
	});

	it("gives nothing for text it does not know, rather than guess", () => {
		expect(parseMembershipDetail(null)).toBeNull();
		expect(parseMembershipDetail("role: owner")).toBeNull();
		expect(parseMembershipDetail("self: u1, role: owner, as: manager, extra")).toBeNull();
	});
});
