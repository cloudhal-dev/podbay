// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { Badge, Empty, Grid } from "@cloudflare/kumo";
import { EnvelopeOpenIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { dateLanguage, plural, t } from "~/i18n";
import { listInvitations, listPeople } from "~/lib/session";
import { queryKeys } from "~/queries/keys";
import api from "~/services/api";
import Card from "./Card";
import Figure from "./Figure";
import { INVITATIONS } from "./Invitations";
import PageHead from "./PageHead";
import { useAdminTitle } from "./useAdminTitle";

/**
 * The Overview (#127): the instance at a glance, from what the accounts database already knows
 * through the area's own routes: how many people and mailboxes there are, and what waits for
 * the people who manage it. The figures of mail and the charts join it under ADR-0019, in the
 * wide column the row under the figures keeps for them.
 */
export default function OverviewPage() {
	useAdminTitle(t("Overview"));
	const people = useQuery({ queryKey: ["people"], queryFn: listPeople });
	const mailboxes = useQuery({ queryKey: queryKeys.registry, queryFn: api.listRegistry });
	const invitations = useQuery({ queryKey: INVITATIONS, queryFn: listInvitations });
	const waiting = (invitations.data ?? []).filter((one) => one.state === "pending");
	const count = (role: string) => (people.data ?? []).filter((one) => one.role === role).length;
	const recent = [...(mailboxes.data ?? [])].slice(0, 5);

	return (
		<>
			<PageHead
				crumbs={[{ label: t("Overview") }]}
				title={t("Overview")}
				description={t("The instance at a glance, and what waits for you.")}
			/>
			<div className="space-y-6">
				<Grid variant="3up" gap="base">
					<Figure
						label={t("People")}
						value={people.data?.length}
						detail={
							people.data &&
							[
								plural(count("owner"), "{count} owner", "{count} owners"),
								plural(count("admin"), "{count} administrator", "{count} administrators"),
								plural(count("member"), "{count} member", "{count} members"),
							].join(" · ")
						}
						to="/admin/people"
						linkLabel={t("See people")}
					/>
					<Figure
						label={t("Mailboxes")}
						value={mailboxes.data?.length}
						detail={
							mailboxes.data &&
							plural(
								mailboxes.data.filter((one) => one.role !== null).length,
								"you are a member of {count}",
								"you are a member of {count}",
							)
						}
						to="/admin/mailboxes"
						linkLabel={t("See mailboxes")}
					/>
					<Figure
						label={t("Invitations waiting")}
						value={invitations.data ? waiting.length : undefined}
						detail={t("Links not used yet")}
						to="/admin/people"
						linkLabel={t("See invitations")}
					/>
				</Grid>
				<Grid variant="2-1" gap="base" className="items-start">
					<Card title={t("Mailboxes")}>
						{(mailboxes.data ?? []).length === 0 ? (
							<Empty size="sm" title={t("There are no mailboxes yet.")} />
						) : (
							<ul className="m-0 list-none divide-y divide-kumo-line rounded-lg border border-kumo-line p-0">
								{recent.map((mailbox) => (
									<li key={mailbox.address} className="flex items-center gap-3 px-3 py-2">
										<Link
											to="/admin/mailboxes/$mailboxId"
											params={{ mailboxId: mailbox.address }}
											className="min-w-0 flex-1 truncate text-sm text-kumo-default underline"
										>
											{mailbox.address}
										</Link>
										<span className="shrink-0 text-xs text-kumo-subtle">
											{plural(mailbox.members, "{count} member", "{count} members")}
										</span>
									</li>
								))}
							</ul>
						)}
					</Card>
					<Card title={t("Invitations waiting")}>
						{waiting.length === 0 ? (
							<Empty
								size="sm"
								icon={<EnvelopeOpenIcon size={32} />}
								title={t("No invitation is waiting.")}
							/>
						) : (
							<ul className="m-0 list-none space-y-2 p-0">
								{waiting.slice(0, 5).map((invitation) => (
									<li key={invitation.id} className="min-w-0">
										<p className="m-0 truncate text-sm text-kumo-default">{invitation.email}</p>
										<p className="m-0 text-xs text-kumo-subtle">
											<Badge variant="outline">
												{invitation.role === "admin" ? t("Administrator") : t("Member")}
											</Badge>{" "}
											{t("until {date}", {
												date: new Date(invitation.expiresAt).toLocaleDateString(dateLanguage(), {
													dateStyle: "medium",
												}),
											})}
										</p>
									</li>
								))}
							</ul>
						)}
					</Card>
				</Grid>
			</div>
		</>
	);
}
