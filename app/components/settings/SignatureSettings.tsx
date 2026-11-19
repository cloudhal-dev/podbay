// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { Button, Checkbox, useKumoToastManager } from "@cloudflare/kumo";
import { useEffect, useState } from "react";
import RichTextEditor from "~/components/RichTextEditor";
import { t } from "~/i18n";
import { htmlToPlainText } from "~/lib/utils";
import { useUpdateMailbox } from "~/queries/mailboxes";
import type { Mailbox } from "~/types";

/** The lines added under every new message written from this mailbox. */
export default function SignatureSettings({ mailbox }: { mailbox: Mailbox }) {
	const toasts = useKumoToastManager();
	const updateMailbox = useUpdateMailbox();
	const isOwner = mailbox.role === "owner";
	const [enabled, setEnabled] = useState(false);
	const [html, setHtml] = useState("");

	// biome-ignore lint/correctness/useExhaustiveDependencies: filled when the mailbox arrives or changes
	useEffect(() => {
		const signature = mailbox.settings?.signature;
		setEnabled(signature?.enabled === true);
		setHtml(signature?.html || signature?.text || "");
	}, [mailbox.id]);

	async function save() {
		try {
			await updateMailbox.mutateAsync({
				mailboxId: mailbox.id,
				settings: {
					...mailbox.settings,
					signature: { enabled, html, text: htmlToPlainText(html) },
				},
			});
			toasts.add({ title: t("Signature saved") });
		} catch {
			toasts.add({ title: t("The signature could not be saved"), variant: "error" });
		}
	}

	return (
		<div>
			<p className="m-0 border-b border-kumo-line pb-4 text-xs text-kumo-subtle">
				{t(
					"The signature belongs to the mailbox: everyone who writes from it gets the same one, and a message already written keeps what it has.",
				)}
			</p>
			<fieldset disabled={!isOwner} className="m-0 space-y-4 border-0 p-0 pt-4">
				{/* Kumo's box, with its words at the 13 px they had, on the 20 px line its box is set for. */}
				<Checkbox
					label={<span className="text-sm leading-5">{t("Add a signature to new messages")}</span>}
					checked={enabled}
					disabled={!isOwner}
					onCheckedChange={(checked) => setEnabled(checked === true)}
				/>
				<div className="h-64">
					<RichTextEditor value={html} onChange={setHtml} focusOnLoad={false} />
				</div>
				{isOwner ? (
					<Button variant="primary" size="sm" loading={updateMailbox.isPending} onClick={save}>
						{t("Save signature")}
					</Button>
				) : (
					<p className="m-0 text-xs text-kumo-subtle">
						{t("An owner of this mailbox can change it.")}
					</p>
				)}
			</fieldset>
		</div>
	);
}
