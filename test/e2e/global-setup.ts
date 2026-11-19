// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Runs once, after the server is up: the first owner is created with the setup token, as a
 * deployer would, and gets one mailbox. The account is written to `.e2e/account.json` for the
 * tests; its password is made here and exists nowhere else.
 */
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { signInFor, writeShared } from "./session.ts";

const root = (path: string) => fileURLToPath(new URL(`../../${path}`, import.meta.url));
const BASE = "http://localhost:4174";

export interface Account {
	email: string;
	password: string;
	mailbox: string;
}

async function post(path: string, body: unknown, cookie = ""): Promise<Response> {
	return fetch(`${BASE}${path}`, {
		method: "POST",
		headers: { "content-type": "application/json", origin: BASE, ...(cookie ? { cookie } : {}) },
		body: JSON.stringify(body),
	});
}

export default async function globalSetup(): Promise<void> {
	const { setupToken } = JSON.parse(readFileSync(root(".e2e/secrets.json"), "utf8")) as {
		setupToken: string;
	};
	const account: Account = {
		email: "owner@example.com",
		password: randomBytes(18).toString("base64url"),
		mailbox: "inbox@example.com",
	};
	const owner = await post("/api/setup/owner", {
		token: setupToken,
		name: "Olivia Owner",
		email: account.email,
		password: account.password,
	});
	if (owner.status !== 201) throw new Error(`e2e: creating the owner answered ${owner.status}`);
	const at = Date.now();
	const cookie = await signInFor(BASE, account.email, account.password);
	const mailbox = await post(
		"/api/v1/mailboxes",
		{ email: account.mailbox, name: "Inbox" },
		cookie,
	);
	if (mailbox.status !== 201)
		throw new Error(`e2e: creating the mailbox answered ${mailbox.status}`);
	writeFileSync(root(".e2e/account.json"), JSON.stringify(account), { mode: 0o600 });
	// One sign-in for the whole run: the tests share this session instead of signing in each
	// time, which the sign-in rate limit would refuse. A test about signing in does it itself.
	// It is made again when it grows too old to stay fresh through a test (session.ts).
	writeShared(root(".e2e/session.json"), { cookie, at });
}
