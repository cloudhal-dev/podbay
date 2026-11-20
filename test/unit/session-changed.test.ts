// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * After the session changes, the app asks again with what is on its way cancelled (#140). This
 * reads source text, so it holds the places listed here, not every place there will ever be:
 * each calls `sessionChanged` from `app/lib/session.ts` after its change, signing out clears
 * everything, no screen invalidates everything by hand, and the helper cancels before it asks.
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (file: string) => readFileSync(file, "utf8");
const appFiles = readdirSync("app", { recursive: true, encoding: "utf8" })
	.filter((name) => /\.tsx?$/.test(name))
	.map((name) => `app/${name}`);

describe("a change of the session", () => {
	it("is followed by sessionChanged in each of the listed places", () => {
		for (const [file, change, after] of [
			["app/routes/sign-in.tsx", "<SignInSteps", "sessionChanged(queryClient)"],
			["app/routes/accept.tsx", "await signIn(", "sessionChanged(queryClient)"],
			["app/routes/setup.tsx", "await signIn(", "sessionChanged(queryClient)"],
			["app/routes/recover.tsx", "await redeemRecovery(", "sessionChanged(queryClient)"],
			[
				"app/components/FreshProof.tsx",
				"<SignInSteps",
				"sessionChanged(queryClient, sessionKeys.me)",
			],
			// The security page: passkeys, then the authenticator app turned on and turned off.
			[
				"app/routes/security.tsx",
				"await withFreshProof(action)",
				"sessionChanged(queryClient, sessionKeys.me)",
			],
			["app/routes/security.tsx", "twoFactor.verifyTotp(", "await refresh()"],
			["app/routes/security.tsx", "twoFactor.disable(", "await refresh()"],
		] as const) {
			const text = source(file);
			const at = text.indexOf(change);
			expect(at, `${file} makes the change (${change})`).toBeGreaterThan(-1);
			expect(text.indexOf(after, at), `${file} asks again after ${change}`).toBeGreaterThan(at);
		}
		// The authenticator app's `refresh` is the helper, for the person alone.
		expect(source("app/routes/security.tsx")).toContain(
			"const refresh = () => sessionChanged(queryClient, sessionKeys.me);",
		);
		// Signing out clears everything, which no answer on its way can reach.
		const home = source("app/routes/home.tsx");
		const signOut = home.indexOf("await signOut()");
		expect(signOut).toBeGreaterThan(-1);
		expect(home.indexOf("queryClient.clear()", signOut)).toBeGreaterThan(signOut);
	});

	it("is never followed by invalidating everything by hand", () => {
		const byHand = appFiles.filter((file) => /\.invalidateQueries\(\s*\)/.test(source(file)));
		expect(byHand).toEqual([]);
	});

	it("cancels what is on its way before it asks again", () => {
		const helper = source("app/lib/session.ts");
		const start = helper.indexOf("export async function sessionChanged");
		expect(start).toBeGreaterThan(-1);
		const body = helper.slice(start, helper.indexOf("\n}\n", start) + 2);
		expect(body.indexOf("cancelQueries")).toBeGreaterThan(-1);
		expect(body.indexOf("cancelQueries")).toBeLessThan(body.indexOf("invalidateQueries"));
	});
});
