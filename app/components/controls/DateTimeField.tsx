// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { Label } from "@cloudflare/kumo";
import { useId } from "react";

/**
 * A date, or a date with a time of day, as a person types or picks it: the one place the app
 * uses the browser's own date field (issue #82). Kumo 2.18.1 has no field for a date and a time:
 * its DatePicker is a calendar with no time of day and no field to type in.
 *
 * The field is drawn once, here, at the height, corner and type of Kumo's default size (36 px,
 * 14 px), with Kumo's label above it, so it stands beside Kumo's fields as one of them. Its
 * limit stays: the browser shows the date in the device's own form and language, not the app's.
 */
export default function DateTimeField({
	label,
	kind = "datetime-local",
	labelClassName,
	...field
}: {
	/** What the field is called; it is its label above it. */
	label: string;
	/** A date alone, or a date with a time of day. */
	kind?: "date" | "datetime-local";
	/** The label's own look where a screen sets labels apart, as a small subtle line. */
	labelClassName?: string;
	value: string;
	onChange: (value: string) => void;
	min?: string;
	max?: string;
	required?: boolean;
}) {
	const id = useId();
	const { onChange, ...rest } = field;
	return (
		<div>
			<Label htmlFor={id} className={labelClassName}>
				{label}
			</Label>
			<input
				{...rest}
				id={id}
				type={kind}
				className="mt-1.5 h-9 w-full rounded-lg border border-kumo-line bg-kumo-control px-3 text-base text-kumo-default"
				onChange={(event) => onChange(event.target.value)}
			/>
		</div>
	);
}
