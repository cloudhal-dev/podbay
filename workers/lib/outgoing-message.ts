// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * A message between the press and the handover (ADR-0016). A send route writes a message into
 * rows (`headerList`, with the route's own fields); the mailbox reads it back from those rows
 * when it leaves (`fromStored`). Nothing of a request reaches the handover, so a row holds
 * everything the sending service is given: one body, from which the text form is made again.
 *
 * Pure functions: no binding and no storage.
 */
import { plainTextOf } from "../../shared/html-text";
import { AUTO_REPLY } from "../../shared/rules";
import { MAX_ATTACHMENTS, MAX_MESSAGE_BYTES, MAX_RECIPIENTS } from "../../shared/sending-limits";
import type { SendEmailParams } from "../email-sender";
import { buildThreadingHeaders } from "./email-helpers";

/** The key of the field that marks an automatic reply, as a stored header list has it. */
const AUTOMATIC = AUTO_REPLY.header.toLowerCase();

/** Who a message is from, as a request gives it. */
export type From = string | { email: string; name: string };

export interface Header {
	key: string;
	value: string;
}

const listed = (field: string | string[]): string =>
	Array.isArray(field) ? field.join(", ") : field;

/** The header list a stored message keeps. The service sets `Message-ID` and `Date` itself. */
export function headerList(message: {
	from: From;
	to: string | string[];
	cc?: string | string[];
	bcc?: string | string[];
	subject: string;
	date: string;
	messageId: string;
	inReplyTo: string | null;
	references: readonly string[];
	/** Mail the mailbox sends by itself (ADR-0008): marked, so that no program answers it. */
	automatic?: true;
}): string {
	const { from, cc, bcc, inReplyTo, references } = message;
	const headers: Header[] = [
		{ key: "from", value: typeof from === "string" ? from : `${from.name} <${from.email}>` },
		{ key: "to", value: listed(message.to) },
		...(cc ? [{ key: "cc", value: listed(cc) }] : []),
		...(bcc ? [{ key: "bcc", value: listed(bcc) }] : []),
		{ key: "subject", value: message.subject },
		{ key: "date", value: message.date },
		{ key: "message-id", value: `<${message.messageId}>` },
		...(inReplyTo ? [{ key: "in-reply-to", value: `<${inReplyTo}>` }] : []),
		...(references.length > 0
			? [{ key: "references", value: references.map((one) => `<${one}>`).join(" ") }]
			: []),
		...(message.automatic === true ? [{ key: AUTOMATIC, value: AUTO_REPLY.headerValue }] : []),
	];
	return JSON.stringify(headers);
}

/** A stored message, as far as the handover reads it. */
export interface StoredMessage {
	subject: string | null;
	sender: string | null;
	recipient: string | null;
	cc: string | null;
	bcc: string | null;
	body: string | null;
	in_reply_to: string | null;
	email_references: string | null;
	raw_headers: string | null;
}

function headerOf(headers: string | null, key: string): string | null {
	if (headers === null) return null;
	try {
		const list = JSON.parse(headers) as Header[];
		return list.find((one) => one.key === key)?.value ?? null;
	} catch {
		return null;
	}
}

/** The name a message is sent under is kept in its header list, before the address. */
export function fromOf(message: Pick<StoredMessage, "sender" | "raw_headers">): From {
	const email = message.sender ?? "";
	const written = headerOf(message.raw_headers, "from");
	const tail = ` <${email}>`;
	if (
		written !== null &&
		written.length > tail.length &&
		written.toLowerCase().endsWith(tail.toLowerCase())
	) {
		return { email, name: written.slice(0, -tail.length) };
	}
	return email;
}

const addresses = (field: string | null): string[] =>
	(field ?? "")
		.split(",")
		.map((one) => one.trim())
		.filter((one) => one !== "");

function referencesOf(stored: string | null): string[] {
	if (stored === null) return [];
	try {
		const list: unknown = JSON.parse(stored);
		return Array.isArray(list) ? list.filter((one) => typeof one === "string") : [];
	} catch {
		return [];
	}
}

/**
 * Whether a stored message is mail the mailbox sends by itself (ADR-0008): its header list
 * says so, and only the automatic reply writes that. A send route never does, and a message
 * that is taken back to Drafts loses its header list.
 */
export function isAutomatic(message: Pick<StoredMessage, "raw_headers">): boolean {
	return headerOf(message.raw_headers, AUTOMATIC) !== null;
}

/** What the service is given for a stored message, without its files. */
export function fromStored(message: StoredMessage): SendEmailParams & { to: string[] } {
	const html = message.body ?? "";
	const cc = addresses(message.cc);
	const bcc = addresses(message.bcc);
	const headers: Record<string, string> = {
		...(message.in_reply_to
			? buildThreadingHeaders(message.in_reply_to, referencesOf(message.email_references))
			: {}),
		// RFC 3834: an automatic reply says that it is one, whatever else it carries.
		...(isAutomatic(message) ? { [AUTO_REPLY.header]: AUTO_REPLY.headerValue } : {}),
	};
	return {
		to: addresses(message.recipient),
		...(cc.length > 0 ? { cc } : {}),
		...(bcc.length > 0 ? { bcc } : {}),
		from: fromOf(message),
		subject: message.subject ?? "",
		html,
		text: plainTextOf(html),
		...(Object.keys(headers).length > 0 ? { headers } : {}),
	};
}

/** The size a file has on its way: it travels as base64, a third larger. */
export const travellingBytes = (size: number): number => Math.ceil((size * 4) / 3);

/**
 * Whether a message fits what the sending service takes (`shared/sending-limits.ts`): its
 * recipients, its files by count, and all of it by size.
 */
export function fits(
	message: Pick<SendEmailParams, "to" | "cc" | "bcc" | "html" | "text">,
	files: readonly { size: number }[],
): boolean {
	const count = (field: string | string[] | undefined) =>
		field === undefined ? 0 : Array.isArray(field) ? field.length : 1;
	const recipients = count(message.to) + count(message.cc) + count(message.bcc);
	if (recipients === 0 || recipients > MAX_RECIPIENTS) return false;
	if (files.length > MAX_ATTACHMENTS) return false;
	const encoder = new TextEncoder();
	const text =
		encoder.encode(message.html ?? "").length + encoder.encode(message.text ?? "").length;
	const carried = files.reduce((sum, file) => sum + travellingBytes(file.size), 0);
	return text + carried <= MAX_MESSAGE_BYTES;
}
