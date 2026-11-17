// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified by the Podbay contributors.

import { routeAgentRequest } from "agents";
import { Hono } from "hono";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { errorFields, log } from "../shared/log";
import { API_CACHE_CONTROL, API_HEADERS } from "../shared/security-headers";
import { callerForToken, touchKey } from "./auth/keys";
import { mailboxDecision } from "./auth/middleware";
import { app as apiApp, receiveEmail } from "./index";
import { features } from "./lib/features";
import { secret } from "./lib/secrets";
import { handleMcp, MCP_ROUTE } from "./mcp/server";
import type { Env } from "./types";

export { EmailAgent } from "./agent";
export { MailboxDO } from "./durableObject";

function getAccessUrls(teamDomain: string) {
	const certsPath = "/cdn-cgi/access/certs";
	const teamUrl = new URL(teamDomain);
	const issuer = teamUrl.origin;
	const certsUrl = teamUrl.pathname.endsWith(certsPath) ? teamUrl : new URL(certsPath, issuer);

	return { issuer, certsUrl };
}

// Main app: the API, the MCP server and the agent WebSocket. The single-page app is served as
// static assets; only the paths in wrangler.jsonc `assets.run_worker_first` reach this Worker.
const app = new Hono<{ Bindings: Env }>();

// Every answer of the Worker carries the security headers; API answers are never cached. None
// of them is a page, so their content policy allows nothing. The app's pages and assets get
// their own headers, with the page's content policy, from public/_headers.
app.use("*", async (c, next) => {
	await next();
	// A WebSocket upgrade has no headers to set.
	if (c.res.status === 101) return;
	// A response made elsewhere (the MCP handler, the agent runtime) can have fixed headers; it is
	// rebuilt around the same body so the headers can be set.
	const headers = new Headers(c.res.headers);
	for (const [name, value] of Object.entries(API_HEADERS)) headers.set(name, value);
	const path = new URL(c.req.url).pathname;
	if (path.startsWith("/api/") || path === MCP_ROUTE)
		headers.set("Cache-Control", API_CACHE_CONTROL);
	const rebuilt = new Response(c.res.body, {
		status: c.res.status,
		statusText: c.res.statusText,
		headers,
	});
	// Cleared first: assigning over an existing response keeps that response's headers, and a
	// `Cache-Control` from behind this middleware would win over the one set here.
	c.res = undefined;
	c.res = rebuilt;
});

// Cloudflare Access is an optional outer layer. Podbay's own sign-in protects every route; when
// the deployer also puts Access in front, its token is checked here as well. Setting only one of
// the two values is a mistake, and the Worker refuses to run half-configured.
app.use("*", async (c, next) => {
	const POLICY_AUD = secret(c.env, "POLICY_AUD");
	const TEAM_DOMAIN = secret(c.env, "TEAM_DOMAIN");
	if (!POLICY_AUD && !TEAM_DOMAIN) return next();
	if (!POLICY_AUD || !TEAM_DOMAIN) {
		return c.text(
			"Cloudflare Access is half configured: set both POLICY_AUD and TEAM_DOMAIN.",
			500,
		);
	}

	const token = c.req.header("cf-access-jwt-assertion");
	if (!token) {
		return c.text("Missing required CF Access JWT", 403);
	}

	try {
		const { issuer, certsUrl } = getAccessUrls(TEAM_DOMAIN);
		const JWKS = createRemoteJWKSet(certsUrl);
		await jwtVerify(token, JWKS, {
			issuer,
			audience: POLICY_AUD,
		});
	} catch {
		return c.text("Invalid or expired Access token", 403);
	}
	return next();
});

// The MCP endpoint. Off unless MCP_ENABLED is "true". A request is authenticated by its own key
// (`Authorization: Bearer pbk_…`), never by a browser session, and every tool call checks the
// mailbox against that key and its owner's membership (workers/mcp/server.ts).
app.all(MCP_ROUTE, async (c) => {
	if (!features(c.env).mcp) return c.json({ error: "Not found" }, 404);
	const header = c.req.header("authorization") ?? "";
	const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
	const caller = token === "" ? null : await callerForToken(c.env.DB, token);
	if (caller === null) {
		return c.json({ error: "Unauthorized" }, 401, { "WWW-Authenticate": 'Bearer realm="podbay"' });
	}
	c.executionCtx.waitUntil(touchKey(c.env.DB, caller.keyId));
	return handleMcp(c.req.raw, c.env, c.executionCtx as ExecutionContext, caller);
});

// Mount the API routes
app.route("/", apiApp);

// Agent WebSocket routing
// The path is /agents/<agent>/<mailbox address>. The assistant reads the mailbox and writes
// drafts, so the caller needs the right to change mail there; a reader does not get it.
app.all("/agents/*", async (c) => {
	if (!features(c.env).agent) return c.json({ error: "Not found" }, 404);
	const name = new URL(c.req.url).pathname.split("/")[3] ?? "";
	const decision = await mailboxDecision(
		c.env,
		c.req.raw,
		decodeURIComponent(name),
		"mailbox.write",
	);
	if (decision === "unauthorized") return c.json({ error: "Unauthorized" }, 401);
	if (decision !== "allow") {
		return c.json(
			{ error: decision === "forbidden" ? "Forbidden" : "Not found" },
			decision === "forbidden" ? 403 : 404,
		);
	}
	const response = await routeAgentRequest(c.req.raw, c.env);
	if (response) return response;
	return c.text("Agent not found", 404);
});

app.notFound((c) => c.json({ error: "Not found" }, 404));

// Export the Hono app as the default export with an email handler
export default {
	fetch: app.fetch,
	async email(event: ForwardableEmailMessage, env: Env, ctx: ExecutionContext) {
		try {
			await receiveEmail(event, env, ctx);
		} catch (e) {
			log.error("inbound.failed", errorFields(e));
			// Re-throw so Cloudflare's email routing can retry delivery or bounce the message.
			// Swallowing the error would silently drop the email.
			throw e;
		}
	},
};
