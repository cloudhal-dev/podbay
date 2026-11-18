// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified by the Podbay contributors.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ListOrder } from "shared/list-order";
import { filterOf, filterParams } from "~/lib/search-filter";
import { parseSearchQuery } from "~/lib/search-parser";
import api from "~/services/api";
import type { Email } from "~/types";
import { defined } from "./defined";
import { queryKeys } from "./keys";

interface SearchResponse {
	emails: Email[];
	totalCount: number;
}

export function useSearchEmails(
	mailboxId: string | undefined,
	query: string,
	page: number,
	pageSize: number,
	order: ListOrder = "newest",
) {
	const queryClient = useQueryClient();
	return useQuery<{ results: Email[]; totalCount: number }>({
		queryKey:
			mailboxId && query
				? [...queryKeys.search.results(mailboxId, query, page), pageSize, order]
				: ["search", "_disabled"],
		queryFn: async () => {
			// A label is asked for by name and sent by id, so the labels are needed first.
			const labels =
				parseSearchQuery(query).label === undefined
					? []
					: await queryClient.ensureQueryData({
							queryKey: queryKeys.labels.list(defined(mailboxId)),
							queryFn: () => api.listLabels(defined(mailboxId)),
						});
			const params: Record<string, string> = {
				...filterParams(filterOf(query, labels)),
				page: String(page),
				limit: String(pageSize),
			};
			if (order !== "newest") params.order = order;

			const data = (await api.searchEmails(defined(mailboxId), params)) as SearchResponse | Email[];
			if (data && typeof data === "object" && "emails" in data) {
				return {
					results: (data as SearchResponse).emails ?? [],
					totalCount: (data as SearchResponse).totalCount ?? 0,
				};
			}
			const arr = Array.isArray(data) ? data : [];
			return { results: arr, totalCount: arr.length };
		},
		enabled: !!mailboxId && !!query,
	});
}
