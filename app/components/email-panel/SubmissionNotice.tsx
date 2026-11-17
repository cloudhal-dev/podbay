// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { Button } from "@cloudflare/kumo";
import { ClockIcon, WarningIcon } from "@phosphor-icons/react";
import { useState } from "react";
import SendLater from "~/components/SendLater";
import { useSending } from "~/hooks/useSending";
import { t } from "~/i18n";
import { mayHaveLeft, reasonWords, timeWords } from "~/lib/sending-words";
import type { Email } from "~/types";

/**
 * What a message says about its way out, above an open conversation (ADR-0016).
 *
 * A message that waits is read-only: it shows its time and offers to send it now, to give it
 * a new time, to cancel (back to Drafts) and to edit, which is cancelling and opening the
 * draft in one press. A message that was not sent is a draft again: it says why, in the app's
 * own words, and the mark can be dismissed. The Worker decides each of these; someone who may
 * only read is shown the words and no button.
 */
export default function SubmissionNotice({
	email,
	mailboxId,
	maySend,
	onLeft,
}: {
	email: Email;
	mailboxId: string | undefined;
	/** Whether the person may send from this mailbox: only then are the deeds offered. */
	maySend: boolean;
	/** The message is no longer where it was shown: it was taken back, or the mark is gone. */
	onLeft: (id: string) => void;
}) {
	const sending = useSending(mailboxId);
	const [busy, setBusy] = useState(false);
	const submission = email.submission;
	if (submission === undefined || submission.state === "sent") return null;

	const run = async (deed: () => Promise<boolean>, leaves: boolean) => {
		setBusy(true);
		try {
			if ((await deed()) && leaves) onLeft(email.id);
		} finally {
			setBusy(false);
		}
	};

	if (submission.state === "failed") {
		return (
			<div
				role="alert"
				className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-kumo-line bg-kumo-danger/5 px-4 py-3 text-sm text-kumo-default md:px-6 print:hidden"
			>
				<WarningIcon size={18} className="shrink-0 text-kumo-danger" aria-hidden="true" />
				<div className="min-w-0 flex-1">
					<p className="m-0 font-medium">{t("This message was not sent.")}</p>
					<p className="m-0 text-kumo-subtle">{reasonWords(submission.error)}</p>
					{mayHaveLeft(submission.error) ? null : (
						<p className="m-0 text-kumo-subtle">
							{t("It is a draft again: send it again, change it or discard it.")}
						</p>
					)}
				</div>
				{maySend && (
					<Button
						variant="secondary"
						size="sm"
						disabled={busy}
						onClick={() => void run(() => sending.takeBack(email.id, { open: false }), false)}
					>
						{t("Dismiss")}
					</Button>
				)}
			</div>
		);
	}

	const handedOver = submission.state === "sending";
	return (
		<div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-kumo-line bg-kumo-recessed px-4 py-3 text-sm text-kumo-default md:px-6 print:hidden">
			<ClockIcon size={18} className="shrink-0 text-kumo-subtle" aria-hidden="true" />
			<p className="m-0 min-w-0 flex-1">
				{handedOver
					? t("This message is being sent.")
					: t("This message will be sent {time}.", { time: timeWords(submission.send_at) })}
			</p>
			{maySend && !handedOver && (
				<div className="flex flex-wrap items-center gap-2">
					<Button
						variant="primary"
						size="sm"
						disabled={busy}
						onClick={() => void run(() => sending.giveTime(email.id), false)}
					>
						{t("Send now")}
					</Button>
					<SendLater
						label={t("Change the time")}
						action={t("Change the time")}
						disabled={busy}
						variant="outline"
						onChoose={(sendAt) => void run(() => sending.giveTime(email.id, sendAt), false)}
					/>
					<Button
						variant="outline"
						size="sm"
						disabled={busy}
						onClick={() => void run(() => sending.takeBack(email.id, { open: false }), true)}
					>
						{t("Cancel send")}
					</Button>
					<Button
						variant="outline"
						size="sm"
						disabled={busy}
						onClick={() => void run(() => sending.takeBack(email.id, { open: true }), true)}
					>
						{t("Edit")}
					</Button>
				</div>
			)}
		</div>
	);
}
