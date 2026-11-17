// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { Badge, Button } from "@cloudflare/kumo";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { dateLanguage, m, t } from "~/i18n";
import { issueRecovery, listPeople, type Me, type Person, type RecoveryLink } from "~/lib/session";
import { ApiError } from "~/services/api";
import CopyButton from "./CopyButton";
import { useFreshProof } from "./FreshProof";

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

	return (
		<section className="mt-8 rounded-xl border border-kumo-line bg-kumo-base p-5">
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
				<ul className="mt-4 rounded-lg border border-kumo-line divide-y divide-kumo-line">
					{people.map((person) => (
						<li key={person.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
							<div className="min-w-0 flex-1">
								<p className="truncate text-sm text-kumo-default">{person.name}</p>
								<p className="truncate text-xs text-kumo-subtle">{person.email}</p>
							</div>
							<Badge variant={person.role === "member" ? "outline" : "secondary"}>
								{t(ROLE_LABEL[person.role])}
							</Badge>
							{canRecover(me, person) && (
								<Button
									variant="ghost"
									size="sm"
									loading={busy === person.id}
									onClick={() => recover(person)}
								>
									{t("Recovery link")}
								</Button>
							)}
						</li>
					))}
				</ul>
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
