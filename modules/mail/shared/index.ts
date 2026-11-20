// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * What mail's two sides both run, and what a client of mail takes (ADR-0018, decision 2): the
 * shapes of its requests and answers and its pure functions. The shell and the app reach them
 * only through this entry. The strict schema of the rules (`./rules-schema`, built with the
 * schema library) is not here: only mail's Worker side loads it, so it stays out of the app.
 *
 * Two files name a type `Outcome`: what the rules decide for a message (`RuleOutcome` here) and
 * what became of a message that was sent (`SendOutcome` here). Everything else keeps its name.
 */
export * from "./attachment-risk.ts";
export type * from "./bulk.ts";
export * from "./folders.ts";
export * from "./html-text.ts";
export * from "./inbound.ts";
export * from "./known-addresses.ts";
export * from "./labels.ts";
export * from "./list-order.ts";
export * from "./live.ts";
export * from "./mail-choices.ts";
export * from "./mail-frame.ts";
export * from "./mcp-tools.ts";
export * from "./original.ts";
export {
	type AddressCondition,
	AUTO_REPLY,
	type AutoReply,
	type AutoReplyAnswer,
	answersAt,
	type BlockedSender,
	blockedSenderOf,
	cleanText,
	evaluate,
	FACT_LIMITS,
	factsOf,
	isAddress,
	isBlocked,
	isRuleId,
	type MessageFacts,
	NO_AUTO_REPLY,
	type NoReply,
	newRuleId,
	type Outcome as RuleOutcome,
	type ReplyQuestion,
	RULE_CODES,
	RULE_LIMITS,
	RULE_MATCHES,
	RULE_PLACES,
	type Rule,
	type RuleActions,
	type RuleConditions,
	type RuleMatch,
	type RulePlace,
	type RulesAnswer,
	replyOwed,
	replySender,
	shownRule,
} from "./rules.ts";
export {
	DEFAULT_UNDO_SECONDS,
	isUndoSeconds,
	type Leaves,
	NOT_NOW_CODES,
	type Outcome as SendOutcome,
	OWN_REASONS,
	type OwnReason,
	outcomeOfRefusal,
	retryAfterMs,
	SEND_CODES,
	SENDING,
	type SendAnswer,
	SUBMISSION_STATES,
	type Submission,
	type SubmissionState,
	UNDO_SECONDS,
	type UndoSeconds,
	whenToLeave,
} from "./sending.ts";
export * from "./sending-limits.ts";
