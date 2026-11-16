// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified by the Podbay contributors.

/**
 * Email sending via Cloudflare Email Service binding.
 *
 * Uses the `send_email` Worker binding (`env.EMAIL.send()`) to send emails.
 *
 * See: https://developers.cloudflare.com/email-service/api/send-emails/workers-api/
 */

export interface SendEmailParams {
	to: string | string[];
	from: string | { email: string; name: string };
	subject: string;
	html?: string;
	text?: string;
	cc?: string | string[];
	bcc?: string | string[];
	replyTo?: string | { email: string; name: string };
	attachments?: {
		content: string; // base64 encoded
		filename: string;
		type: string;
		disposition: "attachment" | "inline";
		contentId?: string;
	}[];
	headers?: Record<string, string>;
}

/**
 * An inline part must carry a content id, and a regular attachment must not. An inline part
 * that arrives without one is sent as a regular attachment rather than refused.
 */
function toAttachment(att: NonNullable<SendEmailParams["attachments"]>[number]): EmailAttachment {
	const base = { filename: att.filename, type: att.type, content: att.content };
	return att.disposition === "inline" && att.contentId
		? { ...base, disposition: "inline", contentId: att.contentId }
		: { ...base, disposition: "attachment" };
}

/**
 * Send an email using the Cloudflare Email Service binding.
 *
 * @param binding  - The `EMAIL` SendEmail binding from env
 * @param params   - Email parameters (to, from, subject, body, etc.)
 * @returns The send result with messageId
 * @throws On validation or delivery errors (error has `.code` property)
 */
export async function sendEmail(
	binding: SendEmail,
	params: SendEmailParams,
): Promise<{ messageId: string }> {
	const message: EmailMessageBuilder = {
		to: params.to,
		from: params.from,
		subject: params.subject,
		...(params.html ? { html: params.html } : {}),
		...(params.text ? { text: params.text } : {}),
		...(params.cc ? { cc: params.cc } : {}),
		...(params.bcc ? { bcc: params.bcc } : {}),
		...(params.replyTo ? { replyTo: params.replyTo } : {}),
		...(params.headers && Object.keys(params.headers).length > 0
			? { headers: params.headers }
			: {}),
		...(params.attachments && params.attachments.length > 0
			? {
					attachments: params.attachments.map(toAttachment),
				}
			: {}),
	};

	const result = await binding.send(message);
	return { messageId: result.messageId };
}
