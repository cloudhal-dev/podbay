// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * After the session changes, the app asks again with what is on its way cancelled (#140): every
 * place that changes the session goes through `sessionChanged` in `app/lib/session.ts`, and no
 * screen invalidates everything by itself, which would wait for an answer given to the session
 * before.
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (file: string) => readFileSync(file, "utf8");
const appFiles = readdirSync("app", { recursive: true, encoding: "utf8" })
	.filter((name) => /\.tsx?$/.test(name))
	.map((name) => `app/${name}`);

describe("a change of the session", () => {
	it("is followed by sessionChanged in every place that makes one", () => {
		for (const [file, change] of [
			["app/routes/sign-in.tsx", "<SignInSteps"],
			["app/routes/accept.tsx", "await signIn("],
			["app/routes/setup.tsx", "await signIn("],
			["app/routes/recover.tsx", "await redeemRecovery("],
			["app/components/FreshProof.tsx", "<SignInSteps"],
			["app/routes/security.tsx", "await withFreshProof(action)"],
		] as const) {
			const text = source(file);
			const at = text.indexOf(change);
			expect(at, `${file} makes the change`).toBeGreaterThan(-1);
			expect(
				text.indexOf("sessionChanged(queryClient", at),
				`${file} asks again after it`,
			).toBeGreaterThan(at);
		}
		// Signing out clears everything, which no answer on its way can reach.
		const home = source("app/routes/home.tsx");
		expect(home.indexOf("queryClient.clear()")).toBeGreaterThan(home.indexOf("await signOut()"));
	});

	it("is never followed by invalidating everything by hand", () => {
		const byHand = appFiles.filter((file) => /\.invalidateQueries\(\s*\)/.test(source(file)));
		expect(byHand).toEqual([]);
	});

	it("cancels what is on its way before it asks again", () => {
		const helper = source("app/lib/session.ts");
		const body = helper.slice(helper.indexOf("export async function sessionChanged"));
		expect(body.indexOf("cancelQueries")).toBeGreaterThan(-1);
		expect(body.indexOf("cancelQueries")).toBeLessThan(body.indexOf("invalidateQueries"));
	});
});
