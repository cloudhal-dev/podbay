// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { useQuery } from "@tanstack/react-query";
import api from "~/services/api";
import { queryKeys } from "./keys";

/** Instance configuration: domains, allowed addresses and which optional features are on. */
export function useConfig() {
	return useQuery({
		queryKey: queryKeys.config,
		queryFn: () => api.getConfig(),
		staleTime: 5 * 60_000,
	});
}

/** Optional features; everything is off until the configuration has loaded. */
export function useFeatures(): { agent: boolean; mcp: boolean } {
	const { data } = useConfig();
	return data?.features ?? { agent: false, mcp: false };
}
