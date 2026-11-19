// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { ArrowLeftIcon } from "@phosphor-icons/react";
import { Link, Navigate, useParams } from "@tanstack/react-router";
import { managesInstance } from "~/admin/AdminLayout";
import MailboxMembers from "~/admin/MailboxMembers";
import { t } from "~/i18n";
import { useMe } from "~/lib/session";

/**
 * A mailbox's members at their old address (#127). Whoever manages the instance has them on the
 * mailbox's page in the administration area and is taken there; a mailbox's own owner, who does
 * not manage the instance, keeps this page, reached from the mailbox's settings.
 */
export default function MembersRoute() {
	const { mailboxId = "" } = useParams({ strict: false });
	const { data: me, isPending } = useMe();
	if (isPending) return null;
	if (managesInstance(me?.role)) {
		return <Navigate to="/admin/mailboxes/$mailboxId" params={{ mailboxId }} replace />;
	}
	return (
		<div className="min-h-screen bg-kumo-recessed">
			<div className="mx-auto max-w-2xl space-y-5 px-4 py-10">
				<div>
					<Link
						to="/"
						className="inline-flex items-center gap-1 text-sm text-kumo-subtle underline"
					>
						<ArrowLeftIcon size={14} /> {t("Mailboxes")}
					</Link>
					<h1 className="mt-2 text-2xl font-bold text-kumo-default">{t("Members")}</h1>
					<p className="mt-1 break-all text-sm text-kumo-subtle">{mailboxId}</p>
				</div>
				<MailboxMembers mailboxId={mailboxId} />
			</div>
		</div>
	);
}
