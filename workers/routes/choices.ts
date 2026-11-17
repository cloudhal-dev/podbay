// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * The signed-in person's own choices (ADR-0012): `GET` and `PUT /api/v1/me/choices`.
 *
 * The person is taken from the session and from nowhere else: no id in the path, the query or
 * the body, so there is nothing to point at someone else. No route lets an owner or an
 * administrator reach another person's choices, a program key does not reach these, and
 * neither the assistant nor MCP has a tool for them. Nothing here gives or takes access, so
 * there is no fresh proof and no audit row.
 */
import { Hono } from "hono";
import { MAX_CHOICES_BYTES } from "../../shared/choices";
import { parseChange } from "../../shared/choices-schema";
import { choicesOf, mergeChoices } from "../auth/choices";
import type { ApiContext } from "../auth/middleware";

const TOO_LARGE = { error: "The request is too large.", code: "TOO_LARGE" } as const;
const INVALID = { error: "Invalid request.", code: "INVALID" } as const;

/** The body as text, or `null` when it is longer than `max` bytes. Never reads past the limit. */
async function bodyWithin(request: Request, max: number): Promise<string | null> {
	if (Number(request.headers.get("content-length") ?? 0) > max) return null;
	if (request.body === null) return "";
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > max) {
			await reader.cancel();
			return null;
		}
		chunks.push(value);
	}
	const bytes = new Uint8Array(size);
	let at = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, at);
		at += chunk.byteLength;
	}
	return new TextDecoder().decode(bytes);
}

export const choices = new Hono<ApiContext>();

choices.get("/api/v1/me/choices", async (c) => c.json(await choicesOf(c.env.DB, c.var.user.id)));

/**
 * A change carries only the keys that changed; `null` takes a choice back to its default. A
 * key or a value the schema does not know refuses the whole request, and nothing is written.
 */
choices.put("/api/v1/me/choices", async (c) => {
	const text = await bodyWithin(c.req.raw, MAX_CHOICES_BYTES);
	if (text === null) return c.json(TOO_LARGE, 413);
	let body: unknown;
	try {
		body = JSON.parse(text);
	} catch {
		return c.json(INVALID, 400);
	}
	const change = parseChange(body);
	if (change === null) return c.json(INVALID, 400);
	// A change that names nothing writes nothing: a person who never chose has no row.
	if (Object.keys(change).length === 0) return c.json(await choicesOf(c.env.DB, c.var.user.id));

	const merged = await mergeChoices(c.env.DB, c.var.user.id, change, new Date().toISOString());
	if (merged === "newer") {
		return c.json(
			{
				error: "These choices were written by a later version of Podbay and are left as they are.",
				code: "NEWER_VERSION",
			},
			409,
		);
	}
	return c.json(merged);
});
