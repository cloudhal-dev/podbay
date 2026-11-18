// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AutoReply, AutoReplyAnswer, Rule, RulesAnswer } from "shared/rules";
import api from "~/services/api";
import { queryKeys } from "./keys";

/** A filter as the app sends it: one that is new has no id yet. */
export type RuleDraft = Omit<Rule, "id"> & { id?: string };

/** The filters of a mailbox, in their order, and its blocked senders (ADR-0008). */
export function useRules(mailboxId: string | undefined, enabled = true) {
	return useQuery<RulesAnswer>({
		queryKey: mailboxId ? queryKeys.rules.list(mailboxId) : ["rules", "_disabled"],
		queryFn: () => api.getRules(mailboxId ?? ""),
		enabled: !!mailboxId && enabled,
	});
}

/** Replaces the filters with a list, in its order. The mailbox answers what it holds now. */
export function useSaveRules() {
	const client = useQueryClient();
	return useMutation({
		mutationFn: ({ mailboxId, rules }: { mailboxId: string; rules: RuleDraft[] }) =>
			api.saveRules(mailboxId, rules),
		onSuccess: (answer, { mailboxId }) => {
			client.setQueryData(queryKeys.rules.list(mailboxId), answer);
		},
	});
}

export function useBlockSender() {
	const client = useQueryClient();
	return useMutation({
		mutationFn: ({
			mailboxId,
			sender,
			kind,
		}: {
			mailboxId: string;
			sender: string;
			kind?: "address" | "domain";
		}) => api.blockSender(mailboxId, sender, kind),
		onSuccess: (_data, { mailboxId }) =>
			client.invalidateQueries({ queryKey: queryKeys.rules.list(mailboxId), exact: true }),
	});
}

export function useUnblockSender() {
	const client = useQueryClient();
	return useMutation({
		mutationFn: ({ mailboxId, sender }: { mailboxId: string; sender: string }) =>
			api.unblockSender(mailboxId, sender),
		onSuccess: (_data, { mailboxId }) =>
			client.invalidateQueries({ queryKey: queryKeys.rules.list(mailboxId), exact: true }),
	});
}

/** The automatic reply of a mailbox. */
export function useAutoReply(mailboxId: string | undefined) {
	return useQuery<AutoReplyAnswer>({
		queryKey: mailboxId ? queryKeys.rules.autoReply(mailboxId) : ["rules", "_disabled", "reply"],
		queryFn: () => api.getAutoReply(mailboxId ?? ""),
		enabled: !!mailboxId,
	});
}

/** Saves the automatic reply. The Worker asks for fresh proof: run it through `useFreshProof`. */
export function useSaveAutoReply() {
	const client = useQueryClient();
	return useMutation({
		mutationFn: ({ mailboxId, reply }: { mailboxId: string; reply: AutoReply }) =>
			api.saveAutoReply(mailboxId, reply),
		onSuccess: (answer, { mailboxId }) => {
			client.setQueryData(queryKeys.rules.autoReply(mailboxId), answer);
		},
	});
}
