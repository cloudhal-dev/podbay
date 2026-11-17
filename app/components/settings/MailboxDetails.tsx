// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { Button, Input, useKumoToastManager } from "@cloudflare/kumo";
import { Link } from "@tanstack/react-router";
import { type FormEvent, useEffect, useState } from "react";
import { useUpdateMailbox } from "~/queries/mailboxes";
import type { Mailbox } from "~/types";
import Row from "./Row";

/** What the mailbox is called, its address, and who may use it. */
export default function MailboxDetails({ mailbox }: { mailbox: Mailbox }) {
	const toasts = useKumoToastManager();
	const updateMailbox = useUpdateMailbox();
	const isOwner = mailbox.role === "owner";
	const [name, setName] = useState("");

	// biome-ignore lint/correctness/useExhaustiveDependencies: filled when the mailbox arrives or changes
	useEffect(() => {
		setName(mailbox.settings?.fromName || mailbox.name || "");
	}, [mailbox.id, mailbox.settings?.fromName]);

	async function save(event: FormEvent) {
		event.preventDefault();
		try {
			await updateMailbox.mutateAsync({
				mailboxId: mailbox.id,
				settings: { ...mailbox.settings, fromName: name.trim() },
			});
			toasts.add({ title: "Name saved" });
		} catch {
			toasts.add({ title: "The name could not be saved", variant: "error" });
		}
	}

	return (
		<div>
			<Row name="Address" about="Mail sent to this address arrives here.">
				<span className="font-mono text-sm">{mailbox.email}</span>
			</Row>
			<Row name="Name" about="The name people see on mail sent from this mailbox.">
				<form onSubmit={save} className="flex max-w-md items-end gap-2">
					<div className="min-w-0 flex-1">
						<Input
							aria-label="Name"
							size="sm"
							value={name}
							disabled={!isOwner}
							onChange={(event) => setName(event.target.value)}
						/>
					</div>
					{isOwner && (
						<Button type="submit" variant="primary" size="sm" loading={updateMailbox.isPending}>
							Save
						</Button>
					)}
				</form>
				{!isOwner && (
					<p className="m-0 mt-2 text-xs text-kumo-subtle">
						An owner of this mailbox can change it.
					</p>
				)}
			</Row>
			<Row name="Members" about="Who may read this mailbox and send as it.">
				<Link
					to="/members/$mailboxId"
					params={{ mailboxId: mailbox.email }}
					className="text-sm text-kumo-default underline"
				>
					{isOwner ? "Manage members" : "See the members"}
				</Link>
			</Row>
		</div>
	);
}
