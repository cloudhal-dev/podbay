// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { Badge, Button, Table } from "@cloudflare/kumo";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import CopyButton from "~/components/CopyButton";
import { useFreshProof } from "~/components/FreshProof";
import { dateLanguage, m, t } from "~/i18n";
import { issueRecovery, listPeople, type Me, type Person, type RecoveryLink } from "~/lib/session";
import { ApiError } from "~/services/api";

const ROLE_LABEL = { owner: m("Owner"), admin: m("Administrator"), member: m("Member") } as const;

/** Whether the signed-in person may issue a recovery link for `person`. The Worker decides again. */
function canRecover(me: Me, person: Person): boolean {
	if (person.id === me.user.id) return false;
	return me.role === "owner" || (me.role === "admin" && person.role === "member");
}

/**
 * The people on the instance, and the way back in for one who cannot sign in any more: a
 * recovery link, made here and passed on by a channel the two already trust.
 */
export default function People({ me }: { me: Me }) {
	const withFreshProof = useFreshProof();
	const { data: people = [], isError } = useQuery({ queryKey: ["people"], queryFn: listPeople });
	const [busy, setBusy] = useState<string | null>(null);
	const [issued, setIssued] = useState<RecoveryLink | null>(null);
	const [error, setError] = useState<string | null>(null);

	async function recover(person: Person) {
		setBusy(person.id);
		setError(null);
		setIssued(null);
		try {
			setIssued(await withFreshProof(() => issueRecovery(person.id)));
		} catch (caught) {
			setError(
				caught instanceof ApiError ? caught.message : t("The recovery link could not be created."),
			);
		} finally {
			setBusy(null);
		}
	}

	const role = (person: Person) => (
		<Badge variant={person.role === "member" ? "outline" : "secondary"}>
			{t(ROLE_LABEL[person.role])}
		</Badge>
	);

	return (
		<section className="rounded-xl border border-kumo-line bg-kumo-base p-5">
			<h2 className="text-base font-semibold text-kumo-default">{t("People")}</h2>
			<p className="text-sm text-kumo-subtle mt-1">
				{t(
					"Everyone with an account here. A recovery link lets a person who cannot sign in choose a new password; make one only when you are sure who is asking.",
				)}
			</p>
			{isError ? (
				<p role="alert" className="text-sm text-kumo-danger mt-3">
					{t("The list of people could not be loaded.")}
				</p>
			) : (
				<div className="mt-4 overflow-hidden rounded-lg border border-kumo-line">
					<Table aria-label={t("People")}>
						<Table.Header>
							<Table.Row>
								<Table.Head>{t("Person")}</Table.Head>
								{/* On a narrow screen the role is under the address, not in a column. */}
								<Table.Head className="hidden sm:table-cell">{t("Role")}</Table.Head>
								<Table.Head className="w-0">
									<span className="sr-only">{t("Actions")}</span>
								</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{people.map((person) => (
								<Table.Row key={person.id}>
									<Table.Cell className="max-w-0">
										<p className="truncate text-sm text-kumo-default">{person.name}</p>
										<p className="truncate text-xs text-kumo-subtle">{person.email}</p>
										<div className="mt-1 sm:hidden">{role(person)}</div>
									</Table.Cell>
									<Table.Cell className="hidden sm:table-cell">{role(person)}</Table.Cell>
									<Table.Cell className="text-right">
										{canRecover(me, person) && (
											<Button
												variant="ghost"
												size="sm"
												loading={busy === person.id}
												onClick={() => recover(person)}
												aria-label={t("A recovery link for {email}", { email: person.email })}
											>
												{t("Recovery link")}
											</Button>
										)}
									</Table.Cell>
								</Table.Row>
							))}
						</Table.Body>
					</Table>
				</div>
			)}
			{error && (
				<p role="alert" className="text-sm text-kumo-danger mt-3">
					{error}
				</p>
			)}
			{issued && (
				<div className="mt-4 rounded-md bg-kumo-tint px-3 py-2 space-y-1">
					<p className="text-sm text-kumo-strong">
						{t(
							"Give this link to {email} yourself, by a channel you trust. It works once, until {date}, and is shown only now. Using it ends their sessions and removes their authenticator app, passkeys and keys.",
							{
								email: issued.email,
								date: new Date(issued.expiresAt).toLocaleString(dateLanguage(), {
									dateStyle: "medium",
									timeStyle: "short",
								}),
							},
						)}
					</p>
					<div className="flex items-start gap-1">
						<code className="flex-1 break-all text-xs text-kumo-default">{issued.link}</code>
						<CopyButton text={issued.link} label={t("Copy the recovery link")} />
					</div>
				</div>
			)}
		</section>
	);
}
