// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified by the Podbay contributors.

/**
 * Shared utility functions used across the frontend.
 *
 * Date formatting has been consolidated into `shared/dates.ts`.
 * Re-export for backwards compatibility with existing imports.
 */
import DOMPurify from "dompurify";
import { formatQuotedDate } from "shared/dates";
import { oneLineTextOf, plainTextOf } from "shared/html-text";
import { quoteLanguage, t } from "../i18n";

export {
	formatDetailDate,
	formatListDate,
	formatShortDate,
} from "shared/dates";

/** @deprecated Use `formatQuotedDate` from `shared/dates` directly. */
export const formatComposeDate = formatQuotedDate;

/**
 * Format a byte count as a human-readable file size.
 */
export function formatBytes(bytes: number, decimals = 1): string {
	if (bytes === 0) return "0 B";
	const k = 1024;
	const dm = decimals < 0 ? 0 : decimals;
	const sizes = ["B", "KB", "MB", "GB"];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return `${Number.parseFloat((bytes / k ** i).toFixed(dm))} ${sizes[i]}`;
}

/**
 * Split a comma-separated email field into individual addresses.
 */
export function splitEmailList(value?: string | null): string[] {
	return (value || "")
		.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean);
}

/**
 * Convert a list of addresses into the API payload format.
 */
export function toEmailListValue(addresses: string[]): string | string[] | undefined {
	if (addresses.length === 0) return undefined;
	return addresses.length === 1 ? addresses[0] : addresses;
}

/**
 * Convert HTML content to plain text, keeping line breaks between blocks.
 */
export function htmlToPlainText(html: string): string {
	// No DOM and no HTML injection: script and style content is never text, and each character
	// reference is decoded once (shared/html-text).
	return plainTextOf(html);
}

/**
 * Strip all HTML tags from a string.
 */
export function stripHtml(html: string): string {
	return oneLineTextOf(html);
}

export function getSnippetText(snippet?: string | null, maxLength = 100): string {
	if (!snippet) return "";

	// Never script or style content, even when the snippet is cut mid-element.
	const clean = oneLineTextOf(snippet);

	if (!clean) return "";
	return clean.length > maxLength ? `${clean.slice(0, maxLength)}...` : clean;
}

/**
 * Escape all five OWASP-recommended HTML special characters in plain text.
 * Safe for use in both text content and attribute contexts.
 */
export function escapeHtml(text: string): string {
	if (!text) return "";
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

/**
 * Generate the HTML signature block for compose forms.
 */
export function getSignatureBlock(settings?: {
	signature?: { enabled: boolean; text?: string; html?: string };
}): string {
	const sig = settings?.signature;
	if (sig?.enabled && (sig?.html || sig?.text)) {
		// Sanitize HTML signatures with DOMPurify to allow safe formatting
		// (bold, italic, links, etc.) while stripping scripts and event handlers.
		// Text signatures are HTML-escaped since they have no formatting.
		const content = sig.html ? DOMPurify.sanitize(sig.html) : escapeHtml(sig.text || "");
		return `<div style="border-top: 1px solid #ccc; margin-top: 16px; padding-top: 12px;">${content}</div>`;
	}
	return "";
}

/**
 * Build a quoted reply block HTML string from original email data.
 */
export function buildQuotedReplyBlock(
	dateStr: string | undefined,
	sender: string,
	body: string,
): string {
	if (!body) return "";
	const formattedDate = formatComposeDate(dateStr, quoteLanguage());

	// HTML-escape sender to prevent <john@example.com> from disappearing as a tag
	const escapedSender = escapeHtml(sender);

	// Sanitize the body to plain text to prevent stored XSS.
	// The original HTML renders safely in the sandboxed iframe, but quoted
	// reply blocks are injected into the compose editor where raw HTML would
	// execute. Convert to escaped plain text instead.
	const bodyToQuote = escapeHtml(stripHtml(body)).replace(/\n/g, "<br>");

	return `<br><blockquote style="border-left: 2px solid #ccc; margin: 0; padding-left: 1em; color: #666;">${t("On {date}, {sender} wrote:", { date: formattedDate, sender: escapedSender })}<br><br>${bodyToQuote}</blockquote>`;
}

export function downloadFile(url: string, filename: string) {
	const link = document.createElement("a");
	link.href = url;
	link.download = filename;
	link.target = "_blank";
	link.rel = "noopener noreferrer";
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
}
