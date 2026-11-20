// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Mail's Worker side, as the shell takes it (ADR-0018, decision 2): its API routes, which the
 * shell mounts behind its one guard; the arrival of mail for the `email` handler; its two
 * Durable Object classes, which the Worker's entry exports under the names `wrangler.jsonc`
 * gives them; the MCP endpoint and the switches of the optional features; and the few helpers
 * the shell's own code uses. The shell reaches mail only through this entry.
 */
export { EmailAgent } from "./agent";
export { receiveEmail } from "./arrival";
export { MailboxDO } from "./durableObject";
export type { MailEnv } from "./env";
export { bodyWithin } from "./lib/body";
export { features } from "./lib/features";
export { handleMcp, MCP_ROUTE } from "./mcp/server";
export { app } from "./router";
export { closeLiveOf } from "./routes/live";
