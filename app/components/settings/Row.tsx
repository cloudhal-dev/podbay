// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import type { ReactNode } from "react";

/** One setting: its name and a line about it on the left, the control on the right. */
export default function Row({
	name,
	about,
	children,
}: {
	name: string;
	about?: string;
	children: ReactNode;
}) {
	return (
		<div className="grid gap-x-8 gap-y-2 border-b border-kumo-line py-4 md:grid-cols-[220px_1fr]">
			<div>
				<div className="text-sm font-medium text-kumo-default">{name}</div>
				{about && <p className="m-0 mt-0.5 text-xs text-kumo-subtle">{about}</p>}
			</div>
			<div className="min-w-0 text-sm text-kumo-default">{children}</div>
		</div>
	);
}

/** A choice between a few named things, as radio buttons under one name. */
export function Choice<T extends string | number>({
	legend,
	value,
	options,
	onChange,
}: {
	/** What is being chosen, for assistive technology. */
	legend: string;
	value: T;
	options: readonly (readonly [T, string])[];
	onChange: (value: T) => void;
}) {
	return (
		<div role="radiogroup" aria-label={legend} className="flex flex-col gap-1.5">
			{options.map(([option, label]) => (
				<label key={String(option)} className="flex cursor-pointer items-center gap-2">
					<input
						type="radio"
						name={legend}
						className="h-4 w-4"
						checked={value === option}
						onChange={() => onChange(option)}
					/>
					{label}
				</label>
			))}
		</div>
	);
}
