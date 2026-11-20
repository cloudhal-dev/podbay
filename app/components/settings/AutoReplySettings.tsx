// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { Button, Checkbox, Input, InputArea, useKumoToastManager } from "@cloudflare/kumo";
import { AUTO_REPLY } from "@podbay/mail/shared";
import { type FormEvent, useEffect, useRef, useState } from "react";
import DateTimeField from "~/components/controls/DateTimeField";
import { useFreshProof } from "~/components/FreshProof";
import { t } from "~/i18n";
import { replyToSave, shownText } from "~/lib/auto-reply";
import { fieldValue } from "~/lib/sending-words";
import { useAutoReply, useSaveAutoReply } from "~/queries/rules";
import Row from "./Row";

/** An instant as the date and time field of this device shows it; empty for none. */
const shown = (instant: string | null): string =>
	instant === null || Number.isNaN(Date.parse(instant)) ? "" : fieldValue(new Date(instant));
/** What the field holds as an instant in UTC; `null` for an empty field. */
const instantOf = (field: string): string | null =>
	field === "" || Number.isNaN(Date.parse(field)) ? null : new Date(field).toISOString();

/**
 * The automatic reply of the mailbox (ADR-0008): a message the mailbox sends by itself to
 * people who write to it, while it is on. It is the one way mail leaves without a person
 * pressing Send, so saving it is the owner's and asks who they are; the Worker decides both.
 */
export default function AutoReplySettings({
	mailboxId,
	canChange,
}: {
	mailboxId: string;
	/** Only an owner of the mailbox changes its automatic reply. */
	canChange: boolean;
}) {
	const { data, isError } = useAutoReply(mailboxId);
	const saveAutoReply = useSaveAutoReply();
	const withFreshProof = useFreshProof();
	const toasts = useKumoToastManager();
	const [enabled, setEnabled] = useState(false);
	const [from, setFrom] = useState("");
	const [until, setUntil] = useState("");
	const [subject, setSubject] = useState("");
	const [text, setText] = useState("");
	const [error, setError] = useState<string | null>(null);

	// Filled once, when the stored reply arrives (#124). Until then nothing can be typed, so it
	// writes over nothing; after that, a read again (after a save) never writes over what is
	// typed. A reply saved elsewhere shows when the page is opened again.
	const filled = useRef(false);
	useEffect(() => {
		if (!data || filled.current) return;
		filled.current = true;
		setEnabled(data.isEnabled);
		setFrom(shown(data.fromDate));
		setUntil(shown(data.toDate));
		setSubject(data.subject ?? "");
		setText(shownText(data));
	}, [data]);

	const backwards = from !== "" && until !== "" && new Date(until) <= new Date(from);
	const empty = enabled && text.trim() === "";

	async function save(event: FormEvent) {
		event.preventDefault();
		setError(null);
		if (backwards || empty) return;
		// What this screen shows, and nothing else: a body saved elsewhere as HTML is saved here as
		// its words, so nobody is made the sender of markup they did not see.
		const reply = replyToSave({
			enabled,
			fromDate: instantOf(from),
			toDate: instantOf(until),
			subject,
			text,
		});
		try {
			await withFreshProof(() => saveAutoReply.mutateAsync({ mailboxId, reply }));
			toasts.add({
				title: enabled ? t("The automatic reply is on") : t("The automatic reply is off"),
			});
		} catch {
			setError(t("The automatic reply could not be saved."));
		}
	}

	if (isError) {
		return (
			<p role="alert" className="py-10 text-center text-sm text-kumo-danger">
				{t("The automatic reply could not be loaded.")}
			</p>
		);
	}

	return (
		<form onSubmit={save}>
			<p className="m-0 border-b border-kumo-line pb-4 text-xs text-kumo-subtle">
				{t(
					"While it is on, this mailbox answers people who write to it, by itself and in its own name. A sender is answered once in seven days. Lists, automatic mail, mail in Spam and mail that does not name this address are never answered, and nothing of the message that arrived is in the answer.",
				)}
			</p>
			{data?.stopped && (
				<p role="alert" className="m-0 border-b border-kumo-line py-3 text-sm text-kumo-danger">
					{t(
						"It is on, but nothing is being answered: the person who turned it on is no longer an owner of this mailbox, or their account was recovered since. An owner saves it again to turn it on.",
					)}
				</p>
			)}
			<fieldset disabled={!canChange || !data} className="m-0 border-0 p-0">
				<Row name={t("Automatic reply")} about={t("Whether the mailbox answers by itself.")}>
					<Checkbox
						label={t("Answer mail that arrives")}
						// Kumo's checkbox is not a native control: the fieldset does not reach it.
						disabled={!canChange || !data}
						checked={enabled}
						onCheckedChange={(checked) => setEnabled(checked === true)}
					/>
				</Row>
				<Row
					name={t("Between")}
					about={t("In this device's time zone. Leave a field empty for no beginning or no end.")}
				>
					<div className="grid max-w-md gap-3 sm:grid-cols-2">
						<DateTimeField
							label={t("Starts")}
							labelClassName="text-xs text-kumo-subtle"
							value={from}
							onChange={setFrom}
						/>
						<DateTimeField
							label={t("Ends")}
							labelClassName="text-xs text-kumo-subtle"
							value={until}
							onChange={setUntil}
						/>
					</div>
					{backwards && (
						<p role="alert" className="m-0 mt-2 text-sm text-kumo-danger">
							{t("The end must be after the beginning.")}
						</p>
					)}
				</Row>
				<Row name={t("Subject")} about={t("Left empty, the subject is “Automatic reply”.")}>
					<div className="max-w-md">
						<Input
							aria-label={t("Subject")}
							className="w-full"
							value={subject}
							maxLength={AUTO_REPLY.subject}
							onChange={(event) => setSubject(event.target.value)}
						/>
					</div>
				</Row>
				<Row name={t("Message")} about={t("What people who write to this mailbox are told.")}>
					{data?.htmlBody != null && (
						<p className="m-0 mb-2 max-w-xl text-xs text-kumo-subtle">
							{t(
								"This reply was saved with formatting this screen does not show. Saved here, it keeps its words and loses the formatting.",
							)}
						</p>
					)}
					<div className="max-w-md">
						<InputArea
							aria-label={t("Message")}
							autoResize
							minRows={8}
							value={text}
							maxLength={AUTO_REPLY.text}
							onValueChange={setText}
						/>
					</div>
					{empty && (
						<p className="m-0 mt-2 text-xs text-kumo-subtle">
							{t("Write the message before turning it on.")}
						</p>
					)}
				</Row>
			</fieldset>
			{error && (
				<p role="alert" className="m-0 pt-3 text-sm text-kumo-danger">
					{error}
				</p>
			)}
			{/* The button stands where the fields are: in the column of the controls, as a row has it. */}
			<div className="grid gap-x-8 pt-4 md:grid-cols-[220px_1fr]">
				<div className="md:col-start-2">
					{canChange ? (
						<Button
							type="submit"
							variant="primary"
							loading={saveAutoReply.isPending}
							disabled={backwards || empty || !data}
						>
							{t("Save automatic reply")}
						</Button>
					) : (
						<p className="m-0 text-xs text-kumo-subtle">
							{t("An owner of this mailbox can change it.")}
						</p>
					)}
				</div>
			</div>
		</form>
	);
}
