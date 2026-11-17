// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { useQueryClient } from "@tanstack/react-query";
import { splitEmailList } from "~/lib/utils";
import type { Email } from "~/types";

/**
 * The addresses this mailbox has exchanged mail with, as far as the lists already loaded in
 * this browser show them. It asks the Worker nothing: it is a convenience for writing, not an
 * address book, and it knows only what the person has already been shown.
 */
export function useKnownAddresses(mailboxId: string | undefined, own?: string): () => string[] {
	const queryClient = useQueryClient();
	return () => {
		if (!mailboxId) return [];
		const seen = new Map<string, string>();
		const add = (address: string | null | undefined) => {
			for (const one of splitEmailList(address)) {
				const key = one.toLowerCase();
				if (key !== own?.toLowerCase() && key.includes("@") && !seen.has(key)) seen.set(key, one);
			}
		};
		for (const [, data] of queryClient.getQueriesData({ queryKey: ["emails", mailboxId] })) {
			const emails = Array.isArray(data)
				? data
				: ((data as { emails?: unknown } | undefined)?.emails ?? data);
			for (const email of Array.isArray(emails) ? (emails as Partial<Email>[]) : [emails]) {
				if (email === null || typeof email !== "object") continue;
				const one = email as Partial<Email>;
				add(one.sender);
				add(one.recipient);
				add(one.cc);
				add(one.participants);
			}
		}
		return [...seen.values()].sort((a, b) => a.localeCompare(b));
	};
}
