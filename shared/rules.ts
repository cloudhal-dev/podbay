// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * The rules of a mailbox for its incoming mail (ADR-0008): blocked senders, filters and the
 * automatic reply. What the Worker and the app both need to know about them is here: the
 * closed vocabulary, the limits, and the two pure functions that decide.
 *
 * - `evaluate` goes from the blocked senders, the rule list and the facts of a message to an
 *   outcome: the place, the marks and the labels. Nothing in it is interpreted: a condition is
 *   plain text compared without regard to case, on fields cut to a fixed length. There is no
 *   pattern and no expression, and it never throws: a rule that cannot be evaluated is skipped
 *   and counted.
 * - `replyOwed` says whether the automatic reply is owed for a message, and to whom. Each of
 *   its refusals is a line of RFC 3834 as the record lists them.
 *
 * Nothing here needs the schema library, so the app imports this module as it is. The strict
 * schemas of the routes are in `shared/rules-schema.ts`, which only the Worker loads.
 */

/** Decision 11: chosen, and to be revised from use. */
export const RULE_LIMITS = {
	/** Filters in one mailbox. */
	rules: 100,
	/** Blocked senders in one mailbox. */
	blocked: 500,
	/** Characters in the text of a condition. */
	condition: 200,
	/** Labels one rule gives. */
	labels: 10,
} as const;

/**
 * How much of a message a rule is matched against. A message is a stranger's text, so every
 * field has a length it is cut to before anything is compared.
 */
export const FACT_LIMITS = {
	/** Characters of an address. */
	address: 320,
	/** Characters of the sender's name. */
	name: 200,
	/** Addresses in To and Cc together. */
	recipients: 100,
	/** Characters of the subject. */
	subject: 1000,
	/** Characters of the text, from its start. */
	text: 20_000,
	/** Labels the rules give one message, all together. */
	labels: 50,
} as const;

/** Where a rule files a message. Without one it stays in the Inbox. */
export const RULE_PLACES = ["archive", "spam", "trash"] as const;
export type RulePlace = (typeof RULE_PLACES)[number];

export const RULE_MATCHES = ["is", "contains"] as const;
export type RuleMatch = (typeof RULE_MATCHES)[number];

/** An address field of a condition: the whole address, or a part of it. */
export interface AddressCondition {
	match: RuleMatch;
	value: string;
}

/** The conditions of a rule: a closed set, each at most once, all of which must hold. */
export interface RuleConditions {
	/** The sender is, or contains. */
	from?: AddressCondition;
	/** A recipient (To or Cc) is, or contains. */
	to?: AddressCondition;
	/** The subject contains. */
	subject?: string;
	/** The message (its subject and its text) contains each of these words. */
	words?: string;
	/** It has an attachment. */
	hasAttachment?: true;
}

/** The actions of a rule: a closed set. No rule forwards and no rule rejects. */
export interface RuleActions {
	/** Skip the inbox (`archive`), move to Trash, or move to Spam. */
	place?: RulePlace;
	/** Mark as read. */
	read?: true;
	/** Star. */
	star?: true;
	/** Give labels, by their ids. */
	labels?: string[];
}

export interface Rule {
	id: string;
	conditions: RuleConditions;
	actions: RuleActions;
}

/** A blocked sender: an address, or `@domain` for everything at a domain. */
export interface BlockedSender {
	sender: string;
	created_at: string;
}

/** What `GET …/rules` answers. */
export interface RulesAnswer {
	rules: Rule[];
	blocked: BlockedSender[];
}

/** The codes the routes of this record answer with. */
export const RULE_CODES = {
	invalid: "INVALID",
	tooMany: "RULE_LIMIT",
	blockedLimit: "BLOCKED_LIMIT",
	notBlocked: "NOT_BLOCKED",
	noBody: "AUTO_REPLY_EMPTY",
} as const;

// ── Ids and text ───────────────────────────────────────────────────

const RULE_ID = /^rul_[0-9a-f]{24}$/;

/** Whether a value has the shape of a rule's id. An id is opaque. */
export function isRuleId(value: unknown): value is string {
	return typeof value === "string" && RULE_ID.test(value);
}

export function newRuleId(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(12));
	return `rul_${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/** Text as it is compared: one form, lower case. Never a pattern. */
const fold = (text: string): string => text.normalize("NFC").toLowerCase();

/** The text of a condition as it is stored: one form, trimmed, inner spaces single. */
export function cleanText(raw: unknown): string | null {
	if (typeof raw !== "string") return null;
	const text = raw.normalize("NFC").replace(/\s+/g, " ").trim();
	if (text === "" || [...text].length > RULE_LIMITS.condition) return null;
	return text;
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it refuses
const NOT_IN_AN_ADDRESS = /[\s\u0000-\u001f\u007f<>,;:"()[\]\\]/;

/** Whether something is one whole address: a local part, one `@`, a domain with a dot. */
export function isAddress(value: string): boolean {
	if (value.length > 254 || NOT_IN_AN_ADDRESS.test(value)) return false;
	const at = value.indexOf("@");
	if (at <= 0 || at !== value.lastIndexOf("@")) return false;
	return isDomain(value.slice(at + 1));
}

function isDomain(value: string): boolean {
	if (value === "" || value.length > 253 || NOT_IN_AN_ADDRESS.test(value)) return false;
	if (value.includes("@") || !value.includes(".")) return false;
	return value.split(".").every((part) => part !== "");
}

/**
 * What a person gave as a sender to block, as it is stored: an address in lower case, or
 * `@domain` for everything at a domain (given as `example.com` or `@example.com`). `null`
 * when it is neither.
 */
export function blockedSenderOf(raw: unknown): string | null {
	if (typeof raw !== "string" || raw.length > FACT_LIMITS.address) return null;
	const text = fold(raw.trim());
	if (isAddress(text)) return text;
	const domain = text.startsWith("@") ? text.slice(1) : text;
	return isDomain(domain) ? `@${domain}` : null;
}

/** Whether a sender is blocked: its address is on the list, or its domain is. */
export function isBlocked(blocked: readonly string[], from: string): boolean {
	const address = fold(from);
	if (address === "") return false;
	const at = address.lastIndexOf("@");
	const domain = at === -1 ? null : address.slice(at);
	return blocked.some((one) => one === address || (domain !== null && one === domain));
}

// ── The facts of a message ─────────────────────────────────────────

/**
 * What the rules are told about a message. Built once, where the message was parsed, and cut
 * to `FACT_LIMITS`; the rules see nothing else of it.
 */
export interface MessageFacts {
	/** The address the message says it is from; the envelope sender when it could not be read. */
	from: string;
	/** The name beside that address. */
	fromName: string;
	/** The addresses in To and Cc. */
	recipients: string[];
	subject: string;
	/** The text of the message, from its start. */
	text: string;
	hasAttachment: boolean;
	/** The value of `Auto-Submitted`, when the message has the field. */
	autoSubmitted: string | null;
	/** Whether the message says it is from a list, or is bulk mail. */
	list: boolean;
}

const cut = (text: unknown, length: number): string =>
	typeof text === "string" ? text.slice(0, length) : "";

/** The facts of a message, each cut to its limit. Anything that is not text is empty. */
export function factsOf(raw: {
	from?: unknown;
	fromName?: unknown;
	recipients?: unknown;
	subject?: unknown;
	text?: unknown;
	hasAttachment?: unknown;
	autoSubmitted?: unknown;
	list?: unknown;
}): MessageFacts {
	const recipients = Array.isArray(raw.recipients) ? raw.recipients : [];
	return {
		from: fold(cut(raw.from, FACT_LIMITS.address)),
		fromName: cut(raw.fromName, FACT_LIMITS.name),
		recipients: recipients
			.filter((one): one is string => typeof one === "string" && one !== "")
			.slice(0, FACT_LIMITS.recipients)
			.map((one) => fold(cut(one, FACT_LIMITS.address))),
		subject: cut(raw.subject, FACT_LIMITS.subject),
		text: cut(raw.text, FACT_LIMITS.text),
		hasAttachment: raw.hasAttachment === true,
		autoSubmitted:
			typeof raw.autoSubmitted === "string" ? cut(raw.autoSubmitted, FACT_LIMITS.name) : null,
		list: raw.list === true,
	};
}

// ── The outcome ────────────────────────────────────────────────────

/** What the rules decide for a message. */
export interface Outcome {
	place: "inbox" | RulePlace;
	read: boolean;
	starred: boolean;
	/** Label ids, each once. */
	labels: string[];
	/** Whether the sender is blocked. */
	blocked: boolean;
	/** Rules that matched. */
	matched: number;
	/** Rules that could not be evaluated: skipped, and counted. */
	skipped: number;
}

/** When rules disagree about the place: Trash wins over Spam, and Spam over Archive. */
const WEIGHT: Record<Outcome["place"], number> = { inbox: 0, archive: 1, spam: 2, trash: 3 };

const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** A stored text of a condition, folded; `null` when it is not one. */
function needle(value: unknown): string | null {
	if (typeof value !== "string" || value === "" || value.length > RULE_LIMITS.condition * 4) {
		return null;
	}
	return fold(value);
}

/** What a message is compared as: every field folded once. */
interface Folded {
	from: string;
	fromName: string;
	recipients: string[];
	subject: string;
	/** The subject and the text, for "contains the words". */
	all: string;
	hasAttachment: boolean;
}

/**
 * Whether an address condition holds; `null` when it cannot be evaluated. "Is" is asked of
 * the addresses alone; "contains" also of a name beside them.
 */
function addressHolds(
	condition: unknown,
	addresses: readonly string[],
	names: readonly string[] = [],
): boolean | null {
	if (!isObject(condition)) return null;
	const value = needle(condition.value);
	if (value === null) return null;
	if (condition.match === "is") return addresses.some((one) => one === value);
	if (condition.match === "contains") {
		return [...addresses, ...names].some((one) => one.includes(value));
	}
	return null;
}

/**
 * Whether every condition of a rule holds; `null` when the rule cannot be evaluated: it has
 * no condition, one it does not know, or one that is not what its field takes.
 */
function holds(conditions: unknown, message: Folded): boolean | null {
	if (!isObject(conditions)) return null;
	const keys = Object.keys(conditions).filter((key) => conditions[key] !== undefined);
	if (keys.length === 0) return null;
	let all = true;
	for (const key of keys) {
		let one: boolean | null;
		if (key === "from") one = addressHolds(conditions.from, [message.from], [message.fromName]);
		else if (key === "to") one = addressHolds(conditions.to, message.recipients);
		else if (key === "subject") {
			const value = needle(conditions.subject);
			one = value === null ? null : message.subject.includes(value);
		} else if (key === "words") {
			const value = needle(conditions.words);
			const words = value === null ? [] : value.split(/\s+/).filter((word) => word !== "");
			one = words.length === 0 ? null : words.every((word) => message.all.includes(word));
		} else if (key === "hasAttachment") {
			one = conditions.hasAttachment === true ? message.hasAttachment : null;
		} else one = null;
		if (one === null) return null;
		all = all && one;
	}
	return all;
}

/** The actions of a rule as far as they are known; `null` when there is none to apply. */
function actionsOf(actions: unknown): RuleActions | null {
	if (!isObject(actions)) return null;
	const place = RULE_PLACES.find((one) => one === actions.place);
	if (actions.place !== undefined && place === undefined) return null;
	const labels = Array.isArray(actions.labels)
		? actions.labels.filter((one): one is string => typeof one === "string")
		: [];
	if (
		place === undefined &&
		actions.read !== true &&
		actions.star !== true &&
		labels.length === 0
	) {
		return null;
	}
	return {
		...(place === undefined ? {} : { place }),
		...(actions.read === true ? { read: true as const } : {}),
		...(actions.star === true ? { star: true as const } : {}),
		...(labels.length > 0 ? { labels: labels.slice(0, RULE_LIMITS.labels) } : {}),
	};
}

const NOTHING: Folded = {
	from: "",
	fromName: "",
	recipients: [],
	subject: "",
	all: "",
	hasAttachment: false,
};

/**
 * A stored rule as it is shown, or `null` when it is not one the vocabulary knows: such a rule
 * is skipped when mail arrives, and is not offered to be changed either.
 */
export function shownRule(id: string, body: unknown): Rule | null {
	if (!isObject(body) || !isObject(body.conditions)) return null;
	const actions = actionsOf(body.actions);
	if (actions === null || holds(body.conditions, NOTHING) === null) return null;
	return { id, conditions: body.conditions as RuleConditions, actions };
}

/**
 * What the rules of a mailbox decide for a message (decisions 5 and 6): blocked senders
 * first, then every rule in order. All matching rules apply. It reads nothing but its
 * arguments and never throws: a rule that cannot be evaluated is skipped and counted.
 */
export function evaluate(
	blocked: readonly string[],
	rules: readonly unknown[],
	facts: MessageFacts,
): Outcome {
	const outcome: Outcome = {
		place: "inbox",
		read: false,
		starred: false,
		labels: [],
		blocked: false,
		matched: 0,
		skipped: 0,
	};
	const to = (place: Outcome["place"]) => {
		if (WEIGHT[place] > WEIGHT[outcome.place]) outcome.place = place;
	};
	let message: Folded;
	try {
		message = {
			from: fold(facts.from),
			fromName: fold(facts.fromName),
			recipients: facts.recipients.map(fold),
			subject: fold(facts.subject),
			all: `${fold(facts.subject)}\n${fold(facts.text)}`,
			hasAttachment: facts.hasAttachment === true,
		};
		if (isBlocked(blocked, message.from)) {
			outcome.blocked = true;
			to("spam");
		}
	} catch {
		// Facts that are not facts: nothing can be matched, and the message stays in the Inbox.
		outcome.skipped = rules.length;
		return outcome;
	}
	const labels = new Set<string>();
	for (const rule of rules) {
		try {
			const one = isObject(rule) ? rule : {};
			const matches = holds(one.conditions, message);
			const actions = actionsOf(one.actions);
			if (matches === null || actions === null) {
				outcome.skipped += 1;
				continue;
			}
			if (!matches) continue;
			outcome.matched += 1;
			if (actions.place !== undefined) to(actions.place);
			if (actions.read === true) outcome.read = true;
			if (actions.star === true) outcome.starred = true;
			for (const label of actions.labels ?? []) {
				if (labels.size < FACT_LIMITS.labels) labels.add(label);
			}
		} catch {
			outcome.skipped += 1;
		}
	}
	outcome.labels = [...labels];
	return outcome;
}

// ── The automatic reply ────────────────────────────────────────────

/**
 * The automatic reply of a mailbox: one object, with the names JMAP gives it (RFC 8621,
 * section 8), so that a mail app later reads it as it stands.
 */
export interface AutoReply {
	isEnabled: boolean;
	/** From when it answers: an instant in UTC, or `null` for at once. */
	fromDate: string | null;
	/** Until when it answers: an instant in UTC, or `null` for until it is turned off. */
	toDate: string | null;
	subject: string | null;
	textBody: string | null;
	htmlBody: string | null;
}

/** What `GET …/auto-reply` answers: the object, and whether the mailbox would answer now. */
export interface AutoReplyAnswer extends AutoReply {
	/**
	 * The person who turned it on may no longer change it (they are no longer an owner, or
	 * their account was recovered since), so nothing is answered until an owner saves it again.
	 */
	stopped: boolean;
}

const DAY_MS = 24 * 60 * 60_000;

export const AUTO_REPLY = {
	/** Characters of the subject. */
	subject: 200,
	/** Characters of the text. */
	text: 10_000,
	/** Characters of the HTML body. */
	html: 50_000,
	/** One sender is answered once in this long (RFC 3834: seven days). */
	oncePerSenderMs: 7 * DAY_MS,
	/** The reply's own caps, below the mailbox's 20 in an hour and 100 in a day (decision 10). */
	perHour: 10,
	perDay: 50,
	/** The subject of a reply whose object names none. */
	defaultSubject: "Automatic reply",
	/** The header field that marks it, and its value (RFC 3834, section 5). */
	header: "Auto-Submitted",
	headerValue: "auto-replied",
} as const;

export const NO_AUTO_REPLY: AutoReply = {
	isEnabled: false,
	fromDate: null,
	toDate: null,
	subject: null,
	textBody: null,
	htmlBody: null,
};

const hasText = (value: string | null): boolean => value !== null && value.trim() !== "";

/** Whether the reply answers at `now`: enabled, inside its dates, and with something to say. */
export function answersAt(reply: AutoReply, now: number): boolean {
	if (reply.isEnabled !== true) return false;
	if (!hasText(reply.textBody) && !hasText(reply.htmlBody)) return false;
	if (reply.fromDate !== null) {
		const from = Date.parse(reply.fromDate);
		if (Number.isNaN(from) || now < from) return false;
	}
	if (reply.toDate !== null) {
		const until = Date.parse(reply.toDate);
		if (Number.isNaN(until) || now >= until) return false;
	}
	return true;
}

/** Why no reply is owed. */
export type NoReply =
	/** It is off, outside its dates, or has nothing to say. */
	| "off"
	/** The message was filed in Spam or Trash, or its sender is blocked. */
	| "filed_away"
	/** The message says it was sent by a program (`Auto-Submitted` other than `no`). */
	| "automatic"
	/** The message says it is from a list, or is bulk mail. */
	| "list"
	/** The mailbox's address is neither in To nor in Cc. */
	| "not_addressed"
	/** There is no envelope sender to answer: a bounce, a program's address, or the mailbox itself. */
	| "no_sender"
	/** This sender was answered within seven days. */
	| "recent"
	/** The reply's own caps, or the mailbox's, are full. */
	| "cap";

export interface ReplyQuestion {
	reply: AutoReply;
	now: number;
	/** The mailbox's own address. */
	mailbox: string;
	/** The envelope sender of the message: the only address a reply goes to. */
	envelopeFrom: string;
	/**
	 * The mailbox the envelope sender would be delivered to, by the step that routes incoming
	 * mail (`name+tag@domain` is `name@domain`), or `null` when it would be delivered nowhere.
	 * A reply to the mailbox itself, under any tag, is never owed.
	 */
	envelopeRoutesTo: string | null;
	facts: Pick<MessageFacts, "recipients" | "autoSubmitted" | "list">;
	outcome: Pick<Outcome, "place" | "blocked">;
	/**
	 * The mailbox's blocked senders. The outcome says whether the address in `From` is one;
	 * the reply goes to the envelope sender, so that address is asked of the list as well.
	 */
	blocked: readonly string[];
	/** When this sender was last answered, in milliseconds, or `null` for never. */
	lastAnsweredAt: number | null;
	/** Replies made in the last hour and the last day. */
	lastHour: number;
	lastDay: number;
	/** Whether the mailbox may take one more message to send. */
	room: boolean;
}

/**
 * The local parts that are programs and lists, which are never answered (RFC 3834,
 * section 2): `owner-…`, `…-request` and `MAILER-DAEMON`.
 */
function isProgram(local: string): boolean {
	return local === "mailer-daemon" || local.startsWith("owner-") || local.endsWith("-request");
}

/** The first token of an `Auto-Submitted` value: what stands before a `;` or a comment. */
function autoToken(value: string): string {
	return (
		fold(value)
			.replace(/\([^)]*\)/g, " ")
			.split(";")[0]
			?.trim() ?? ""
	);
}

/**
 * The envelope sender as it is answered and remembered: one form, so that the address a reply
 * goes to and the address the seven days are counted for are always the same text.
 */
export function replySender(envelopeFrom: string): string {
	return fold(envelopeFrom.trim());
}

/**
 * Whether the automatic reply is owed for a message, and to whom (decision 9; RFC 3834).
 * The answer is the envelope sender and nothing else, or the first reason there is no reply.
 */
export function replyOwed(question: ReplyQuestion): { to: string } | { no: NoReply } {
	const { reply, now, facts, outcome } = question;
	if (!answersAt(reply, now)) return { no: "off" };
	if (outcome.blocked || outcome.place === "spam" || outcome.place === "trash") {
		return { no: "filed_away" };
	}
	if (facts.autoSubmitted !== null && autoToken(facts.autoSubmitted) !== "no") {
		return { no: "automatic" };
	}
	if (facts.list) return { no: "list" };
	const mailbox = fold(question.mailbox.trim());
	if (mailbox === "" || !facts.recipients.some((one) => fold(one) === mailbox)) {
		return { no: "not_addressed" };
	}
	const to = replySender(question.envelopeFrom);
	if (
		!isAddress(to) ||
		to === mailbox ||
		(question.envelopeRoutesTo !== null && fold(question.envelopeRoutesTo) === mailbox) ||
		isProgram(to.slice(0, to.indexOf("@")))
	) {
		return { no: "no_sender" };
	}
	if (isBlocked(question.blocked, to)) return { no: "filed_away" };
	if (
		question.lastAnsweredAt !== null &&
		now - question.lastAnsweredAt < AUTO_REPLY.oncePerSenderMs
	) {
		return { no: "recent" };
	}
	if (
		!question.room ||
		question.lastHour >= AUTO_REPLY.perHour ||
		question.lastDay >= AUTO_REPLY.perDay
	) {
		return { no: "cap" };
	}
	return { to };
}
