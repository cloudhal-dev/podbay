// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified by the Podbay contributors.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "~/services/api";
import type { Mailbox } from "~/types";
import { defined } from "./defined";
import { queryKeys } from "./keys";

export function useMailboxes() {
	return useQuery<Mailbox[]>({
		queryKey: queryKeys.mailboxes.all,
		queryFn: () => api.listMailboxes() as Promise<Mailbox[]>,
	});
}

export function useMailbox(mailboxId: string | undefined) {
	return useQuery<Mailbox>({
		queryKey: mailboxId ? queryKeys.mailboxes.detail(mailboxId) : ["mailboxes", "_disabled"],
		queryFn: () => api.getMailbox(defined(mailboxId)) as Promise<Mailbox>,
		enabled: !!mailboxId,
	});
}

export function useCreateMailbox() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ email, name }: { email: string; name: string }) =>
			api.createMailbox(email, name),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: queryKeys.mailboxes.all });
		},
	});
}

export function useUpdateMailbox() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ mailboxId, settings }: { mailboxId: string; settings: unknown }) =>
			api.updateMailbox(mailboxId, settings),
		// The save is over when the app holds what was saved: the two lists are read again before
		// the caller is told. Told earlier, a person who saved a signature and wrote at once got a
		// message without it.
		onSuccess: (_data, { mailboxId }) =>
			Promise.all([
				qc.invalidateQueries({ queryKey: queryKeys.mailboxes.detail(mailboxId) }),
				qc.invalidateQueries({ queryKey: queryKeys.mailboxes.all }),
			]),
	});
}

export function useDeleteMailbox() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (mailboxId: string) => api.deleteMailbox(mailboxId),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: queryKeys.mailboxes.all });
		},
	});
}
