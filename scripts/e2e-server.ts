/**
 * The server the browser tests run against (tier 6): the built app, served with its real
 * response headers, on data of its own.
 *
 * - builds the app, unless PODBAY_E2E_SKIP_BUILD is set;
 * - gives the built Worker secrets generated for this run (never the developer's `.dev.vars`)
 *   and leaves the optional features at their defaults, so a run does not depend on the
 *   machine it is on;
 * - applies the migrations to a fresh state directory, `.e2e/state`;
 * - serves it with `vite preview`, with every binding local: nothing here can reach a
 *   Cloudflare account, call a model or send mail (rule D7).
 *
 * Playwright starts this (test/e2e/playwright.config.ts) and stops it when the tests are done.
 */
import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

export const E2E_DIR = ".e2e";
export const E2E_STATE = `${E2E_DIR}/state`;
export const E2E_SECRETS = `${E2E_DIR}/secrets.json`;
export const E2E_PORT = 4174;
const BUILT_VARS = "dist/worker/.dev.vars";
const QUIET = { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" };

/** What the build put next to the Worker, so it can be put back when the tests are done. */
let builtVarsBefore: string | null = null;

/** A file's text, or null when it is not there: read without asking first, so nothing can change between. */
function readIfThere(path: string): string | null {
	try {
		return readFileSync(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}

function restore(): void {
	if (builtVarsBefore !== null) writeFileSync(BUILT_VARS, builtVarsBefore, { mode: 0o600 });
	else rmSync(BUILT_VARS, { force: true });
}

function prepare(): void {
	rmSync(E2E_DIR, { recursive: true, force: true });
	mkdirSync(E2E_STATE, { recursive: true });
	if (!process.env.PODBAY_E2E_SKIP_BUILD) {
		execFileSync("pnpm", ["exec", "vite", "build"], { stdio: ["ignore", "ignore", "inherit"] });
	}
	if (!existsSync("dist/worker"))
		throw new Error("e2e: there is no build in dist/; run pnpm build");
	const secrets = {
		authSecret: randomBytes(32).toString("hex"),
		setupToken: randomBytes(24).toString("hex"),
	};
	// The build copied the developer's local variables next to the Worker. They are replaced
	// for the run and put back afterwards.
	builtVarsBefore = readIfThere(BUILT_VARS);
	writeFileSync(
		BUILT_VARS,
		`AUTH_SECRET=${secrets.authSecret}\nSETUP_TOKEN=${secrets.setupToken}\n`,
		{ mode: 0o600 },
	);
	// The tests need the setup token to create the first owner, as a deployer would.
	writeFileSync(E2E_SECRETS, JSON.stringify({ setupToken: secrets.setupToken }), { mode: 0o600 });
	execFileSync(
		"pnpm",
		["exec", "wrangler", "d1", "migrations", "apply", "DB", "--local", "--persist-to", E2E_STATE],
		{ stdio: ["ignore", "ignore", "inherit"], env: QUIET },
	);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	prepare();
	const server = spawn(
		"pnpm",
		["exec", "vite", "preview", "--port", String(E2E_PORT), "--strictPort"],
		{
			stdio: "inherit",
			env: { ...QUIET, PODBAY_STATE_DIR: E2E_STATE, PODBAY_OFFLINE: "1" },
		},
	);
	const stop = () => {
		// Put back first: whoever stops this may not wait for the server to finish.
		restore();
		server.kill("SIGTERM");
	};
	process.on("SIGTERM", stop);
	process.on("SIGINT", stop);
	server.on("exit", (code) => {
		restore();
		process.exitCode = code ?? 0;
	});
}
