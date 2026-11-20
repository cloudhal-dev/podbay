// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { type AnyRoute, createRoute } from "@tanstack/react-router";
import AdminLayout from "./AdminLayout";
import MailboxesPage from "./MailboxesPage";
import MailboxPage, { MAILBOX_TABS, type MailboxTab } from "./MailboxPage";
import OverviewPage from "./OverviewPage";
import PeoplePage from "./PeoplePage";

/**
 * The routes of the administration area under `/admin` (#127), made under the router's root. The
 * area keeps its screens in this directory and reaches into none of the mail screens.
 */
export function adminRoutes(root: AnyRoute) {
	const area = createRoute({ getParentRoute: () => root, path: "/admin", component: AdminLayout });
	const index = createRoute({ getParentRoute: () => area, path: "/", component: OverviewPage });
	const people = createRoute({ getParentRoute: () => area, path: "people", component: PeoplePage });
	const mailboxes = createRoute({
		getParentRoute: () => area,
		path: "mailboxes",
		component: MailboxesPage,
	});
	const mailbox = createRoute({
		getParentRoute: () => area,
		path: "mailboxes/$mailboxId",
		component: MailboxPage,
		// The part of the mailbox shown, in the address so it can be linked to.
		validateSearch: (search: Record<string, unknown>): { tab?: MailboxTab } => ({
			tab: MAILBOX_TABS.includes(search.tab as MailboxTab) ? (search.tab as MailboxTab) : undefined,
		}),
	});
	return area.addChildren([index, people, mailboxes, mailbox]);
}
