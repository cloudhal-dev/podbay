// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { XIcon } from "@phosphor-icons/react";
import { type KeyboardEvent, type Ref, useEffect, useId, useState } from "react";
import {
	joinTyped,
	looksLikeAddress,
	splitTyped,
	suggestAddresses,
	typeInto,
} from "~/lib/address-suggestions";

/**
 * A field for one or more addresses. An address that is done becomes a chip that can be taken
 * off; a comma, a semicolon, Enter or leaving the field ends the one in hand. While an address
 * is typed, the ones the mailbox has exchanged mail with are offered: arrows choose, Enter or
 * Tab takes. The value stays what it always was, addresses separated by commas.
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
	const [focused, setFocused] = useState(false);
	const open = offered.length > 0;
	const { done, typing } = splitTyped(value);

	// An address the field was given (a reply's recipient), or one left when the field is, is done.
	useEffect(() => {
		if (!focused && typing.trim() !== "") onChange(joinTyped([...done, typing.trim()], ""));
	}, [focused, typing, done, onChange]);

	function type(text: string) {
		const next = typeInto(done, text);
		onChange(next);
		setOffered(suggestAddresses(known(), next));
		setAt(0);
	}

	function take(address: string) {
		onChange(joinTyped([...done, address], ""));
		setOffered([]);
	}

	function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
		if (open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
			event.preventDefault();
			const step = event.key === "ArrowDown" ? 1 : -1;
			setAt((at + step + offered.length) % offered.length);
		} else if (open && (event.key === "Enter" || event.key === "Tab")) {
			const chosen = offered[at];
			if (chosen === undefined) return;
			event.preventDefault();
			// Enter takes the suggestion; it must not also send the message.
			event.stopPropagation();
			take(chosen);
		} else if (open && event.key === "Escape") {
			event.stopPropagation();
			setOffered([]);
		} else if (event.key === "Enter" && typing.trim() !== "") {
			// Enter ends the address in hand, and only then is Enter anything else.
			event.preventDefault();
			event.stopPropagation();
			take(typing.trim());
		} else if (event.key === "Backspace" && typing === "" && done.length > 0) {
			event.preventDefault();
			onChange(joinTyped(done.slice(0, -1), ""));
		}
	}

	return (
		<div className="relative flex min-w-0 flex-1 flex-wrap items-center gap-1 py-1">
			{done.map((address, index) => (
				<span
					key={address.toLowerCase()}
					title={looksLikeAddress(address) ? undefined : "This does not look like an address"}
					className={`flex max-w-full items-center gap-1 rounded-full border py-0.5 pl-2.5 pr-1 text-xs ${
						looksLikeAddress(address)
							? "border-kumo-line bg-kumo-recessed text-kumo-default"
							: "border-kumo-danger text-kumo-danger"
					}`}
				>
					<span className="truncate">{address}</span>
					<button
						type="button"
						onClick={() =>
							onChange(
								joinTyped(
									done.filter((_a, at) => at !== index),
									typing,
								),
							)
						}
						aria-label={`Remove ${address}`}
						className="shrink-0 cursor-pointer rounded-full border-0 bg-transparent p-0.5 text-kumo-subtle hover:bg-kumo-fill hover:text-kumo-default"
					>
						<XIcon size={10} />
					</button>
				</span>
			))}
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
				className={`${className} min-w-32 py-1`}
				value={typing}
				required={required && done.length === 0}
				onChange={(event) => type(event.target.value)}
				onKeyDown={onKeyDown}
				onFocus={() => setFocused(true)}
				onBlur={() => {
					setFocused(false);
					setOffered([]);
				}}
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
