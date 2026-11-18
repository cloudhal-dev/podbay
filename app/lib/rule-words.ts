// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * A filter in words (ADR-0008): each condition and each action of a rule is one whole
 * message, so a language can order it as its grammar wants. Pure: no React and no request.
 */
import type { RuleActions, RuleConditions } from "shared/rules";
import { t } from "~/i18n";

/** What a filter looks for, one line for each condition. */
export function conditionWords(conditions: RuleConditions): string[] {
	const words: string[] = [];
	const { from, to, subject } = conditions;
	if (from) {
		words.push(
			from.match === "is"
				? t("The sender is {value}", { value: from.value })
				: t("The sender contains {value}", { value: from.value }),
		);
	}
	if (to) {
		words.push(
			to.match === "is"
				? t("A recipient is {value}", { value: to.value })
				: t("A recipient contains {value}", { value: to.value }),
		);
	}
	if (subject) words.push(t("The subject contains {value}", { value: subject }));
	if (conditions.words) {
		words.push(t("The message has the words {value}", { value: conditions.words }));
	}
	if (conditions.hasAttachment) words.push(t("It has an attachment"));
	return words;
}

/**
 * What a filter does, one line for each action. `labelName` gives the name of a label of the
 * mailbox, or nothing for one that is gone: a label that is gone is given to nothing.
 */
export function actionWords(
	actions: RuleActions,
	labelName: (id: string) => string | undefined,
): string[] {
	const words: string[] = [];
	if (actions.place === "archive") words.push(t("Skip the Inbox"));
	if (actions.place === "trash") words.push(t("Move to Trash"));
	if (actions.place === "spam") words.push(t("Move to Spam"));
	if (actions.read) words.push(t("Mark as read"));
	if (actions.star) words.push(t("Star it"));
	for (const id of actions.labels ?? []) {
		const name = labelName(id);
		if (name !== undefined) words.push(t("Label it {name}", { name }));
	}
	return words;
}

/** A blocked sender in words: an address, or everything at a domain. */
export function blockedWords(sender: string): string {
	return sender.startsWith("@") ? t("Everyone at {domain}", { domain: sender.slice(1) }) : sender;
}
