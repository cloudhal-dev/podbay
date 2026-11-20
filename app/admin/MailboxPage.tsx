// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { Banner, Button, LayerDialog, Loader, Tabs, useKumoToastManager } from "@cloudflare/kumo";
import { Folders } from "@podbay/mail/shared";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { useFreshProof } from "~/components/FreshProof";
import { plural, t } from "~/i18n";
import { rich } from "~/i18n/rich";
import { useFolders } from "~/queries/folders";
import { queryKeys } from "~/queries/keys";
import { useDeleteMailbox } from "~/queries/mailboxes";
import api from "~/services/api";
import Card from "./Card";
import MailboxMembers from "./MailboxMembers";
import PageHead from "./PageHead";
import { useAdminTitle } from "./useAdminTitle";

/**
 * One mailbox of the instance (#127): what it is, who its members are with the record of their
 * changes, and deleting it. Deleting is its owners' (the Worker's `mailbox.manage`): a manager
 * who is not an owner of it is told so, and does not see the button.
 */
/** The parts of a mailbox's page, each a tab. */
export const MAILBOX_TABS = ["details", "members", "history"] as const;
export type MailboxTab = (typeof MAILBOX_TABS)[number];

export default function MailboxPage() {
	const { mailboxId = "" } = useParams({ strict: false });
	const { tab = "details" } = useSearch({ strict: false }) as { tab?: MailboxTab };
	const navigate = useNavigate();
	useAdminTitle(mailboxId, t("Mailboxes"));
	const { data: registry = [], isPending } = useQuery({
		queryKey: queryKeys.registry,
		queryFn: api.listRegistry,
	});
	const mailbox = registry.find((one) => one.address === mailboxId);

	return (
		<>
			<PageHead
				crumbs={[{ label: t("Mailboxes"), to: "/admin/mailboxes" }, { label: mailboxId }]}
				title={mailboxId}
				description={mailbox?.name}
				tabs={
					mailbox && (
						<Tabs
							variant="underline"
							value={tab}
							onValueChange={(next) =>
								void navigate({
									to: "/admin/mailboxes/$mailboxId",
									params: { mailboxId },
									search: { tab: next === "details" ? undefined : (next as MailboxTab) },
									replace: true,
								})
							}
							tabs={[
								{ value: "details", label: t("Details") },
								{ value: "members", label: t("Members") },
								{ value: "history", label: t("History") },
							]}
						/>
					)
				}
			/>
			{isPending ? (
				<div className="flex justify-center py-6">
					<Loader />
				</div>
			) : !mailbox ? (
				<Banner
					variant="error"
					text={t("This mailbox does not exist, or you may not see its members.")}
				/>
			) : tab === "members" ? (
				<MailboxMembers mailboxId={mailboxId} part="members" />
			) : tab === "history" ? (
				<MailboxMembers mailboxId={mailboxId} part="history" />
			) : (
				<div className="space-y-6">
					<Card title={t("Details")}>
						<dl className="m-0 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
							<dt className="text-kumo-subtle">{t("Name")}</dt>
							<dd className="m-0 text-kumo-default">{mailbox.name}</dd>
							<dt className="text-kumo-subtle">{t("Members")}</dt>
							<dd className="m-0 text-kumo-default">
								{plural(mailbox.members, "{count} member", "{count} members")}
							</dd>
							<dt className="text-kumo-subtle">{t("Owners")}</dt>
							<dd className="m-0 break-all text-kumo-default">
								{mailbox.owners.join(", ") || t("nobody")}
							</dd>
						</dl>
					</Card>
					<DeleteMailbox mailboxId={mailboxId} isOwner={mailbox.role === "owner"} />
				</div>
			)}
		</>
	);
}

/** Deleting the mailbox and all its mail, for an owner of it, after a question. */
function DeleteMailbox({ mailboxId, isOwner }: { mailboxId: string; isOwner: boolean }) {
	const toasts = useKumoToastManager();
	const navigate = useNavigate();
	const withFreshProof = useFreshProof();
	const deleteMailbox = useDeleteMailbox();
	const [asking, setAsking] = useState(false);
	// What waits to leave the mailbox is said first: a deleted mailbox sends nothing (ADR-0016).
	const { data: places = [] } = useFolders(asking ? mailboxId : undefined);
	const waiting = places.find((place) => place.id === Folders.SCHEDULED)?.waiting ?? 0;

	async function remove() {
		try {
			await withFreshProof(() => deleteMailbox.mutateAsync(mailboxId));
			toasts.add({ title: t("Mailbox deleted") });
			setAsking(false);
			await navigate({ to: "/admin/mailboxes" });
		} catch {
			toasts.add({ title: t("Failed to delete mailbox"), variant: "error" });
		}
	}

	return (
		<Card title={t("Delete this mailbox")}>
			{isOwner ? (
				<>
					<p className="m-0 text-sm text-kumo-subtle">
						{t("The mailbox and every message in it are deleted. This cannot be undone.")}
					</p>
					<Button className="mt-3" variant="destructive" onClick={() => setAsking(true)}>
						{t("Delete mailbox")}
					</Button>
				</>
			) : (
				<p className="m-0 text-sm text-kumo-subtle">
					{t("Only an owner of this mailbox can delete it.")}
				</p>
			)}
			<LayerDialog.Alert open={asking} onOpenChange={setAsking}>
				<LayerDialog.Content size="sm">
					<LayerDialog.Title>{t("Delete this mailbox?")}</LayerDialog.Title>
					<LayerDialog.Body>
						<p className="text-sm text-kumo-strong">
							{rich("{mailbox} and every message in it will be deleted. This cannot be undone.", {
								mailbox: <strong className="text-kumo-default">{mailboxId}</strong>,
							})}
						</p>
						{waiting > 0 && (
							<p className="mt-2 text-sm text-kumo-strong">
								{plural(
									waiting,
									"{count} message is waiting to be sent from it. It will not be sent.",
									"{count} messages are waiting to be sent from it. They will not be sent.",
								)}
							</p>
						)}
					</LayerDialog.Body>
					<LayerDialog.Actions dismissLabel={t("Cancel")}>
						<LayerDialog.Action
							variant="destructive"
							loading={deleteMailbox.isPending}
							onClick={() => void remove()}
						>
							{t("Delete")}
						</LayerDialog.Action>
					</LayerDialog.Actions>
				</LayerDialog.Content>
			</LayerDialog.Alert>
		</Card>
	);
}
