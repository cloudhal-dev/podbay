// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { t } from "~/i18n";
import { useMe } from "~/lib/session";
import Invitations from "./Invitations";
import InvitePerson from "./InvitePerson";
import PageHead from "./PageHead";
import People from "./People";
import { useAdminTitle } from "./useAdminTitle";

/** People (#127): everyone with an account, the invitations, and inviting a person. */
export default function PeoplePage() {
	useAdminTitle(t("People"));
	const { data: me } = useMe();
	if (!me) return null;
	return (
		<>
			<PageHead
				crumbs={[{ label: t("People") }]}
				title={t("People")}
				description={t("Everyone with an account on this instance, and the people invited to it.")}
			/>
			<div className="space-y-6">
				<People me={me} />
				<Invitations />
				<InvitePerson canInviteAdmin={me.role === "owner"} />
			</div>
		</>
	);
}
