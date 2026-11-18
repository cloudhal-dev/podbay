/**
 * Runs the static checks of docs/engineering-rules.md.
 *
 *   node scripts/check-static.ts            every check
 *   node scripts/check-static.ts copies     one check by name
 */
import { check as account } from "./checks/account.ts";
import { check as compat } from "./checks/compat.ts";
import { check as controls } from "./checks/controls.ts";
import { check as copies } from "./checks/copies.ts";
import { check as dialogs } from "./checks/dialogs.ts";
import { check as docs } from "./checks/docs.ts";
import { check as guidance } from "./checks/guidance.ts";
import { check as headers } from "./checks/headers.ts";
import { check as hosts } from "./checks/hosts.ts";
import { check as html } from "./checks/html.ts";
import { check as imports } from "./checks/imports.ts";
import { check as ledger } from "./checks/ledger.ts";
import type { Check } from "./checks/lib.ts";
import { check as licences } from "./checks/licences.ts";
import { check as messages } from "./checks/messages.ts";
import { check as names } from "./checks/names.ts";
import { check as ratchets } from "./checks/ratchets.ts";
import { check as schemas } from "./checks/schemas.ts";
import { check as secrets } from "./checks/secrets.ts";
import { check as sender } from "./checks/sender.ts";
import { check as vendored } from "./checks/vendored-skills.ts";
import { check as workflows } from "./checks/workflows.ts";
import { checkPins, readManifest } from "./pins.ts";

const pins: Check = { name: "pins", run: () => checkPins(readManifest()) };
const ALL: Check[] = [
	pins,
	copies,
	licences,
	names,
	secrets,
	account,
	imports,
	sender,
	html,
	controls,
	dialogs,
	messages,
	hosts,
	workflows,
	headers,
	compat,
	ledger,
	vendored,
	docs,
	guidance,
	ratchets,
	schemas,
];

const wanted = process.argv.slice(2);
const selected = wanted.length > 0 ? ALL.filter((c) => wanted.includes(c.name)) : ALL;
if (selected.length === 0) {
	process.stderr.write(`unknown check; choose from: ${ALL.map((c) => c.name).join(", ")}\n`);
	process.exit(2);
}

let failed = 0;
for (const check of selected) {
	const started = Date.now();
	const problems = await check.run();
	const ms = Date.now() - started;
	if (problems.length === 0) {
		process.stdout.write(`✓ ${check.name} (${ms} ms)\n`);
		continue;
	}
	failed++;
	process.stdout.write(`✗ ${check.name} (${ms} ms)\n`);
	for (const problem of problems) process.stdout.write(`    ${problem}\n`);
}
process.stdout.write(`static checks: ${selected.length - failed} passed, ${failed} failed\n`);
process.exitCode = failed === 0 ? 0 : 1;
