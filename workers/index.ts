// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * The API as the shell puts it together (ADR-0018, decision 1): one guard, then the shell's own
 * routes, then each module's. Every API route goes through the guard: it must be in the route
 * table, a request that changes state must come from the app's own origin, and unless the route
 * is public there must be a session with the right the table names. Nothing after it checks
 * access again.
 */
import { app as mail } from "@podbay/mail/worker";
import { Hono } from "hono";
import { type ApiContext, guard } from "./auth/middleware";
import { account } from "./routes/account";
import { choices } from "./routes/choices";
import { people } from "./routes/people";
import { recovery } from "./routes/recovery";

const app = new Hono<ApiContext>();

app.use("/api/*", guard);

app.route("/", account);
app.route("/", choices);
app.route("/", people);
app.route("/", recovery);
app.route("/", mail);

export { app };
