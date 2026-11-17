// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified by the Podbay contributors.

import { routeAgentRequest } from "agents";
import { Hono, type MiddlewareHandler } from "hono";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { errorFields, log } from "../shared/log";
import { API_CACHE_CONTROL, SECURITY_HEADERS } from "../shared/security-headers";
import { mailboxDecision, sessionActor } from "./auth/middleware";
import { app as apiApp, receiveEmail } from "./index";
import { features } from "./lib/features";
import { secret } from "./lib/secrets";
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

// Every answer of the Worker carries the security headers; API answers are never cached. The
// static assets get the same headers from public/_headers.
app.use("*", async (c, next) => {
	await next();
	// A WebSocket upgrade has no headers to set.
	if (c.res.status === 101) return;
	for (const [name, value] of Object.entries(SECURITY_HEADERS)) c.res.headers.set(name, value);
	if (new URL(c.req.url).pathname.startsWith("/api/")) {
		c.res.headers.set("Cache-Control", API_CACHE_CONTROL);
	}
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

// MCP server endpoint. Off unless MCP_ENABLED is "true". Its tools are not yet limited to the
// caller's mailboxes, so until that lands only the instance owner may reach it at all.
const mcpHandler = EmailMCP.serve("/mcp", { binding: "EMAIL_MCP" });
const mcpGate: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
	if (!features(c.env).mcp) return c.json({ error: "Not found" }, 404);
	const actor = await sessionActor(c.env, c.req.raw).catch(() => null);
	if (actor === null) return c.json({ error: "Unauthorized" }, 401);
	if (actor.instanceRole !== "owner") return c.json({ error: "Forbidden" }, 403);
	return next();
};
app.use("/mcp", mcpGate);
app.use("/mcp/*", mcpGate);
app.all("/mcp", async (c) => {
	return mcpHandler.fetch(c.req.raw, c.env, c.executionCtx as ExecutionContext);
});
app.all("/mcp/*", async (c) => {
	return mcpHandler.fetch(c.req.raw, c.env, c.executionCtx as ExecutionContext);
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
