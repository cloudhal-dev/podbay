// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { Input, LayerDialog } from "@cloudflare/kumo";
import { type FormEvent, useEffect, useState } from "react";
import {
	buildSearchQuery,
	NO_SEARCH_OPTIONS,
	type SearchOptions as Options,
	searchOptionsOf,
} from "~/lib/search-parser";
import { useFolders } from "~/queries/folders";
import { useLabels } from "~/queries/labels";
import type { Folder } from "~/types";

const NATIVE_FIELD =
	"h-9 w-full rounded-lg border border-kumo-line bg-kumo-control px-3 text-sm text-kumo-default";

/**
 * A search by its parts: who, what, where and when. It writes the same query a person could type
 * in the search box, so the box always shows what is being searched.
 */
export default function SearchOptions({
	open,
	onOpenChange,
	mailboxId,
	query,
	onSearch,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	mailboxId?: string;
	/** What the search box says now; the dialog starts from it. */
	query: string;
	onSearch: (query: string) => void;
}) {
	const { data: folders = [] } = useFolders(mailboxId) as { data?: Folder[] };
	const { data: labels = [] } = useLabels(mailboxId);
	const [options, setOptions] = useState<Options>(NO_SEARCH_OPTIONS);
	const set = (change: Partial<Options>) => setOptions((now) => ({ ...now, ...change }));

	// biome-ignore lint/correctness/useExhaustiveDependencies: filled once, when the dialog opens
	useEffect(() => {
		if (open) setOptions(searchOptionsOf(query));
	}, [open]);

	function submit(event: FormEvent) {
		event.preventDefault();
		const built = buildSearchQuery(options);
		if (built === "") return;
		onSearch(built);
		onOpenChange(false);
	}

	return (
		<LayerDialog.Root open={open} onOpenChange={onOpenChange}>
			<LayerDialog.Content verticalAlign="top">
				<LayerDialog.Title>Search options</LayerDialog.Title>
				<LayerDialog.Body>
					<form id="search-options" onSubmit={submit} className="space-y-3">
						<Input
							size="sm"
							label="From"
							value={options.from}
							onChange={(event) => set({ from: event.target.value })}
						/>
						<Input
							size="sm"
							label="To"
							value={options.to}
							onChange={(event) => set({ to: event.target.value })}
						/>
						<Input
							size="sm"
							label="Subject"
							value={options.subject}
							onChange={(event) => set({ subject: event.target.value })}
						/>
						<Input
							size="sm"
							label="Has the words"
							value={options.words}
							onChange={(event) => set({ words: event.target.value })}
						/>
						<div>
							<label
								htmlFor="search-label"
								className="mb-1.5 block text-sm font-medium text-kumo-default"
							>
								Label
							</label>
							<select
								id="search-label"
								className={NATIVE_FIELD}
								value={options.label}
								onChange={(event) => set({ label: event.target.value })}
							>
								<option value="">Any</option>
								{/* A label the box names that no longer exists is still shown, so it is not lost silently */}
								{options.label !== "" && !labels.some((l) => l.name === options.label) && (
									<option value={options.label}>{options.label}</option>
								)}
								{labels.map((label) => (
									<option key={label.id} value={label.name}>
										{label.name}
									</option>
								))}
							</select>
						</div>
						<div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
							<div>
								<label
									htmlFor="search-in"
									className="mb-1.5 block text-sm font-medium text-kumo-default"
								>
									Search in
								</label>
								<select
									id="search-in"
									className={NATIVE_FIELD}
									value={options.folder}
									onChange={(event) => set({ folder: event.target.value })}
								>
									<option value="">All mail</option>
									{folders.map((folder) => (
										<option key={folder.id} value={folder.id}>
											{folder.name}
										</option>
									))}
								</select>
							</div>
							<div>
								<label
									htmlFor="search-after"
									className="mb-1.5 block text-sm font-medium text-kumo-default"
								>
									After
								</label>
								<input
									id="search-after"
									type="date"
									className={NATIVE_FIELD}
									value={options.after}
									onChange={(event) => set({ after: event.target.value })}
								/>
							</div>
							<div>
								<label
									htmlFor="search-before"
									className="mb-1.5 block text-sm font-medium text-kumo-default"
								>
									Before
								</label>
								<input
									id="search-before"
									type="date"
									className={NATIVE_FIELD}
									value={options.before}
									onChange={(event) => set({ before: event.target.value })}
								/>
							</div>
						</div>
						<div className="flex flex-wrap gap-x-6 gap-y-2 pt-1">
							<label className="flex items-center gap-2 text-sm text-kumo-default">
								<input
									type="checkbox"
									className="h-4 w-4"
									checked={options.hasAttachment}
									onChange={(event) => set({ hasAttachment: event.target.checked })}
								/>
								Has an attachment
							</label>
							<label className="flex items-center gap-2 text-sm text-kumo-default">
								<input
									type="checkbox"
									className="h-4 w-4"
									checked={options.unreadOnly}
									onChange={(event) => set({ unreadOnly: event.target.checked })}
								/>
								Unread only
							</label>
						</div>
					</form>
				</LayerDialog.Body>
				<LayerDialog.Actions dismissLabel="Cancel">
					<LayerDialog.Action
						type="submit"
						form="search-options"
						disabled={buildSearchQuery(options) === ""}
					>
						Search
					</LayerDialog.Action>
				</LayerDialog.Actions>
			</LayerDialog.Content>
		</LayerDialog.Root>
	);
}
