/** Who may issue a recovery link for whom (rule S10). The store and the routes are in tier 3. */
import { describe, expect, it } from "vitest";
import { INSTANCE_ROLES } from "../../workers/auth/authorize.ts";
import { mayIssueRecovery, RECOVERY_TTL_HOURS } from "../../workers/auth/recovery.ts";

const person = (id: string, role: (typeof INSTANCE_ROLES)[number]) => ({
	id,
	email: `${id}@example.com`,
	role,
});

describe("mayIssueRecovery", () => {
	it("is never for oneself, whatever the role", () => {
		for (const role of INSTANCE_ROLES) {
			expect(mayIssueRecovery({ id: "a", role }, person("a", role))).toBe("self");
		}
	});

	it("lets an owner recover anyone else, an administrator only members, a member nobody", () => {
		const allowed = INSTANCE_ROLES.flatMap((actor) =>
			INSTANCE_ROLES.filter(
				(target) => mayIssueRecovery({ id: "a", role: actor }, person("b", target)) === "ok",
			).map((target) => `${actor}>${target}`),
		);
		expect(allowed.sort()).toEqual(
			["owner>owner", "owner>admin", "owner>member", "admin>member"].sort(),
		);
	});

	it("is for a day at most", () => {
		expect(RECOVERY_TTL_HOURS).toBeLessThanOrEqual(24);
	});
});
