// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { Button, DropdownMenu, LayerDialog } from "@cloudflare/kumo";
import { CalendarBlankIcon, ClockIcon } from "@phosphor-icons/react";
import { SENDING } from "@podbay/mail/shared";
import { type FormEvent, useState } from "react";
import DateTimeField from "~/components/controls/DateTimeField";
import { t } from "~/i18n";
import { fieldValue, laterChoices, timeRefusal, timeWords } from "~/lib/sending-words";

/**
 * "Send later" (ADR-0016, decision 12): a few times of the app's own and a date and time, in
 * this device's time zone. Every choice is shown back with its date and time before it is
 * made; what is handed on is the instant in UTC, which is what the mailbox keeps.
 *
 * It is also how a waiting message is given a new time: the words say which.
 */
export default function SendLater({
	label,
	action,
	onChoose,
	disabled,
	variant = "secondary",
	iconOnPhone = false,
}: {
	/** What the button and the dialog are called: "Send later", or "Change the time". */
	label: string;
	/** The words on the button that goes ahead in the dialog. */
	action: string;
	onChoose: (sendAt: string) => void;
	disabled?: boolean;
	variant?: "secondary" | "outline" | "ghost";
	/** Below 640 px the button shows its clock alone, keeping its name, so a row of actions fits. */
	iconOnPhone?: boolean;
}) {
	const [picking, setPicking] = useState(false);
	const [picked, setPicked] = useState("");
	const now = new Date();
	const time = new Date(picked);
	const refusal = picked === "" ? null : timeRefusal(time, now);

	function open() {
		// It opens on tomorrow at this time, so the field holds a time that can be taken.
		setPicked(fieldValue(new Date(Date.now() + 24 * 60 * 60_000)));
		setPicking(true);
	}

	function choose(event: FormEvent) {
		event.preventDefault();
		// The dialog is drawn outside the compose form, but its events still pass through it.
		event.stopPropagation();
		if (picked === "" || timeRefusal(time, new Date()) !== null) return;
		setPicking(false);
		onChoose(time.toISOString());
	}

	return (
		<>
			<DropdownMenu>
				<DropdownMenu.Trigger
					render={
						<Button
							type="button"
							variant={variant}
							size="sm"
							className="rounded-full"
							icon={<ClockIcon size={16} />}
							disabled={disabled}
							aria-label={iconOnPhone ? label : undefined}
						>
							{iconOnPhone ? <span className="hidden sm:inline">{label}</span> : label}
						</Button>
					}
				/>
				<DropdownMenu.Content>
					<DropdownMenu.Group>
						<DropdownMenu.Label>{label}</DropdownMenu.Label>
						{laterChoices(now).map((choice) => (
							<DropdownMenu.Item
								key={choice.name}
								onClick={() => onChoose(choice.at.toISOString())}
							>
								<span className="flex w-full items-baseline justify-between gap-6">
									<span>{t(choice.name)}</span>
									<span className="text-xs text-kumo-subtle">{timeWords(choice.at)}</span>
								</span>
							</DropdownMenu.Item>
						))}
					</DropdownMenu.Group>
					<DropdownMenu.Separator />
					<DropdownMenu.Item icon={CalendarBlankIcon} onClick={open}>
						{t("Pick a date and time")}
					</DropdownMenu.Item>
				</DropdownMenu.Content>
			</DropdownMenu>

			<LayerDialog.Root open={picking} onOpenChange={setPicking}>
				<LayerDialog.Content size="sm">
					<LayerDialog.Title>{label}</LayerDialog.Title>
					<LayerDialog.Description>
						{t(
							"The time is in this device's time zone. Until then the message waits in Scheduled.",
						)}
					</LayerDialog.Description>
					<LayerDialog.Body>
						{/* biome-ignore lint/a11y/noStaticElementInteractions: only keeps the dialog's keys and typing from the compose form */}
						<div
							onKeyDown={(event) => event.stopPropagation()}
							onInput={(event) => event.stopPropagation()}
						>
							<form id="send-later" onSubmit={choose} className="space-y-3">
								<DateTimeField
									label={t("Date and time")}
									value={picked}
									min={fieldValue(now)}
									max={fieldValue(new Date(now.getTime() + SENDING.farthestMs))}
									onChange={setPicked}
									required
								/>
								{refusal === null && picked !== "" ? (
									<p className="m-0 text-sm text-kumo-default">
										{t("The message will be sent {time}.", { time: timeWords(time) })}
									</p>
								) : (
									<p role="alert" className="m-0 text-sm text-kumo-danger">
										{refusal ?? t("Choose a date and a time.")}
									</p>
								)}
							</form>
						</div>
					</LayerDialog.Body>
					<LayerDialog.Actions dismissLabel={t("Cancel")}>
						<LayerDialog.Action
							type="submit"
							form="send-later"
							disabled={picked === "" || refusal !== null}
						>
							{action}
						</LayerDialog.Action>
					</LayerDialog.Actions>
				</LayerDialog.Content>
			</LayerDialog.Root>
		</>
	);
}
