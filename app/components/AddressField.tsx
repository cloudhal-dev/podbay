// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { Button } from "@cloudflare/kumo";
import { XIcon } from "@phosphor-icons/react";
import {
	type KeyboardEvent,
	type MouseEvent,
	type Ref,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import type { KnownSource } from "~/hooks/useKnownAddresses";
import { t } from "~/i18n";
import {
	joinTyped,
	lastAddress,
	looksLikeAddress,
	mergeSuggestions,
	type Suggestion,
	splitTyped,
	typeInto,
} from "~/lib/address-suggestions";

/** How long after the last key the mailbox is asked: not for every letter of a fast typist. */
const ASK_AFTER_MS = 120;

/**
 * A field for one or more addresses. An address that is done becomes a chip that can be taken
 * off; a comma, a semicolon, Enter or leaving the field ends the one in hand. While an address
 * is typed, addresses are offered: first the ones the mailbox has written to, which it is asked
 * for, then the ones the loaded lists show. Arrows choose, Enter or Tab takes, and an address
 * the mailbox remembers can be forgotten from its suggestion (its button, or Shift with
 * Delete). The value stays what it always was, addresses separated by commas.
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
	/** Where the addresses to offer come from. Asked when the field is used, not on every render. */
	known: KnownSource;
	className: string;
	required?: boolean;
	inputRef?: Ref<HTMLInputElement>;
}) {
	const listId = useId();
	const [offered, setOffered] = useState<Suggestion[]>([]);
	const [at, setAt] = useState(0);
	const [focused, setFocused] = useState(false);
	/** Said to someone who cannot see the suggestion go. */
	const [said, setSaid] = useState("");
	/** What the mailbox is being asked for; a newer question, or leaving, makes an answer stale. */
	const asking = useRef<{ value: string; stop: AbortController; timer: number } | null>(null);
	/** What is on screen now, for an answer that arrives later. */
	const shown = useRef({ offered, at });
	shown.current = { offered, at };
	const open = offered.length > 0;
	const { done, typing } = splitTyped(value);

	function stopAsking() {
		if (asking.current === null) return;
		window.clearTimeout(asking.current.timer);
		asking.current.stop.abort();
		asking.current = null;
	}
	// A question still open when the field goes is not waited for.
	useEffect(
		() => () => {
			if (asking.current === null) return;
			window.clearTimeout(asking.current.timer);
			asking.current.stop.abort();
		},
		[],
	);

	/** Offers what the loaded lists show at once, and the mailbox's own answers when they come. */
	function offer(next: string) {
		stopAsking();
		setOffered(mergeSuggestions([], known.loaded(), next, known.forgotten));
		setAt(0);
		if (lastAddress(next) === "") return;
		const stop = new AbortController();
		const timer = window.setTimeout(async () => {
			const written = await known.written(lastAddress(next), stop.signal);
			if (asking.current?.value !== next || stop.signal.aborted) return;
			asking.current = null;
			const merged = mergeSuggestions(written, known.loaded(), next, known.forgotten);
			// The suggestion the keyboard is on stays the one it is on, where it is still offered.
			const chosen = shown.current.offered[shown.current.at]?.address;
			setOffered(merged);
			setAt(
				Math.max(
					0,
					merged.findIndex((one) => one.address === chosen),
				),
			);
		}, ASK_AFTER_MS);
		asking.current = { value: next, stop, timer };
	}

	// An address the field was given (a reply's recipient), or one left when the field is, is done.
	useEffect(() => {
		if (!focused && typing.trim() !== "") onChange(joinTyped([...done, typing.trim()], ""));
	}, [focused, typing, done, onChange]);

	function type(text: string) {
		const next = typeInto(done, text);
		onChange(next);
		offer(next);
	}

	function take(address: string) {
		stopAsking();
		onChange(joinTyped([...done, address], ""));
		setOffered([]);
	}

	/** The mailbox forgets an address it remembered; the suggestion goes, the typing stays. */
	async function forget(one: Suggestion) {
		if (one.id === null) return;
		try {
			await known.forget({ id: one.id, address: one.address, name: one.name });
		} catch {
			setSaid(t("{address} could not be forgotten", { address: one.address }));
			return;
		}
		setSaid(t("{address} is forgotten", { address: one.address }));
		setOffered((before) => before.filter((other) => other.address !== one.address));
		setAt(0);
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
			take(chosen.address);
		} else if (open && event.key === "Delete" && event.shiftKey && offered[at]?.id != null) {
			event.preventDefault();
			void forget(offered[at]);
		} else if (open && event.key === "Escape") {
			event.stopPropagation();
			stopAsking();
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
					title={looksLikeAddress(address) ? undefined : t("This does not look like an address")}
					className={`flex max-w-full items-center gap-1 rounded-full border py-0.5 pl-2.5 pr-1 text-xs ${
						looksLikeAddress(address)
							? "border-kumo-line bg-kumo-recessed text-kumo-default"
							: "border-kumo-danger text-kumo-danger"
					}`}
				>
					<span className="truncate">{address}</span>
					{/* Kumo's round button at the small size, 26 px, a larger target than the 14 px it was;
					    its margins give back the 12 px it is larger, so the chip keeps its size. */}
					<Button
						variant="ghost"
						shape="circle"
						size="sm"
						onClick={() =>
							onChange(
								joinTyped(
									done.filter((_a, at) => at !== index),
									typing,
								),
							)
						}
						aria-label={t("Remove {name}", { name: address })}
						className="-m-1.5 shrink-0 text-kumo-subtle"
						icon={<XIcon size={10} />}
					/>
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
					stopAsking();
					setOffered([]);
				}}
			/>
			<span className="sr-only" aria-live="polite">
				{said}
			</span>
			{open && (
				<div
					id={listId}
					role="listbox"
					aria-label={t("Addresses")}
					className="absolute left-0 top-full z-10 mt-1 max-h-60 min-w-64 overflow-auto rounded-lg border border-kumo-line bg-kumo-elevated p-1 shadow-lg"
				>
					{offered.map((one, index) => (
						<div
							key={one.address}
							id={`${listId}-${index}`}
							role="option"
							tabIndex={-1}
							aria-selected={index === at}
							// The field keeps the focus: a press on a suggestion must not blur it first.
							onMouseDown={(event) => {
								event.preventDefault();
								take(one.address);
							}}
							onMouseEnter={() => setAt(index)}
							className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-kumo-default ${
								index === at ? "bg-kumo-tint" : ""
							}`}
						>
							{/* The whole address is always shown; a name stands beside it, never for it. */}
							<span className="min-w-0 flex-1 truncate">
								{one.name !== null && <span className="mr-2 font-medium">{one.name}</span>}
								<span className={one.name !== null ? "text-kumo-subtle" : ""}>{one.address}</span>
							</span>
							{one.id !== null && (
								<Button
									variant="ghost"
									shape="circle"
									size="sm"
									tabIndex={-1}
									title={t("Forget this address (Shift+Delete)")}
									aria-label={t("Forget {address}", { address: one.address })}
									onMouseDown={(event: MouseEvent) => {
										event.preventDefault();
										event.stopPropagation();
										void forget(one);
									}}
									className="-my-1 shrink-0 text-kumo-subtle"
									icon={<XIcon size={12} />}
								/>
							)}
						</div>
					))}
				</div>
			)}
		</div>
	);
}
