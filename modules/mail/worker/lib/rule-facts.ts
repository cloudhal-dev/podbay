// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * What the rules of a mailbox are told about a message that was parsed (ADR-0008, decisions 2
 * and 9). The message is a stranger's bytes: everything taken from it here is text, cut to a
 * fixed length by `factsOf`, and is compared later and never run.
 *
 * Pure: no binding and no storage.
 */
import type { Email } from "postal-mime";
import { plainTextOf } from "../../shared/html-text";
import { FACT_LIMITS, factsOf, type MessageFacts } from "../../shared/rules";

/** A header field of a list (RFC 2369, RFC 2919): a message that has one came through a list. */
const LIST_FIELD = /^list-(id|unsubscribe|unsubscribe-post|post|help|subscribe|owner|archive)$/;
/** The values of `Precedence` that mean bulk mail (RFC 3834, section 2). */
const BULK = ["bulk", "list", "junk"];

type Addresses = Email["to"];

/** Every address of a field; a group gives the addresses of its members. */
function addressesOf(list: Addresses): string[] {
	const found: string[] = [];
	for (const one of list ?? []) {
		if (typeof one.address === "string" && one.address !== "") found.push(one.address);
		for (const member of one.group ?? []) {
			if (typeof member.address === "string" && member.address !== "") found.push(member.address);
		}
	}
	return found;
}

/** The text of a message: its text part, or the text of its HTML when it has no other. */
function textOf(parsed: Email): string {
	if (typeof parsed.text === "string" && parsed.text !== "") {
		return parsed.text.slice(0, FACT_LIMITS.text);
	}
	// The HTML is cut before its text is taken, so a large body costs no more than a small one.
	const html = typeof parsed.html === "string" ? parsed.html.slice(0, FACT_LIMITS.text * 2) : "";
	return html === "" ? "" : plainTextOf(html);
}

export function factsOfParsed(parsed: Email): MessageFacts {
	const headers = parsed.headers ?? [];
	const field = (key: string) => headers.find((one) => one.key === key)?.value ?? null;
	const precedence = (field("precedence") ?? "").trim().toLowerCase();
	return factsOf({
		from: parsed.from?.address ?? "",
		fromName: parsed.from?.name ?? "",
		recipients: [...addressesOf(parsed.to), ...addressesOf(parsed.cc)],
		subject: parsed.subject ?? "",
		text: textOf(parsed),
		hasAttachment: (parsed.attachments ?? []).some((part) => part.disposition !== "inline"),
		autoSubmitted: field("auto-submitted"),
		list: headers.some((one) => LIST_FIELD.test(one.key)) || BULK.includes(precedence),
	});
}
