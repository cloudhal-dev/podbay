// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { Button, Input, useKumoToastManager } from "@cloudflare/kumo";
import { type FormEvent, useEffect, useState } from "react";
import { AUTO_REPLY } from "shared/rules";
import { useFreshProof } from "~/components/FreshProof";
import { t } from "~/i18n";
import { replyToSave, shownText } from "~/lib/auto-reply";
import { fieldValue } from "~/lib/sending-words";
import { useAutoReply, useSaveAutoReply } from "~/queries/rules";
import Row from "./Row";

const NATIVE_FIELD =
	"h-9 w-full rounded-lg border border-kumo-line bg-kumo-control px-3 text-sm text-kumo-default";

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

	// Filled when the reply arrives, and again when it is saved.
	useEffect(() => {
		if (!data) return;
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
			<fieldset disabled={!canChange} className="m-0 border-0 p-0">
				<Row name={t("Automatic reply")} about={t("Whether the mailbox answers by itself.")}>
					<label className="flex cursor-pointer items-center gap-2">
						<input
							type="checkbox"
							className="h-4 w-4"
							checked={enabled}
							onChange={(event) => setEnabled(event.target.checked)}
						/>
						{t("Answer mail that arrives")}
					</label>
				</Row>
				<Row
					name={t("Between")}
					about={t("In this device's time zone. Leave a field empty for no beginning or no end.")}
				>
					<div className="grid max-w-md gap-3 sm:grid-cols-2">
						<div>
							<label htmlFor="auto-reply-from" className="mb-1.5 block text-xs text-kumo-subtle">
								{t("Starts")}
							</label>
							<input
								id="auto-reply-from"
								type="datetime-local"
								className={NATIVE_FIELD}
								value={from}
								onChange={(event) => setFrom(event.target.value)}
							/>
						</div>
						<div>
							<label htmlFor="auto-reply-until" className="mb-1.5 block text-xs text-kumo-subtle">
								{t("Ends")}
							</label>
							<input
								id="auto-reply-until"
								type="datetime-local"
								className={NATIVE_FIELD}
								value={until}
								onChange={(event) => setUntil(event.target.value)}
							/>
						</div>
					</div>
					{backwards && (
						<p role="alert" className="m-0 mt-2 text-sm text-kumo-danger">
							{t("The end must be after the beginning.")}
						</p>
					)}
				</Row>
				<Row name={t("Subject")} about={t("Left empty, the subject is “Automatic reply”.")}>
					<div className="flex max-w-md">
						<div className="min-w-0 flex-1">
							<Input
								aria-label={t("Subject")}
								size="sm"
								value={subject}
								maxLength={AUTO_REPLY.subject}
								onChange={(event) => setSubject(event.target.value)}
							/>
						</div>
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
					<textarea
						aria-label={t("Message")}
						className="block min-h-40 w-full max-w-xl rounded-lg border border-kumo-line bg-kumo-control p-3 text-sm text-kumo-default"
						value={text}
						maxLength={AUTO_REPLY.text}
						onChange={(event) => setText(event.target.value)}
					/>
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
			<div className="pt-4">
				{canChange ? (
					<Button
						type="submit"
						variant="primary"
						size="sm"
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
		</form>
	);
}
