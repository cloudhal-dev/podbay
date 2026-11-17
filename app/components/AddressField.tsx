// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { type KeyboardEvent, type Ref, useId, useState } from "react";
import { completeAddress, suggestAddresses } from "~/lib/address-suggestions";

/**
 * A field for one or more addresses, separated by commas. While an address is being typed it
 * offers the ones the mailbox has exchanged mail with before; arrows choose, Enter or Tab takes.
 */
export default function AddressField({
	id,
	value,
	onChange,
	known,
	className,
	required,
	inputRef,
}: {
	id: string;
	value: string;
	onChange: (value: string) => void;
	/** Gives the addresses to offer. Called when the field is used, not on every render. */
	known: () => string[];
	className: string;
	required?: boolean;
	inputRef?: Ref<HTMLInputElement>;
}) {
	const listId = useId();
	const [offered, setOffered] = useState<string[]>([]);
	const [at, setAt] = useState(0);
	const open = offered.length > 0;

	function change(next: string) {
		onChange(next);
		setOffered(suggestAddresses(known(), next));
		setAt(0);
	}

	function take(address: string) {
		onChange(completeAddress(value, address));
		setOffered([]);
	}

	function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
		if (!open) return;
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			const step = event.key === "ArrowDown" ? 1 : -1;
			setAt((at + step + offered.length) % offered.length);
		} else if (event.key === "Enter" || event.key === "Tab") {
			const chosen = offered[at];
			if (chosen === undefined) return;
			event.preventDefault();
			// Enter takes the suggestion; it must not also send the message.
			event.stopPropagation();
			take(chosen);
		} else if (event.key === "Escape") {
			event.stopPropagation();
			setOffered([]);
		}
	}

	return (
		<div className="relative min-w-0 flex-1">
			<input
				ref={inputRef}
				id={id}
				type="text"
				role="combobox"
				aria-expanded={open}
				aria-controls={listId}
				aria-autocomplete="list"
				aria-activedescendant={open ? `${listId}-${at}` : undefined}
				autoComplete="off"
				className={`${className} w-full`}
				value={value}
				required={required}
				onChange={(event) => change(event.target.value)}
				onKeyDown={onKeyDown}
				onBlur={() => setOffered([])}
			/>
			{open && (
				<div
					id={listId}
					role="listbox"
					aria-label="Addresses"
					className="absolute left-0 top-full z-10 mt-1 max-h-60 min-w-64 overflow-auto rounded-lg border border-kumo-line bg-kumo-elevated p-1 shadow-lg"
				>
					{offered.map((address, index) => (
						<div
							key={address}
							id={`${listId}-${index}`}
							role="option"
							tabIndex={-1}
							aria-selected={index === at}
							// The field keeps the focus: a press on a suggestion must not blur it first.
							onMouseDown={(event) => {
								event.preventDefault();
								take(address);
							}}
							onMouseEnter={() => setAt(index)}
							className={`cursor-pointer rounded px-2 py-1.5 text-sm text-kumo-default ${
								index === at ? "bg-kumo-tint" : ""
							}`}
						>
							{address}
						</div>
					))}
				</div>
			)}
		</div>
	);
}
