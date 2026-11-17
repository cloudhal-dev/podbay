// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "~/services/api";
import type { AccessKey } from "~/types";
import { queryKeys } from "./keys";

/** The signed-in person's own keys for programs. A token is never part of this list. */
export function useAccessKeys() {
	return useQuery<AccessKey[]>({
		queryKey: queryKeys.accessKeys,
		queryFn: () => api.listKeys(),
	});
}

export function useCreateAccessKey() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: api.createKey,
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: queryKeys.accessKeys });
		},
	});
}

export function useRevokeAccessKey() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (keyId: string) => api.revokeKey(keyId),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: queryKeys.accessKeys });
		},
	});
}
