// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified by the Podbay contributors.

/**
 * Shared types and Zod schemas for email data.
 *
 * Types (from email-types.ts): used by the agent, MCP server, and route
 * handlers to avoid `as any` casting.
 *
 * Zod schemas: used across route handlers to eliminate duplication.
 */
import { z } from "zod";
import { MAX_MESSAGE_BYTES, MAX_RECIPIENTS, messageBytes } from "../../shared/sending-limits";

// ── TypeScript Interfaces ──────────────────────────────────────────

export interface EmailMetadata {
	id: string;
	subject: string;
	sender: string;
	recipient: string;
	cc?: string | null;
	bcc?: string | null;
	date: string;
	read: boolean;
	starred: boolean;
	in_reply_to?: string | null;
	email_references?: string | null;
	thread_id?: string | null;
	folder_id?: string | null;
	snippet?: string | null;
}

export interface EmailFull extends EmailMetadata {
	body?: string | null;
	message_id?: string | null;
	raw_headers?: string | null;
	attachments?: AttachmentInfo[];
}

export interface AttachmentInfo {
	id: string;
	filename: string;
	mimetype: string;
	size: number;
	content_id?: string | null;
	disposition?: string | null;
}

// ── Zod Schemas ────────────────────────────────────────────────────

const RecipientFieldSchema = z.union([z.string().email(), z.array(z.string().email()).min(1)]);

export const ErrorResponseSchema = z.object({
	error: z.string(),
});

export const SendEmailRequestSchema = z
	.object({
		to: RecipientFieldSchema,
		cc: RecipientFieldSchema.optional(),
		bcc: RecipientFieldSchema.optional(),
		from: z.union([z.string().email(), z.object({ email: z.string().email(), name: z.string() })]),
		subject: z.string(),
		html: z.string().optional(),
		text: z.string().optional(),
		/**
		 * The draft this message is sent from (ADR-0011). Its stored files are the message's
		 * files, and its row becomes the sent message. A message without files needs none.
		 */
		draft_id: z.string().max(128).optional(),
		in_reply_to: z.string().optional(),
		references: z.array(z.string()).optional(),
		thread_id: z.string().optional(),
	})
	.refine((data) => data.html || data.text, {
		message: "Either 'html' or 'text' must be provided",
	})
	.refine(
		(data) => {
			const count = (field: string | string[] | undefined) =>
				field === undefined ? 0 : Array.isArray(field) ? field.length : 1;
			return count(data.to) + count(data.cc) + count(data.bcc) <= MAX_RECIPIENTS;
		},
		{ message: `A message goes to at most ${MAX_RECIPIENTS} recipients` },
	)
	// The whole message, so that nothing is stored as sent that the sending service will refuse.
	.refine((data) => messageBytes(data) <= MAX_MESSAGE_BYTES, {
		message: "The message is too large to send",
	});

export const SendEmailResponseSchema = z.object({
	id: z.string(),
	status: z.string(),
});
