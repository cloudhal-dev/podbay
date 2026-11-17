// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { useMutation, useQuery } from "@tanstack/react-query";
import api from "~/services/api";
import type { Label } from "~/types";
import { useInvalidateEmailData } from "./emails";
import { queryKeys } from "./keys";

/** The labels of a mailbox, in name order (ADR-0007). */
export function useLabels(mailboxId: string | undefined) {
	return useQuery<Label[]>({
		queryKey: mailboxId ? queryKeys.labels.list(mailboxId) : ["labels", "_disabled"],
		queryFn: () => api.listLabels(mailboxId ?? ""),
		enabled: !!mailboxId,
	});
}

export function useCreateLabel() {
	const invalidate = useInvalidateEmailData();
	return useMutation({
		mutationFn: ({ mailboxId, name, color }: { mailboxId: string; name: string; color: number }) =>
			api.createLabel(mailboxId, { name, color }),
		onSuccess: (_data, { mailboxId }) => invalidate(mailboxId),
	});
}

export function useUpdateLabel() {
	const invalidate = useInvalidateEmailData();
	return useMutation({
		mutationFn: (change: { mailboxId: string; id: string; name?: string; color?: number }) =>
			api.updateLabel(change.mailboxId, change.id, { name: change.name, color: change.color }),
		onSuccess: (_data, { mailboxId }) => invalidate(mailboxId),
	});
}

export function useDeleteLabel() {
	const invalidate = useInvalidateEmailData();
	return useMutation({
		mutationFn: ({ mailboxId, id }: { mailboxId: string; id: string }) =>
			api.deleteLabel(mailboxId, id),
		onSuccess: (_data, { mailboxId }) => invalidate(mailboxId),
	});
}

/** Gives labels to, and takes labels from, the conversation a message belongs to. */
export function useLabelConversation() {
	const invalidate = useInvalidateEmailData();
	return useMutation({
		mutationFn: (change: { mailboxId: string; emailId: string; add: string[]; remove: string[] }) =>
			api.labelConversation(change.mailboxId, change.emailId, {
				add: change.add,
				remove: change.remove,
			}),
		onSuccess: (_data, { mailboxId }) => invalidate(mailboxId),
	});
}
