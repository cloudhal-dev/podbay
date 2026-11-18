// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified by the Podbay contributors.

/** Centralised query key factories for cache invalidation. */
export const queryKeys = {
	mailboxes: {
		all: ["mailboxes"] as const,
		detail: (id: string) => ["mailboxes", id] as const,
	},
	emails: {
		list: (mailboxId: string, params: Record<string, string>) =>
			["emails", mailboxId, params] as const,
		detail: (mailboxId: string, emailId: string) => ["emails", mailboxId, emailId] as const,
		thread: (mailboxId: string, threadId: string) =>
			["emails", mailboxId, "thread", threadId] as const,
		original: (mailboxId: string, emailId: string) =>
			["emails", mailboxId, "original", emailId] as const,
	},
	folders: {
		list: (mailboxId: string) => ["folders", mailboxId] as const,
	},
	labels: {
		list: (mailboxId: string) => ["labels", mailboxId] as const,
	},
	rules: {
		list: (mailboxId: string) => ["rules", mailboxId] as const,
		autoReply: (mailboxId: string) => ["rules", mailboxId, "auto-reply"] as const,
	},
	search: {
		results: (mailboxId: string, query: string, page: number) =>
			["search", mailboxId, query, page] as const,
	},
	config: ["config"] as const,
	accessKeys: ["access-keys"] as const,
	members: {
		list: (mailboxId: string) => ["members", mailboxId] as const,
		history: (mailboxId: string) => ["members", mailboxId, "history"] as const,
	},
	registry: ["registry"] as const,
};
