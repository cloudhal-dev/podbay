import { describe, expect, it } from "vitest";
import { accountProblems } from "../../scripts/checks/account.ts";
import { compatProblems, MAX_AGE_DAYS } from "../../scripts/checks/compat.ts";
import { headersProblems } from "../../scripts/checks/headers.ts";
import { htmlProblems } from "../../scripts/checks/html.ts";
import { secretProblems } from "../../scripts/checks/secrets.ts";
import { API_HEADERS, headersFile, PAGE_HEADERS } from "../../shared/security-headers.ts";

// Sample credentials are assembled at run time, so this file contains none.
const join = (...parts: string[]) => parts.join("");

describe("secrets", () => {
	it.each([
		["a private key", join("-----BEGIN ", "RSA PRIVATE KEY-----\nMIIE")],
		["a private key", join("-----BEGIN ", "PRIVATE KEY-----")],
		["a GitHub token", join("gh", "p_", "a".repeat(36))],
		["a GitHub fine-grained token", join("github", "_pat_", "A1".repeat(30))],
		["an AWS access key id", join("AKI", "A", "ABCDEFGHIJKLMNOP")],
		["an API key", join("s", "k-", "x".repeat(40))],
		["a Slack token", join("xox", "b-", "1234567890-abcdefghijkl")],
		["a Cloudflare credential", join("CLOUDFLARE_API_", 'TOKEN="', "t".repeat(40), '"')],
	])("finds %s", (what, text) => {
		expect(secretProblems("workers/x.ts", `const v = ${JSON.stringify(text)};\n${text}`)).toContain(
			`workers/x.ts: looks like ${what}`,
		);
	});

	it("refuses a tracked environment file but allows its example", () => {
		expect(secretProblems(".dev.vars", "A=1")).toHaveLength(1);
		expect(secretProblems(".env.production", "A=1")).toHaveLength(1);
		expect(secretProblems("apps/x/.env", "A=1")).toHaveLength(1);
		expect(secretProblems(".dev.vars.example", "POLICY_AUD=")).toEqual([]);
	});

	it("does not flag ordinary code", () => {
		const code =
			'const token = env.SETUP_TOKEN;\nconst id = "0123456789abcdef";\n// see CLOUDFLARE_API_TOKEN in the docs';
		expect(secretProblems("workers/x.ts", code)).toEqual([]);
	});
});

describe("account", () => {
	it("refuses a call to the Cloudflare REST API from shipped code", () => {
		expect(
			accountProblems("workers/x.ts", 'fetch("https://api.cloudflare.com/client/v4/zones")'),
		).toHaveLength(1);
	});

	it("refuses a credential variable in shipped code and in the Worker configuration", () => {
		expect(accountProblems("workers/x.ts", "env.CF_API_TOKEN")).toHaveLength(1);
		expect(
			accountProblems("wrangler.jsonc", '"vars": { "CLOUDFLARE_API_TOKEN": "" }'),
		).toHaveLength(1);
	});

	it("does not scan tooling, tests or documents", () => {
		expect(accountProblems("scripts/deploy.ts", "process.env.CLOUDFLARE_API_TOKEN")).toEqual([]);
		expect(accountProblems("docs/x.md", "api.cloudflare.com")).toEqual([]);
	});
});

describe("compat", () => {
	const now = Date.parse("2026-11-17T12:00:00Z");
	const config = (date: string) => `{ "compatibility_date": "${date}" }`;

	it("accepts a recent date", () => {
		expect(compatProblems(config("2026-11-16"), now)).toEqual([]);
		expect(compatProblems(config("2026-10-01"), now)).toEqual([]);
	});

	it("refuses a stale date", () => {
		expect(compatProblems(config("2026-08-01"), now)[0]).toContain(`limit ${MAX_AGE_DAYS}`);
	});

	it("refuses a missing, malformed or future date", () => {
		expect(compatProblems("{}", now)).toHaveLength(1);
		expect(compatProblems(config("2026-13-45"), now)).toHaveLength(1);
		expect(compatProblems(config("2027-01-01"), now)).toHaveLength(1);
	});
});

describe("html", () => {
	it.each([
		["innerHTML", "el.innerHTML = body;"],
		["outerHTML", "el.outerHTML = body;"],
		["insertAdjacentHTML", 'el.insertAdjacentHTML("beforeend", body);'],
		["document.write", "document.write(body);"],
		["dangerouslySetInnerHTML", "<div dangerouslySetInnerHTML={{ __html: body }} />"],
	])("refuses %s in the UI", (name, code) => {
		expect(htmlProblems("app/components/X.tsx", code)[0]).toContain(name);
	});

	it("lets only the mail frame set srcdoc", () => {
		expect(htmlProblems("app/components/EmailIframe.tsx", "iframe.srcdoc = doc;")).toEqual([]);
		expect(htmlProblems("app/components/Other.tsx", "iframe.srcdoc = doc;")).toHaveLength(1);
		expect(htmlProblems("app/components/Other.tsx", "<iframe srcDoc={doc} />")).toHaveLength(1);
	});

	it("ignores comparisons, comments and code outside the UI", () => {
		expect(htmlProblems("app/x.ts", 'if (el.innerHTML === "") return;')).toEqual([]);
		expect(htmlProblems("app/x.ts", "// never assign el.innerHTML = body here")).toEqual([]);
		expect(htmlProblems("workers/x.ts", "el.innerHTML = body;")).toEqual([]);
	});
});

describe("headers", () => {
	it("passes when the file equals the generated content", () => {
		expect(headersProblems(headersFile(), headersFile())).toEqual([]);
	});

	it("fails when the file is missing or was edited by hand", () => {
		expect(headersProblems(null, headersFile())).toHaveLength(1);
		expect(
			headersProblems(headersFile().replace("DENY", "SAMEORIGIN"), headersFile()),
		).toHaveLength(1);
	});

	it("forbids framing, sniffing and referrers, and requires HTTPS", () => {
		for (const headers of [PAGE_HEADERS, API_HEADERS]) {
			expect(headers["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
			expect(headers["X-Frame-Options"]).toBe("DENY");
			expect(headers["X-Content-Type-Options"]).toBe("nosniff");
			expect(headers["Referrer-Policy"]).toBe("no-referrer");
			expect(headers["Strict-Transport-Security"]).toMatch(/^max-age=\d{8,}$/);
			expect(headers["Cross-Origin-Resource-Policy"]).toBe("same-origin");
		}
	});

	it("applies every header to every asset", () => {
		const file = headersFile();
		expect(file).toContain("\n/*\n");
		for (const [name, value] of Object.entries(PAGE_HEADERS)) {
			expect(file).toContain(`  ${name}: ${value}\n`);
		}
	});
});
