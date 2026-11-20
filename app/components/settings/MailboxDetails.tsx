// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { Button, Input, useKumoToastManager } from "@cloudflare/kumo";
import { Link } from "@tanstack/react-router";
import { type FormEvent, useEffect, useState } from "react";
import { useConfirm } from "~/components/Confirm";
import { t } from "~/i18n";
import { useUpdateMailbox } from "~/queries/mailboxes";
import api from "~/services/api";
import type { Mailbox } from "~/types";
import Row from "./Row";

/** What the mailbox is called, its address, and who may use it. */
export default function MailboxDetails({ mailbox }: { mailbox: Mailbox }) {
	const toasts = useKumoToastManager();
	const updateMailbox = useUpdateMailbox();
	const isOwner = mailbox.role === "owner";
	const [name, setName] = useState("");
	const confirm = useConfirm();
	const [forgetting, setForgetting] = useState(false);

	/** The mailbox forgets every address it has written to (ADR-0012, decision 20). */
	async function forgetAddresses() {
		const yes = await confirm({
			title: t("Forget all addresses?"),
			body: t(
				"This mailbox will no longer offer the addresses it has written to while an address is typed. No mail is deleted, and an address is remembered again when a message is sent to it. This cannot be undone.",
			),
			action: t("Forget all addresses"),
			destructive: true,
		});
		if (!yes) return;
		setForgetting(true);
		try {
			await api.forgetKnownAddresses(mailbox.id);
			toasts.add({ title: t("The addresses are forgotten") });
		} catch {
			toasts.add({ title: t("The addresses could not be forgotten"), variant: "error" });
		} finally {
			setForgetting(false);
		}
	}

	// Filled once for each mailbox (#124): the mailbox read again after a save, or changed in
	// another tab, never writes over a name being typed.
	// biome-ignore lint/correctness/useExhaustiveDependencies: filled when another mailbox is shown, and only then
	useEffect(() => {
		setName(mailbox.settings?.fromName || mailbox.name || "");
	}, [mailbox.id]);

	async function save(event: FormEvent) {
		event.preventDefault();
		try {
			await updateMailbox.mutateAsync({
				mailboxId: mailbox.id,
				settings: { ...mailbox.settings, fromName: name.trim() },
			});
			toasts.add({ title: t("Name saved") });
		} catch {
			toasts.add({ title: t("The name could not be saved"), variant: "error" });
		}
	}

	return (
		<div>
			<Row name={t("Address")} about={t("Mail sent to this address arrives here.")}>
				<span className="font-mono text-sm">{mailbox.email}</span>
			</Row>
			<Row name={t("Name")} about={t("The name people see on mail sent from this mailbox.")}>
				<form onSubmit={save} className="flex max-w-md items-end gap-2">
					<div className="min-w-0 flex-1">
						<Input
							aria-label={t("Name")}
							className="w-full"
							value={name}
							disabled={!isOwner}
							onChange={(event) => setName(event.target.value)}
						/>
					</div>
					{isOwner && (
						<Button type="submit" variant="primary" loading={updateMailbox.isPending}>
							{t("Save")}
						</Button>
					)}
				</form>
				{!isOwner && (
					<p className="m-0 mt-2 text-xs text-kumo-subtle">
						{t("An owner of this mailbox can change it.")}
					</p>
				)}
			</Row>
			<Row name={t("Members")} about={t("Who may read this mailbox and send as it.")}>
				<Link
					to="/members/$mailboxId"
					params={{ mailboxId: mailbox.email }}
					className="text-sm text-kumo-default underline"
				>
					{isOwner ? t("Manage members") : t("See the members")}
				</Link>
			</Row>
			<Row
				name={t("Addresses written to")}
				about={t(
					"This mailbox remembers the addresses mail was sent to from it, and offers them to everyone who writes from it while an address is typed. Mail that arrives teaches it nothing.",
				)}
			>
				{isOwner ? (
					<Button variant="secondary" loading={forgetting} onClick={forgetAddresses}>
						{t("Forget all addresses")}
					</Button>
				) : (
					<p className="m-0 text-xs text-kumo-subtle">
						{t("An owner of this mailbox can have it forget them all.")}
					</p>
				)}
			</Row>
		</div>
	);
}
