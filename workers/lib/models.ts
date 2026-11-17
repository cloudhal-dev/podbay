// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Every Workers AI model id Podbay names. No other file under `workers/` may hold a model id
 * (`test/unit/agent-models.test.ts` checks it).
 *
 * Rule V5: an id is chosen from Cloudflare's current model catalog and changelog, never from
 * memory, and each has an entry in `docs/cloudflare/ledger.json` (`runtime.ai.model.*`).
 * Cloudflare retires models a few times a year; a retired id answers `410 Gone`. When the
 * changelog announces a retirement, change the id here and the ledger entry with it.
 *
 * `satisfies` ties each id to the model list of the installed Workers types, so a typo or an
 * id the types no longer know fails the type check.
 */
export const MODELS = {
	/**
	 * The assistant's chat model: the chat panel and the automatic draft of a reply.
	 * Why: its model page lists function calling and multi-turn tool calling, which the
	 * assistant's tools need; it is one of the lowest-priced models that does; the changelog of
	 * 2026-07-28 names it among the models that stay on the Workers Free plan, so the assistant
	 * works in any account; and it is not on the retirement list of 2026-11-05. It replaces
	 * `kimi-k2.5`, which Cloudflare aliased to a paid-plan model that is itself retired on
	 * 2026-11-20.
	 */
	agentChat: "@cf/zai-org/glm-4.7-flash",

	/**
	 * The prompt-injection scan: one YES or NO about a message body (`isPromptInjection`).
	 * Why: the lowest-priced text model on the pricing page, and not a reasoning model, so a limit
	 * of ten output tokens returns the answer itself. It replaces
	 * `llama-3.1-8b-instruct-fast`, which the catalog no longer lists.
	 */
	injectionScan: "@cf/ibm-granite/granite-4.0-h-micro",

	/**
	 * The draft verifier: returns a draft with the assistant's own commentary removed
	 * (`verifyDraft`).
	 * Why: it must copy the rest of the draft word for word, so it stays on the mid-size model
	 * the verifier prompt was written for, rather than the smallest one. It is not a reasoning
	 * model, answers in the plain `response` field, and is not on the retirement list of
	 * 2026-11-05. A draft costs a few hundredths of a cent.
	 */
	draftVerifier: "@cf/meta/llama-4-scout-17b-16e-instruct",
} as const satisfies Record<string, keyof AiModels>;

export type ModelId = (typeof MODELS)[keyof typeof MODELS];
