// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified by the Podbay contributors.

import { MagnifyingGlassIcon, StarIcon } from "@phosphor-icons/react";
import { useParams, useSearch } from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";
import MailView from "~/components/MailView";
import MessageList from "~/components/MessageList";
import { parseSearchQuery } from "~/lib/search-parser";
import { SEARCH_PAGE_SIZE, useSearchEmails } from "~/queries/search";

function highlightTerms(text: string, query: string): React.ReactNode {
	if (!query || !text) return text;
	const freeText = query
		.replace(/\b(?:from|to|subject|in|is|has|before|after):"[^"]*"/gi, "")
		.replace(/\b(?:from|to|subject|in|is|has|before|after):\S+/gi, "")
		.trim();
	if (!freeText) return text;
	try {
		const escaped = freeText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const regex = new RegExp(`(${escaped})`, "gi");
		const parts = text.split(regex);
		if (parts.length === 1) return text;
		// Use case-insensitive string comparison instead of regex.test() with g flag,
		// which has stateful lastIndex causing alternating true/false results.
		const lowerEscaped = escaped.toLowerCase();
		return parts.map((part, i) =>
			part.toLowerCase() === lowerEscaped ? (
				<mark key={i} className="bg-kumo-warning-muted text-kumo-default rounded-sm px-0.5">
					{part}
				</mark>
			) : (
				part
			),
		);
	} catch {
		return text;
	}
}

export default function SearchResultsRoute() {
	const { mailboxId } = useParams({ strict: false });
	const search = useSearch({ strict: false }) as { q?: string };
	const urlQuery = search.q ?? "";
	const [page, setPage] = useState(1);
	const starred = urlQuery.trim() === "is:starred";
	// A search that is only a label is that label's list.
	const asked = parseSearchQuery(urlQuery);
	const labelOnly =
		asked.label !== undefined && urlQuery.trim().startsWith("label:") && asked.query === ""
			? asked.label
			: null;

	// A different search starts on its first page.
	// biome-ignore lint/correctness/useExhaustiveDependencies: the search is the trigger
	useEffect(() => {
		setPage(1);
	}, [mailboxId, urlQuery]);

	const { data: searchData, isLoading } = useSearchEmails(mailboxId, urlQuery, page);

	return (
		<MailView emails={searchData?.results ?? []}>
			<MessageList
				title={
					starred ? "Starred" : labelOnly ? `Label ${labelOnly}` : `Search results for ${urlQuery}`
				}
				emails={searchData?.results ?? []}
				totalCount={searchData?.totalCount ?? 0}
				page={page}
				setPage={setPage}
				pageSize={SEARCH_PAGE_SIZE}
				isLoading={isLoading}
				highlight={starred ? undefined : (text) => highlightTerms(text, urlQuery)}
				showFolder
				empty={
					<div className="flex flex-col items-center justify-center py-24 px-6 text-center">
						<div className="mb-4">
							{starred ? (
								<StarIcon size={48} weight="thin" className="text-kumo-subtle" />
							) : (
								<MagnifyingGlassIcon size={48} weight="thin" className="text-kumo-subtle" />
							)}
						</div>
						<h2 className="text-base font-semibold text-kumo-default mb-1.5">
							{starred ? "Nothing is starred" : "No results found"}
						</h2>
						<p className="text-sm text-kumo-subtle max-w-xs">
							{starred
								? "Star a conversation to find it here again."
								: urlQuery
									? `Nothing matched "${urlQuery}". Try different words.`
									: "Type something to search by subject, sender or content."}
						</p>
						{!starred && urlQuery && (
							<p className="text-xs text-kumo-subtle mt-3 max-w-sm">
								You can narrow a search with{" "}
								<code className="bg-kumo-tint px-1 rounded">from:name</code>,{" "}
								<code className="bg-kumo-tint px-1 rounded">is:unread</code>,{" "}
								<code className="bg-kumo-tint px-1 rounded">has:attachment</code> or{" "}
								<code className="bg-kumo-tint px-1 rounded">before:2026-01-01</code>.
							</p>
						)}
					</div>
				}
			/>
		</MailView>
	);
}
