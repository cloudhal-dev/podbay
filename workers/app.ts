// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified by the Podbay contributors.

import { routeAgentRequest } from "agents";
import { Hono } from "hono";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { errorFields, log } from "../shared/log";
import { app as apiApp, receiveEmail } from "./index";
import { features } from "./lib/features";
import { EmailMCP } from "./mcp";
import type { Env } from "./types";

export { EmailAgent } from "./agent";
export { MailboxDO } from "./durableObject";
export { EmailMCP } from "./mcp";

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

// Cloudflare Access JWT validation middleware (production only)
app.use("*", async (c, next) => {
	// Skip validation in development
	if (import.meta.env.DEV) {
		return next();
	}

	const { POLICY_AUD, TEAM_DOMAIN } = c.env;

	// Fail closed in production if Access is not configured.
	if (!POLICY_AUD || !TEAM_DOMAIN) {
		return c.text(
			"Cloudflare Access must be configured in production. Set POLICY_AUD and TEAM_DOMAIN.",
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

	// Authorization model note: once a teammate passes the shared Cloudflare
	// Access policy, they can access all mailboxes in this app by design.
	return next();
});

// MCP server endpoint — used by AI coding tools (ProtoAgent, Claude Code, Cursor, etc.)
// Must be before the API routes
const mcpHandler = EmailMCP.serve("/mcp", { binding: "EMAIL_MCP" });
app.use("/mcp", async (c, next) => {
	if (!features(c.env).mcp) return c.json({ error: "Not found" }, 404);
	return next();
});
app.use("/mcp/*", async (c, next) => {
	if (!features(c.env).mcp) return c.json({ error: "Not found" }, 404);
	return next();
});
app.all("/mcp", async (c) => {
	return mcpHandler.fetch(c.req.raw, c.env, c.executionCtx as ExecutionContext);
});
app.all("/mcp/*", async (c) => {
	return mcpHandler.fetch(c.req.raw, c.env, c.executionCtx as ExecutionContext);
});

// Mount the API routes
app.route("/", apiApp);

// Agent WebSocket routing
app.all("/agents/*", async (c) => {
	if (!features(c.env).agent) return c.json({ error: "Not found" }, 404);
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
