// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { Badge } from "@cloudflare/kumo";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { plural, t } from "~/i18n";
import { queryKeys } from "~/queries/keys";
import api from "~/services/api";

/**
 * Every mailbox on the instance, for its owners and administrators: who owns each one and how
 * many members it has. Managing is not reading: this lists no mail, and a mailbox you are not a
 * member of stays closed to you.
 */
export default function Registry() {
	const { data: mailboxes = [], isError } = useQuery({
		queryKey: queryKeys.registry,
		queryFn: api.listRegistry,
	});

	return (
		<section className="mt-8 rounded-xl border border-kumo-line bg-kumo-base p-5">
			<h2 className="text-base font-semibold text-kumo-default">{t("All mailboxes")}</h2>
			<p className="text-sm text-kumo-subtle mt-1">
				{t(
					"You manage who the members of every mailbox are. You read only the mailboxes you are a member of.",
				)}
			</p>
			{isError ? (
				<p role="alert" className="text-sm text-kumo-danger mt-3">
					{t("The mailboxes could not be loaded.")}
				</p>
			) : mailboxes.length === 0 ? (
				<p className="text-sm text-kumo-subtle mt-3">{t("There are no mailboxes yet.")}</p>
			) : (
				<ul className="mt-4 rounded-lg border border-kumo-line divide-y divide-kumo-line">
					{mailboxes.map((mailbox) => (
						<li
							key={mailbox.address}
							className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2"
						>
							<div className="min-w-0 flex-1">
								<p className="truncate text-sm text-kumo-default">{mailbox.address}</p>
								<p className="truncate text-xs text-kumo-subtle">
									{plural(mailbox.members, "{count} member", "{count} members")}
									{" · "}
									{t("owned by {owners}", { owners: mailbox.owners.join(", ") || t("nobody") })}
								</p>
							</div>
							<Badge variant={mailbox.role === null ? "outline" : "secondary"}>
								{mailbox.role === null ? t("Not a member") : t("You are a member")}
							</Badge>
							<Link
								to="/members/$mailboxId"
								params={{ mailboxId: mailbox.address }}
								className="text-sm underline text-kumo-default"
							>
								{t("Members")}
							</Link>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
