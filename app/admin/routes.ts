// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { type AnyRoute, createRoute, redirect } from "@tanstack/react-router";
import AdminLayout from "./AdminLayout";
import MailboxesPage from "./MailboxesPage";
import MailboxPage from "./MailboxPage";
import PeoplePage from "./PeoplePage";

/**
 * The routes of the administration area under `/admin` (#127), made under the router's root. The
 * area keeps its screens in this directory and reaches into none of the mail screens.
 */
export function adminRoutes(root: AnyRoute) {
	const area = createRoute({ getParentRoute: () => root, path: "/admin", component: AdminLayout });
	// The area opens on its first part until it has an overview of its own.
	const index = createRoute({
		getParentRoute: () => area,
		path: "/",
		beforeLoad: () => {
			throw redirect({ to: "/admin/people", replace: true });
		},
	});
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
	});
	return area.addChildren([index, people, mailboxes, mailbox]);
}
