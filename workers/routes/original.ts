// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { log } from "@podbay/platform/log";
/**
 * The original of a received message (ADR-0015, decisions 14 to 20).
 *
 * The original is every byte a stranger sent, at once. So it is never a page: showing it
 * answers JSON with the first 256 KiB as text, and the bytes themselves leave only by a POST
 * that says `acknowledged`, which the guard accepts from the app's own origin alone, as an
 * opaque download under a name Podbay made. There is no GET for the bytes and no `Range`.
 *
 * The guard has already checked the right (`mailbox.read`) and picked the mailbox. The message
 * id only looks a row up in that mailbox's database, and the key of the object comes from the
 * row: nothing a request names becomes a storage key (rule S2).
 */
import { Hono } from "hono";
import { z } from "zod";
import {
	AUTHENTICATION_SHOWN,
	NO_ORIGINAL_CODE,
	ORIGINAL_MISSING_CODE,
	ORIGINAL_SHOWN_BYTES,
	originalFileName,
} from "../../shared/original";
import type { ApiContext } from "../auth/middleware";
import { originalAnswer } from "../lib/original";

const M = "/api/v1/mailboxes/:mailboxId";

const DownloadBody = z.object({ acknowledged: z.literal(true) });

const NOT_FOUND = { error: "Email not found" };
const NO_ORIGINAL = {
	error:
		"This message has no original: it was sent from here, or arrived before originals were kept.",
	code: NO_ORIGINAL_CODE,
};
const MISSING = {
	error: "The original of this message is not in storage.",
	code: ORIGINAL_MISSING_CODE,
};

export const original = new Hono<ApiContext>();

original.get(`${M}/emails/:id/original`, async (c) => {
	const id = c.req.param("id");
	const found = await c.var.mailboxStub.originalOf(id);
	if (found === null) return c.json(NOT_FOUND, 404);
	if (found.raw_key === null) return c.json(NO_ORIGINAL, 404);
	const size = found.raw_size ?? 0;
	// A ranged read: the Worker never holds more than what it shows.
	const object = await c.env.BUCKET.get(found.raw_key, {
		range: { offset: 0, length: Math.max(1, Math.min(size, ORIGINAL_SHOWN_BYTES)) },
	});
	if (object === null) {
		log.error("original.missing", { emailId: id });
		return c.json(MISSING, 404);
	}
	const bytes = new Uint8Array(await object.arrayBuffer());
	return c.json(
		originalAnswer(
			bytes.subarray(0, ORIGINAL_SHOWN_BYTES),
			object.size,
			found.auth_results,
			AUTHENTICATION_SHOWN,
		),
	);
});

original.post(`${M}/emails/:id/original/download`, async (c) => {
	const parsed = DownloadBody.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: "Invalid request" }, 400);
	const id = c.req.param("id");
	const found = await c.var.mailboxStub.originalOf(id);
	if (found === null) return c.json(NOT_FOUND, 404);
	if (found.raw_key === null) return c.json(NO_ORIGINAL, 404);
	const object = await c.env.BUCKET.get(found.raw_key);
	if (object === null) {
		log.error("original.missing", { emailId: id });
		return c.json(MISSING, 404);
	}
	// Opaque bytes and a download, whatever is inside: never a type a browser would show
	// (rule S5). A program learns what the file is from its name, which holds nothing of the
	// subject or the sender.
	return new Response(object.body.pipeThrough(new FixedLengthStream(object.size)), {
		headers: {
			"Content-Type": "application/octet-stream",
			"Content-Length": String(object.size),
			"Content-Disposition": `attachment; filename="${originalFileName(found.date ?? "", id)}"`,
		},
	});
});
