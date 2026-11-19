// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { Badge, Banner, Button, Empty, Loader, Table, useKumoToastManager } from "@cloudflare/kumo";
import { EnvelopeOpenIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useConfirm } from "~/components/Confirm";
import { dateLanguage, m, t } from "~/i18n";
import { type Invitation, listInvitations, withdrawInvitation } from "~/lib/session";
import Card from "./Card";

/** The query of the instance's invitations; inviting a person reads it again. */
export const INVITATIONS = ["invitations"] as const;

const STATE_LABEL = {
	pending: m("Waiting"),
	accepted: m("Accepted"),
	revoked: m("Withdrawn"),
	expired: m("Expired"),
} as const;
const ROLE_LABEL = { admin: m("Administrator"), member: m("Member") } as const;

const dateOf = (instant: string) =>
	new Date(instant).toLocaleDateString(dateLanguage(), { dateStyle: "medium" });

/**
 * The invitations of the instance, newest first, with their state. One that waits can be
 * withdrawn: its link stops working. The link itself is never shown again; it was shown once,
 * to the person who made it.
 */
export default function Invitations() {
	const queryClient = useQueryClient();
	const toasts = useKumoToastManager();
	const confirm = useConfirm();
	const {
		data: invitations = [],
		isPending,
		isError,
	} = useQuery({
		queryKey: INVITATIONS,
		queryFn: listInvitations,
	});
	const [busy, setBusy] = useState<string | null>(null);

	async function withdraw(invitation: Invitation) {
		const yes = await confirm({
			title: t("Withdraw the invitation?"),
			body: t("The link sent to {email} stops working. You can invite them again.", {
				email: invitation.email,
			}),
			action: t("Withdraw"),
			destructive: true,
		});
		if (!yes) return;
		setBusy(invitation.id);
		try {
			await withdrawInvitation(invitation.id);
			toasts.add({ title: t("The invitation is withdrawn") });
		} catch {
			toasts.add({ title: t("The invitation could not be withdrawn"), variant: "error" });
		} finally {
			setBusy(null);
			void queryClient.invalidateQueries({ queryKey: INVITATIONS });
		}
	}

	const state = (invitation: Invitation) => (
		<Badge variant={invitation.state === "pending" ? "secondary" : "outline"}>
			{t(STATE_LABEL[invitation.state])}
		</Badge>
	);

	return (
		<Card
			title={t("Invitations")}
			description={t("Each invitation is a link that works once, until the date beside it.")}
		>
			{isPending ? (
				<div className="flex justify-center py-6">
					<Loader />
				</div>
			) : isError ? (
				<Banner variant="error" text={t("The invitations could not be loaded.")} />
			) : invitations.length === 0 ? (
				<Empty
					size="sm"
					icon={<EnvelopeOpenIcon size={32} />}
					title={t("No one has been invited yet.")}
				/>
			) : (
				<div className="overflow-hidden rounded-lg border border-kumo-line">
					<Table aria-label={t("Invitations")}>
						<Table.Header>
							<Table.Row>
								<Table.Head>{t("Invited")}</Table.Head>
								{/* On a narrow screen the state is under the address, not in a column. */}
								<Table.Head className="hidden sm:table-cell">{t("State")}</Table.Head>
								<Table.Head className="w-0">
									<span className="sr-only">{t("Actions")}</span>
								</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{invitations.map((invitation) => (
								<Table.Row key={invitation.id}>
									<Table.Cell className="max-w-0">
										<p className="truncate text-sm text-kumo-default">{invitation.email}</p>
										<p className="truncate text-xs text-kumo-subtle">
											{t(ROLE_LABEL[invitation.role])} ·{" "}
											{t("until {date}", { date: dateOf(invitation.expiresAt) })}
										</p>
										<div className="mt-1 sm:hidden">{state(invitation)}</div>
									</Table.Cell>
									<Table.Cell className="hidden sm:table-cell">{state(invitation)}</Table.Cell>
									<Table.Cell className="text-right">
										{invitation.state === "pending" && (
											<Button
												variant="ghost"
												size="sm"
												loading={busy === invitation.id}
												onClick={() => void withdraw(invitation)}
												aria-label={t("Withdraw the invitation of {email}", {
													email: invitation.email,
												})}
											>
												{t("Withdraw")}
											</Button>
										)}
									</Table.Cell>
								</Table.Row>
							))}
						</Table.Body>
					</Table>
				</div>
			)}
		</Card>
	);
}
