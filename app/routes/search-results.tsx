// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified by the Podbay contributors.

import { MagnifyingGlassIcon, StarIcon } from "@phosphor-icons/react";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import MailView from "~/components/MailView";
import MessageList from "~/components/MessageList";
import { useDisplay } from "~/hooks/useDisplay";
import { m, t } from "~/i18n";
import { rich } from "~/i18n/rich";
import { filterOf } from "~/lib/search-filter";
import { hasOperator, parseSearchQuery, toggleOperator } from "~/lib/search-parser";
import { useLabels } from "~/queries/labels";
import { useSearchEmails } from "~/queries/search";

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
				// biome-ignore lint/suspicious/noArrayIndexKey: the pieces of one text in their order, made again whole for each text; the same word can be several of them
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

/** One press narrows the search on screen: each adds an operator to the query, or takes it out. */
const QUICK_FILTERS: readonly (readonly [string, string])[] = [
	["has:attachment", m("Has an attachment")],
	["is:unread", m("Unread")],
	["in:inbox", m("In the inbox")],
];

export default function SearchResultsRoute() {
	const { mailboxId } = useParams({ strict: false });
	const search = useSearch({ strict: false }) as { q?: string };
	const urlQuery = search.q ?? "";
	const [page, setPage] = useState(1);
	const navigate = useNavigate();
	const pageSize = useDisplay((state) => state.pageSize);
	const order = useDisplay((state) => state.order);
	const { data: labels = [] } = useLabels(mailboxId);
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
	}, [mailboxId, urlQuery, order]);

	const { data: searchData, isLoading } = useSearchEmails(
		mailboxId,
		urlQuery,
		page,
		pageSize,
		order,
	);

	return (
		<MailView emails={searchData?.results ?? []}>
			{!starred && (
				<div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-kumo-line px-4 py-2">
					<span className="text-xs text-kumo-subtle">{t("Narrow it down:")}</span>
					{QUICK_FILTERS.map(([operator, label]) => {
						const on = hasOperator(urlQuery, operator);
						return (
							<button
								key={operator}
								type="button"
								aria-pressed={on}
								onClick={() => {
									if (!mailboxId) return;
									void navigate({
										to: "/mailbox/$mailboxId/search",
										params: { mailboxId },
										search: { q: toggleOperator(urlQuery, operator) },
									});
								}}
								className={`cursor-pointer rounded-full border px-3 py-1 text-xs ${
									on
										? "border-kumo-brand bg-kumo-brand/10 font-semibold text-kumo-default"
										: "border-kumo-line bg-transparent text-kumo-strong hover:bg-kumo-tint"
								}`}
							>
								{t(label)}
							</button>
						);
					})}
				</div>
			)}
			<MessageList
				title={
					starred
						? t("Starred")
						: labelOnly
							? t("Label {name}", { name: labelOnly })
							: t("Search results for {query}", { query: urlQuery })
				}
				emails={searchData?.results ?? []}
				totalCount={searchData?.totalCount ?? 0}
				page={page}
				setPage={setPage}
				pageSize={pageSize}
				isLoading={isLoading}
				highlight={starred ? undefined : (text) => highlightTerms(text, urlQuery)}
				showFolder
				// The same filter the list was asked with, so "everything" is what the search finds.
				everything={
					urlQuery.trim() === ""
						? undefined
						: {
								filter: filterOf(urlQuery, labels),
								offer: t("Select everything this search finds"),
								chosen: t("Everything this search finds is selected."),
							}
				}
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
							{starred ? t("Nothing is starred") : t("No results found")}
						</h2>
						<p className="text-sm text-kumo-subtle max-w-xs">
							{starred
								? t("Star a conversation to find it here again.")
								: urlQuery
									? t('Nothing matched "{query}". Try different words.', { query: urlQuery })
									: t("Type something to search by subject, sender or content.")}
						</p>
						{!starred && urlQuery && (
							<p className="text-xs text-kumo-subtle mt-3 max-w-sm">
								{rich("You can narrow a search with {from}, {unread}, {attachment} or {before}.", {
									from: <code className="bg-kumo-tint px-1 rounded">from:name</code>,
									unread: <code className="bg-kumo-tint px-1 rounded">is:unread</code>,
									attachment: <code className="bg-kumo-tint px-1 rounded">has:attachment</code>,
									before: <code className="bg-kumo-tint px-1 rounded">before:2026-01-01</code>,
								})}
							</p>
						)}
					</div>
				}
			/>
		</MailView>
	);
}
