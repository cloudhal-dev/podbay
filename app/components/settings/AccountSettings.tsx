// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { Link } from "@tanstack/react-router";
import { t } from "~/i18n";
import { useMe } from "~/lib/session";
import Row from "./Row";

const LINK = "text-sm text-kumo-default underline";

/**
 * The person's own account, as far as the settings of a mailbox point to it. What belongs to
 * the account is changed on its own pages, which ask for fresh proof; this tab says where.
 */
export default function AccountSettings() {
	const { data: me } = useMe();
	return (
		<div>
			<Row
				name={t("Signed in as")}
				about={t("The account these settings and this mail are open with.")}
			>
				<span className="break-all">{me?.user.email}</span>
			</Row>
			<Row
				name={t("Sign-in and security")}
				about={t(
					"Your password, your passkeys, your authenticator app, and the browsers you are signed in with.",
				)}
			>
				<Link to="/account/security" className={LINK}>
					{t("Open sign-in and security")}
				</Link>
			</Row>
			<Row
				name={t("Mailboxes and programs")}
				about={t("The mailboxes you can open, and the keys of the AI clients you connected.")}
			>
				<Link to="/" className={LINK}>
					{t("All mailboxes")}
				</Link>
			</Row>
		</div>
	);
}
