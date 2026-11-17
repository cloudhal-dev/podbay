// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/** The mailbox registry: list, create, read, change settings, delete. The index is D1. */
import { Hono } from "hono";
import { z } from "zod";
import { NOT_FRESH } from "../auth/fresh";
import type { ApiContext } from "../auth/middleware";
import {
	createMailbox,
	deleteMailbox,
	type MailboxRow,
	mailboxesOf,
	updateMailboxSettings,
} from "../auth/store";
import { mailboxAddressFor } from "../lib/inbound";
import { deleteObjects } from "../lib/messages";
import { settingsSaved } from "./live";

const CreateBody = z.object({
	email: z.string().max(254),
	name: z.string().trim().min(1).max(120),
	settings: z.record(z.string(), z.unknown()).optional(),
	/** Who gets the mailbox. Defaults to the creator. */
	ownerUserId: z.string().min(1).max(128).optional(),
});
const SettingsBody = z.object({ settings: z.record(z.string(), z.unknown()) });

const MAX_SETTINGS_BYTES = 16 * 1024;

/** The shape the app has always used: the address is the public id of a mailbox. */
function view(mailbox: MailboxRow, role?: string) {
	return {
		id: mailbox.address,
		email: mailbox.address,
		name: mailbox.displayName,
		settings: mailbox.settings,
		...(role ? { role } : {}),
	};
}

/** The forwarding part of a mailbox's settings, in one shape whatever is stored. */
function forwardingOf(settings: unknown): { enabled: boolean; email: string } {
	const forwarding = (settings as { forwarding?: { enabled?: unknown; email?: unknown } } | null)
		?.forwarding;
	return {
		enabled: forwarding?.enabled === true,
		email: typeof forwarding?.email === "string" ? forwarding.email.trim().toLowerCase() : "",
	};
}

function configuredDomains(env: { DOMAINS?: string }): string[] {
	return (env.DOMAINS ?? "")
		.split(",")
		.map((d) => d.trim().toLowerCase())
		.filter(Boolean);
}

export const mailboxes = new Hono<ApiContext>();

mailboxes.get("/api/v1/mailboxes", async (c) => {
	const mine = await mailboxesOf(c.env.DB, c.var.user.id);
	return c.json(mine.map((m) => view(m, m.role)));
});

mailboxes.post("/api/v1/mailboxes", async (c) => {
	const parsed = CreateBody.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: "Invalid request" }, 400);
	const address = mailboxAddressFor(parsed.data.email);
	if (address === null) return c.json({ error: "Not a valid mailbox address" }, 400);

	const domain = address.slice(address.indexOf("@") + 1);
	if (!configuredDomains(c.env).includes(domain)) {
		return c.json({ error: "This instance does not handle mail for that domain" }, 400);
	}
	const allowed = ((c.env.EMAIL_ADDRESSES ?? []) as string[]).map((a) => a.toLowerCase());
	if (allowed.length > 0 && !allowed.includes(address)) {
		return c.json({ error: "Mailbox creation is restricted to configured EMAIL_ADDRESSES" }, 403);
	}

	const settings = {
		fromName: parsed.data.name,
		forwarding: { enabled: false, email: "" },
		signature: { enabled: false, text: "" },
		autoReply: { enabled: false, subject: "", message: "" },
		...parsed.data.settings,
	};
	if (JSON.stringify(settings).length > MAX_SETTINGS_BYTES) {
		return c.json({ error: "Settings are too large" }, 400);
	}
	const result = await createMailbox(c.env.DB, {
		address,
		displayName: parsed.data.name,
		settings,
		ownerUserId: parsed.data.ownerUserId ?? c.var.user.id,
		createdBy: c.var.user.id,
	});
	if (!result.ok) {
		return result.reason === "exists"
			? c.json({ error: "Mailbox already exists" }, 409)
			: c.json({ error: "No such user" }, 400);
	}
	// Create the mailbox object now, so its folders exist before the first message arrives.
	await c.env.MAILBOX.get(c.env.MAILBOX.idFromName(address)).getFolders();
	return c.json(view(result.mailbox), 201);
});

mailboxes.get("/api/v1/mailboxes/:mailboxId", (c) =>
	c.json(view(c.var.mailbox, c.var.mailbox.role)),
);

mailboxes.put("/api/v1/mailboxes/:mailboxId", async (c) => {
	const parsed = SettingsBody.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: "Invalid request" }, 400);
	if (JSON.stringify(parsed.data.settings).length > MAX_SETTINGS_BYTES) {
		return c.json({ error: "Settings are too large" }, 400);
	}
	const mailbox = c.var.mailbox;
	// Changing where a mailbox forwards its mail is how mail is quietly taken: it needs fresh
	// proof. The other settings do not.
	const before = forwardingOf(mailbox.settings);
	const after = forwardingOf(parsed.data.settings);
	if ((before.enabled !== after.enabled || before.email !== after.email) && !c.var.fresh) {
		return c.json(NOT_FRESH, 403);
	}
	await updateMailboxSettings(
		c.env.DB,
		mailbox.id,
		parsed.data.settings,
		c.var.user.id,
		mailbox.address,
	);
	// The settings are in the index, so the mailbox object is told that they changed: it is
	// the one change to a mailbox that is not made in it (ADR-0013, decision 6).
	await settingsSaved(c.var.mailboxStub);
	return c.json(view({ ...mailbox, settings: parsed.data.settings }, mailbox.role));
});

/**
 * Deleting a mailbox deletes its mail (rule S13). Objects go before rows (ADR-0015, decision
 * 22): the keys of every file, every original and every arrival are read, the objects are
 * deleted a thousand at a time, and only then is the mailbox object emptied; then the index
 * row and its memberships go. A failure on the way leaves rows that can be deleted again.
 */
mailboxes.delete("/api/v1/mailboxes/:mailboxId", async (c) => {
	const mailbox = c.var.mailbox;
	const keys = await c.var.mailboxStub.allKeys();
	await deleteObjects(c.env.BUCKET, keys);
	// What reached the mailbox while its objects were deleted is named by the purge itself,
	// which also closes every connection of the open app (ADR-0013, decision 12).
	const late = await c.var.mailboxStub.purge();
	const gone = new Set(keys);
	await deleteObjects(
		c.env.BUCKET,
		late.filter((key) => !gone.has(key)),
	);
	await deleteMailbox(c.env.DB, mailbox.id, c.var.user.id, mailbox.address);
	return c.body(null, 204);
});
