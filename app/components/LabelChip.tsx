// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { labelDot } from "~/lib/labels";
import type { Label } from "~/types";

/** A label as it is shown on a conversation: its colour as a dot, its name as text. */
export default function LabelChip({ label }: { label: Label }) {
	return (
		<span className="inline-flex max-w-40 shrink-0 items-center gap-1 rounded border border-kumo-line bg-kumo-base px-1.5 py-px align-middle text-xs font-normal text-kumo-strong">
			<span
				className={`h-2 w-2 shrink-0 rounded-full ${labelDot(label.color)}`}
				aria-hidden="true"
			/>
			<span className="truncate">{label.name}</span>
		</span>
	);
}

/** The chips of the labels a conversation carries, in the mailbox's name order. */
export function LabelChips({
	ids,
	labels,
	max,
}: {
	ids: readonly string[] | undefined;
	labels: readonly Label[];
	/** Show at most this many, and say how many more there are. */
	max?: number;
}) {
	const carried = labels.filter((label) => ids?.includes(label.id));
	if (carried.length === 0) return null;
	const shown = max === undefined ? carried : carried.slice(0, max);
	return (
		<>
			{shown.map((label) => (
				<LabelChip key={label.id} label={label} />
			))}
			{carried.length > shown.length && (
				<span className="shrink-0 text-xs text-kumo-subtle">+{carried.length - shown.length}</span>
			)}
		</>
	);
}
