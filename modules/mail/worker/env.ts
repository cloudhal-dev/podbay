// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * What mail needs of the Worker it runs in: the bindings and variables it uses, by the names
 * `wrangler.jsonc` gives them (ADR-0018, decision 3: none of them changes name). The shell's own
 * Env, generated from `wrangler.jsonc`, has all of these, so mail never names the shell's type.
 * Secrets are not here: they are read with the shell's `secret()`.
 */
import type { EmailAgent } from "./agent";
import type { MailboxDO } from "./durableObject";

export interface MailEnv {
	/** The mailbox object, one per mailbox. */
	MAILBOX: DurableObjectNamespace<MailboxDO>;
	/** The assistant's object, used only when the assistant is on. */
	EMAIL_AGENT: DurableObjectNamespace<EmailAgent>;
	/** Originals of messages and their attachments. */
	BUCKET: R2Bucket;
	/** The accounts database: memberships and the mailbox registry. */
	DB: D1Database;
	/** The one way mail leaves. */
	EMAIL: SendEmail;
	/** Workers AI, for the assistant when it is on. */
	AI: Ai;
	/** The domains a mailbox may be made under, comma separated. */
	DOMAINS: string;
	/** The addresses a mailbox may be made for, when the deployer limits them. */
	EMAIL_ADDRESSES: readonly string[];
	/** Exactly "true" turns the assistant on. */
	AGENT_ENABLED: string;
	/** Exactly "true" turns the MCP endpoint on. */
	MCP_ENABLED: string;
}

/**
 * The one exception: the assistant's SDK (`@cloudflare/ai-chat`) requires the Env of its class
 * to extend the Worker's generated `Cloudflare.Env`, so `EmailAgent` is typed by that and by
 * nothing else of mail's.
 */
export type AgentEnv = Cloudflare.Env;
