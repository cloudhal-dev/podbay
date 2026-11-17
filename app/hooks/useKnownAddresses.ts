// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { useQueryClient } from "@tanstack/react-query";
import { addressesOf, type Exchanged } from "~/lib/address-suggestions";

/**
 * The addresses this mailbox has exchanged mail with, as far as the lists already loaded in
 * this browser show them. It asks the Worker nothing: it is a convenience for writing, not an
 * address book, and it knows only what the person has already been shown. Mail in Spam and
 * Trash teaches it nothing.
 */
export function useKnownAddresses(mailboxId: string | undefined, own?: string): () => string[] {
	const queryClient = useQueryClient();
	return () => {
		if (!mailboxId) return [];
		const mail: Exchanged[] = [];
		for (const [, data] of queryClient.getQueriesData({ queryKey: ["emails", mailboxId] })) {
			const emails = Array.isArray(data)
				? data
				: ((data as { emails?: unknown } | undefined)?.emails ?? data);
			for (const email of Array.isArray(emails) ? emails : [emails]) {
				if (email !== null && typeof email === "object") mail.push(email as Exchanged);
			}
		}
		return addressesOf(mail, own);
	};
}
