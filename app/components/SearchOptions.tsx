// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { Checkbox, Input, LayerDialog, Select } from "@cloudflare/kumo";
import { type FormEvent, useEffect, useState } from "react";
import DateTimeField from "~/components/controls/DateTimeField";
import { t } from "~/i18n";
import { placeName } from "~/lib/places";
import {
	buildSearchQuery,
	NO_SEARCH_OPTIONS,
	type SearchOptions as Options,
	searchOptionsOf,
} from "~/lib/search-parser";
import { useFolders } from "~/queries/folders";
import { useLabels } from "~/queries/labels";
import type { Folder } from "~/types";

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
				<LayerDialog.Title>{t("Search options")}</LayerDialog.Title>
				<LayerDialog.Body>
					<form id="search-options" onSubmit={submit} className="space-y-3">
						<Input
							label={t("From")}
							value={options.from}
							onChange={(event) => set({ from: event.target.value })}
						/>
						<Input
							label={t("To")}
							value={options.to}
							onChange={(event) => set({ to: event.target.value })}
						/>
						<Input
							label={t("Subject")}
							value={options.subject}
							onChange={(event) => set({ subject: event.target.value })}
						/>
						<Input
							label={t("Has the words")}
							value={options.words}
							onChange={(event) => set({ words: event.target.value })}
						/>
						<Select
							label={t("Label")}
							className="w-full"
							value={options.label}
							onValueChange={(label) => set({ label: String(label ?? "") })}
							items={[
								{ label: t("Any"), value: "" },
								// A label the box names that no longer exists is still shown, so it is not lost silently
								...(options.label !== "" && !labels.some((l) => l.name === options.label)
									? [{ label: options.label, value: options.label }]
									: []),
								...labels.map((label) => ({ label: label.name, value: label.name })),
							]}
						/>
						<div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
							<Select
								label={t("Search in")}
								className="w-full"
								value={options.folder}
								onValueChange={(folder) => set({ folder: String(folder ?? "") })}
								items={[
									{ label: t("All mail"), value: "" },
									...folders.map((folder) => ({ label: placeName(folder.id), value: folder.id })),
								]}
							/>
							<DateTimeField
								kind="date"
								label={t("After")}
								value={options.after}
								onChange={(after) => set({ after })}
							/>
							<DateTimeField
								kind="date"
								label={t("Before")}
								value={options.before}
								onChange={(before) => set({ before })}
							/>
						</div>
						<div className="flex flex-wrap gap-x-6 gap-y-2 pt-1">
							<Checkbox
								label={t("Has an attachment")}
								checked={options.hasAttachment}
								onCheckedChange={(checked) => set({ hasAttachment: checked === true })}
							/>
							<Checkbox
								label={t("Unread only")}
								checked={options.unreadOnly}
								onCheckedChange={(checked) => set({ unreadOnly: checked === true })}
							/>
						</div>
					</form>
				</LayerDialog.Body>
				<LayerDialog.Actions dismissLabel={t("Cancel")}>
					<LayerDialog.Action
						type="submit"
						form="search-options"
						disabled={buildSearchQuery(options) === ""}
					>
						{t("Search")}
					</LayerDialog.Action>
				</LayerDialog.Actions>
			</LayerDialog.Content>
		</LayerDialog.Root>
	);
}
