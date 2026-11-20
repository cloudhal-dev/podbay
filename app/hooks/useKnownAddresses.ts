// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { type KnownAddress, typedForCompletion } from "@podbay/mail/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { addressesOf, type Exchanged } from "~/lib/address-suggestions";
import api from "~/services/api";

/** Where the address field gets what it offers. */
export interface KnownSource {
	/**
	 * The addresses the mailbox has written to that what is typed could become, as the mailbox
	 * itself remembers them (ADR-0012): the first source. Empty when it cannot be asked.
	 */
	written: (typed: string, signal?: AbortSignal) => Promise<KnownAddress[]>;
	/** The addresses the lists loaded in this browser show: the second source. */
	loaded: () => string[];
	/** Has the mailbox forget one of its addresses, and stops offering it here. */
	forget: (one: KnownAddress) => Promise<void>;
	/** The addresses forgotten while this message is written, in lower case. */
	forgotten: ReadonlySet<string>;
}

/**
 * The addresses to offer while one is typed. The mailbox remembers whom it has written to and
 * is asked while a person types; what it answers is kept in memory only, for as long as the
 * message is written. The lists already loaded in this browser stay a second source: they
 * know only what the person has been shown, and mail in Spam and Trash teaches them nothing.
 */
export function useKnownAddresses(mailboxId: string | undefined, own?: string): KnownSource {
	const queryClient = useQueryClient();
	return useMemo(() => {
		const answers = new Map<string, KnownAddress[]>();
		const forgotten = new Set<string>();
		return {
			forgotten,
			async written(typed, signal) {
				const wanted = typedForCompletion(typed)?.toLowerCase();
				if (!mailboxId || wanted === undefined) return [];
				const kept = answers.get(wanted);
				if (kept !== undefined) return kept;
				try {
					const { addresses } = await api.completeAddress(mailboxId, wanted, { signal });
					answers.set(wanted, addresses);
					return addresses;
				} catch {
					// Not asked for by a reader, or no answer: the loaded lists still offer theirs.
					return [];
				}
			},
			loaded() {
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
			},
			async forget(one) {
				if (!mailboxId) return;
				await api.forgetKnownAddress(mailboxId, one.id);
				forgotten.add(one.address.toLowerCase());
				answers.clear();
			},
		};
	}, [mailboxId, own, queryClient]);
}
