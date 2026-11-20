// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Inbound routing. A message is filed by its SMTP envelope recipient, never by the `To:` header:
 * the header is written by the sender, is absent for Bcc, and names the list for list mail.
 */

/** The part of an inbound message that routing needs. `ForwardableEmailMessage` satisfies it. */
export interface InboundEnvelope {
	/** Envelope sender (MAIL FROM). */
	readonly from: string;
	/** Envelope recipient (RCPT TO). */
	readonly to: string;
	/** The header fields of the message, as the platform gives them. */
	readonly headers?: Headers;
	readonly raw: ReadableStream;
	readonly rawSize: number;
	setReject(reason: string): void;
}

const LOCAL_PART = /^[a-z0-9][a-z0-9._%-]*$/;
const DOMAIN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

/**
 * The mailbox address an envelope recipient is delivered to: lower-cased, with a `+tag`
 * (subaddress, RFC 5233) removed. Returns null for anything that is not a plain address, so a
 * crafted recipient can never become part of a storage key.
 */
export function mailboxAddressFor(envelopeTo: string): string | null {
	const address = envelopeTo.trim().toLowerCase();
	if (address.length === 0 || address.length > 254) return null;
	const at = address.lastIndexOf("@");
	if (at <= 0 || at !== address.indexOf("@")) return null;
	const domain = address.slice(at + 1);
	const plus = address.indexOf("+");
	const local = plus > 0 && plus < at ? address.slice(0, plus) : address.slice(0, at);
	if (local.length > 64 || !LOCAL_PART.test(local) || !DOMAIN.test(domain)) return null;
	return `${local}@${domain}`;
}

export type InboundDecision =
	| { readonly deliver: true; readonly mailboxId: string }
	| { readonly deliver: false; readonly reason: string };

/**
 * Decide where an envelope recipient goes, before the message body is read.
 * `allowed` is the optional allow-list from configuration; `exists` says whether a mailbox is
 * registered for an address.
 */
export async function routeInbound(
	envelopeTo: string,
	allowed: readonly string[],
	exists: (mailboxId: string) => Promise<boolean>,
): Promise<InboundDecision> {
	const mailboxId = mailboxAddressFor(envelopeTo);
	if (mailboxId === null) return { deliver: false, reason: "Invalid recipient address" };
	const allowList = allowed.map((a) => a.toLowerCase());
	if (allowList.length > 0 && !allowList.includes(mailboxId)) {
		return { deliver: false, reason: "Unknown recipient" };
	}
	if (!(await exists(mailboxId))) return { deliver: false, reason: "Unknown recipient" };
	return { deliver: true, mailboxId };
}
