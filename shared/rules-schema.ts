// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * The strict half of the rules of a mailbox (ADR-0008): what `PUT …/rules`, `POST` and
 * `DELETE …/blocked-senders` and `PUT …/auto-reply` take (rule D2). A key the vocabulary does
 * not have refuses the whole request: nothing is stored that the one pure function of
 * `shared/rules.ts` does not know.
 *
 * Only the Worker loads this module: the app takes its types from `shared/rules.ts`, so the
 * schema library stays out of its bundle.
 */
import { z } from "zod";
import { plainTextOf } from "./html-text";
import { isLabelId } from "./labels";
import {
	AUTO_REPLY,
	type AutoReply,
	blockedSenderOf,
	cleanText,
	FACT_LIMITS,
	isRuleId,
	newRuleId,
	RULE_LIMITS,
	RULE_MATCHES,
	RULE_PLACES,
	type Rule,
	type RuleActions,
	type RuleConditions,
} from "./rules";

/** Longer than a condition may be once it is cleaned, so that spaces around it are not refused. */
const text = z.string().max(RULE_LIMITS.condition * 2);
const address = z.strictObject({ match: z.enum(RULE_MATCHES), value: text });

const ConditionsSchema = z.strictObject({
	from: address.optional(),
	to: address.optional(),
	subject: text.optional(),
	words: text.optional(),
	hasAttachment: z.literal(true).optional(),
});

const ActionsSchema = z.strictObject({
	place: z.enum(RULE_PLACES).optional(),
	read: z.literal(true).optional(),
	star: z.literal(true).optional(),
	labels: z.array(z.string().max(64)).max(RULE_LIMITS.labels).optional(),
});

const RuleSchema = z.strictObject({
	id: z.string().max(64).optional(),
	conditions: ConditionsSchema,
	actions: ActionsSchema,
});

/** One more than a mailbox may hold, so that "too many" is told apart from "not a list". */
const RulesBodySchema = z.strictObject({ rules: z.array(RuleSchema).max(RULE_LIMITS.rules + 1) });

function conditionsOf(given: z.infer<typeof ConditionsSchema>): RuleConditions | null {
	const conditions: RuleConditions = {};
	for (const field of ["from", "to"] as const) {
		const one = given[field];
		if (one === undefined) continue;
		const value = cleanText(one.value);
		if (value === null) return null;
		conditions[field] = { match: one.match, value };
	}
	for (const field of ["subject", "words"] as const) {
		const one = given[field];
		if (one === undefined) continue;
		const value = cleanText(one);
		if (value === null) return null;
		conditions[field] = value;
	}
	if (given.hasAttachment === true) conditions.hasAttachment = true;
	return Object.keys(conditions).length === 0 ? null : conditions;
}

function actionsOf(given: z.infer<typeof ActionsSchema>): RuleActions | null {
	const labels = [...new Set(given.labels ?? [])];
	if (!labels.every(isLabelId)) return null;
	const actions: RuleActions = {
		...(given.place === undefined ? {} : { place: given.place }),
		...(given.read === true ? { read: true as const } : {}),
		...(given.star === true ? { star: true as const } : {}),
		...(labels.length > 0 ? { labels } : {}),
	};
	return Object.keys(actions).length === 0 ? null : actions;
}

export type ParsedRules = { rules: Rule[] } | { refused: "invalid" | "too_many" };

/**
 * The rule list a request body is. A rule needs at least one condition and one action; a rule
 * that names an id keeps it, any other gets one. Two rules never share an id.
 */
export function parseRules(body: unknown): ParsedRules {
	const parsed = RulesBodySchema.safeParse(body);
	if (!parsed.success) return { refused: "invalid" };
	if (parsed.data.rules.length > RULE_LIMITS.rules) return { refused: "too_many" };
	const rules: Rule[] = [];
	const ids = new Set<string>();
	for (const given of parsed.data.rules) {
		const conditions = conditionsOf(given.conditions);
		const actions = actionsOf(given.actions);
		if (conditions === null || actions === null) return { refused: "invalid" };
		if (given.id !== undefined && (!isRuleId(given.id) || ids.has(given.id))) {
			return { refused: "invalid" };
		}
		const id = given.id ?? newRuleId();
		ids.add(id);
		rules.push({ id, conditions, actions });
	}
	return { rules };
}

const SenderBodySchema = z.strictObject({
	sender: z.string().max(FACT_LIMITS.address),
	kind: z.enum(["address", "domain"]).optional(),
});

/**
 * The sender a request names, as it is stored, or `null` when it names none. A request may
 * say which kind it means: "address" takes one whole address only, and "domain" a domain
 * only, so a block offered for one address can never become a block of a whole domain.
 */
export function parseSender(body: unknown): string | null {
	const parsed = SenderBodySchema.safeParse(body);
	if (!parsed.success) return null;
	const sender = blockedSenderOf(parsed.data.sender);
	if (sender === null) return null;
	const domain = sender.startsWith("@");
	if (parsed.data.kind === "address" && domain) return null;
	if (parsed.data.kind === "domain" && !domain) return null;
	return sender;
}

const instant = z.union([z.null(), z.string().max(40)]);

const AutoReplySchema = z.strictObject({
	isEnabled: z.boolean(),
	fromDate: instant,
	toDate: instant,
	subject: z.union([z.null(), z.string().max(AUTO_REPLY.subject * 2)]),
	textBody: z.union([z.null(), z.string().max(AUTO_REPLY.text)]),
	htmlBody: z.union([z.null(), z.string().max(AUTO_REPLY.html)]),
});

/** An instant as it is stored: UTC, in one form. `undefined` when the text is not a date. */
function instantOf(value: string | null): string | null | undefined {
	if (value === null) return null;
	const time = Date.parse(value);
	return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}

const lines = (value: string | null): string | null =>
	value === null || value.trim() === "" ? null : value;

/** Whether two texts say the same, whatever their spaces and line breaks. */
const sameText = (one: string, other: string): boolean =>
	one.replace(/\s+/g, " ").trim() === other.replace(/\s+/g, " ").trim();

export type ParsedAutoReply = { reply: AutoReply } | { refused: "invalid" | "empty" };

/**
 * The automatic reply a request body is. A subject is one line; an end that is not after its
 * beginning is refused; one that is turned on must have something to say.
 */
export function parseAutoReply(body: unknown): ParsedAutoReply {
	const parsed = AutoReplySchema.safeParse(body);
	if (!parsed.success) return { refused: "invalid" };
	const fromDate = instantOf(parsed.data.fromDate);
	const toDate = instantOf(parsed.data.toDate);
	if (fromDate === undefined || toDate === undefined) return { refused: "invalid" };
	if (fromDate !== null && toDate !== null && toDate <= fromDate) return { refused: "invalid" };
	const subject =
		parsed.data.subject === null
			? null
			: // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it removes
				parsed.data.subject.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
	if (subject !== null && [...subject].length > AUTO_REPLY.subject) return { refused: "invalid" };
	const reply: AutoReply = {
		isEnabled: parsed.data.isEnabled,
		fromDate,
		toDate,
		subject: subject === "" ? null : subject,
		textBody: lines(parsed.data.textBody),
		htmlBody: lines(parsed.data.htmlBody),
	};
	if (reply.isEnabled && reply.textBody === null && reply.htmlBody === null) {
		return { refused: "empty" };
	}
	// The HTML is what is sent and the text is what a person sees on the settings screen: both
	// together only when the text is the text of the HTML, so the two cannot say different things.
	if (
		reply.textBody !== null &&
		reply.htmlBody !== null &&
		sameText(plainTextOf(reply.htmlBody), reply.textBody) === false
	) {
		return { refused: "invalid" };
	}
	return { reply };
}
