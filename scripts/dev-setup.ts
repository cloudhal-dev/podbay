/**
 * Prepares local development. Run by `pnpm dev` before the server starts.
 *
 * - writes `.dev.vars` with a session secret and a setup token generated on this machine, if the
 *   file does not exist yet (it is never tracked, rule S6);
 * - applies the D1 migrations to the local database.
 *
 * Nothing here reaches a Cloudflare account.
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const DEV_VARS = ".dev.vars";

function ensureDevVars(): string {
	const secret = randomBytes(32).toString("hex");
	const setup = randomBytes(24).toString("hex");
	try {
		// Created only if it is not there: the developer's own file is never written over.
		writeFileSync(DEV_VARS, `AUTH_SECRET=${secret}\nSETUP_TOKEN=${setup}\n`, {
			mode: 0o600,
			flag: "wx",
		});
		process.stdout.write(
			`dev-setup: wrote ${DEV_VARS} with a new session secret and setup token\n`,
		);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
	}
	const match = /^SETUP_TOKEN=(.+)$/m.exec(readFileSync(DEV_VARS, "utf8"));
	return match?.[1]?.trim() ?? "";
}

function migrate(): void {
	execFileSync("pnpm", ["exec", "wrangler", "d1", "migrations", "apply", "DB", "--local"], {
		stdio: ["ignore", "ignore", "inherit"],
		env: { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" },
	});
	process.stdout.write("dev-setup: local D1 migrations are applied\n");
}

const token = ensureDevVars();
migrate();
if (token !== "") {
	process.stdout.write(
		`dev-setup: to create the first owner, open /setup and use the setup token from ${DEV_VARS}\n`,
	);
}
