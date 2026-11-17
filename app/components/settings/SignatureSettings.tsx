// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { Button, useKumoToastManager } from "@cloudflare/kumo";
import { useEffect, useState } from "react";
import RichTextEditor from "~/components/RichTextEditor";
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
			toasts.add({ title: "Signature saved" });
		} catch {
			toasts.add({ title: "The signature could not be saved", variant: "error" });
		}
	}

	return (
		<div>
			<p className="m-0 border-b border-kumo-line pb-4 text-xs text-kumo-subtle">
				The signature belongs to the mailbox: everyone who writes from it gets the same one, and a
				message already written keeps what it has.
			</p>
			<fieldset disabled={!isOwner} className="m-0 space-y-4 border-0 p-0 pt-4">
				<label className="flex cursor-pointer items-center gap-2 text-sm text-kumo-default">
					<input
						type="checkbox"
						className="h-4 w-4"
						checked={enabled}
						onChange={(event) => setEnabled(event.target.checked)}
					/>
					Add a signature to new messages
				</label>
				<div className="h-64">
					<RichTextEditor value={html} onChange={setHtml} focusOnLoad={false} />
				</div>
				{isOwner ? (
					<Button variant="primary" size="sm" loading={updateMailbox.isPending} onClick={save}>
						Save signature
					</Button>
				) : (
					<p className="m-0 text-xs text-kumo-subtle">An owner of this mailbox can change it.</p>
				)}
			</fieldset>
		</div>
	);
}
