// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified by the Podbay contributors.

import { Loader, Tabs } from "@cloudflare/kumo";
import { Link, useParams, useSearch } from "@tanstack/react-router";
import AccountSettings from "~/components/settings/AccountSettings";
import AssistantSettings from "~/components/settings/AssistantSettings";
import AutoReplySettings from "~/components/settings/AutoReplySettings";
import FilterSettings from "~/components/settings/FilterSettings";
import GeneralSettings from "~/components/settings/GeneralSettings";
import LabelSettings from "~/components/settings/LabelSettings";
import MailboxDetails from "~/components/settings/MailboxDetails";
import SignatureSettings from "~/components/settings/SignatureSettings";
import { m, t } from "~/i18n";
import { useFeatures } from "~/queries/config";
import { useMailbox } from "~/queries/mailboxes";

const TABS = [
	{ id: "general", name: m("General") },
	{ id: "signature", name: m("Signature") },
	{ id: "labels", name: m("Labels") },
	{ id: "filters", name: m("Filters and blocked senders") },
	{ id: "auto-reply", name: m("Automatic reply") },
	{ id: "mailbox", name: m("Mailbox") },
	{ id: "assistant", name: m("Assistant") },
	{ id: "account", name: m("Account") },
] as const;
type TabId = (typeof TABS)[number]["id"];

/**
 * Settings, in tabs as a mail client has them. General is the reader's own choices, kept with
 * their account; the other tabs are about the mailbox and are saved to it.
 */
export default function SettingsRoute() {
	const { mailboxId = "" } = useParams({ strict: false });
	const search = useSearch({ strict: false }) as { tab?: string };
	const { data: mailbox } = useMailbox(mailboxId);
	const features = useFeatures();
	const tabs = TABS.filter((tab) => tab.id !== "assistant" || features.agent);
	const current: TabId = tabs.find((tab) => tab.id === search.tab)?.id ?? "general";

	if (!mailbox) {
		return (
			<div className="flex justify-center py-20">
				<Loader size="lg" />
			</div>
		);
	}

	return (
		<div className="h-full overflow-y-auto">
			<div className="px-4 pt-5 md:px-8">
				<h1 className="m-0 text-[22px] font-normal leading-7 text-kumo-default">{t("Settings")}</h1>
				{/* Kumo's tabs: a row wider than the column scrolls, and a mark at its edge says so (#118).
				    Kumo 2.18.1 draws that mark on its segmented tabs only, and brings the section in use
				    into view when the screen opens on it. Each section is a link, so it keeps its own
				    address. */}
				<nav aria-label={t("Settings")} className="mt-4">
					<Tabs
						variant="segmented"
						// As wide as its sections, and never wider than the column: past that it scrolls.
						className="w-fit max-w-full"
						value={current}
						labels={{ scrollStart: t("Earlier sections"), scrollEnd: t("Later sections") }}
						tabs={tabs.map((tab) => ({
							value: tab.id,
							label: t(tab.name),
							nativeButton: false,
							render: (
								<Link
									to="/mailbox/$mailboxId/settings"
									params={{ mailboxId }}
									search={{ tab: tab.id }}
									className="no-underline"
								/>
							),
						}))}
					/>
				</nav>
			</div>
			<div className="max-w-3xl px-4 py-5 md:px-8">
				<h2 className="sr-only">{t(tabs.find((tab) => tab.id === current)?.name ?? "")}</h2>
				{current === "general" && <GeneralSettings />}
				{current === "signature" && <SignatureSettings mailbox={mailbox} />}
				{current === "labels" && (
					<LabelSettings mailboxId={mailboxId} canChange={mailbox.role !== "reader"} />
				)}
				{current === "filters" && (
					<FilterSettings mailboxId={mailboxId} canChange={mailbox.role === "owner"} />
				)}
				{current === "auto-reply" && (
					<AutoReplySettings mailboxId={mailboxId} canChange={mailbox.role === "owner"} />
				)}
				{current === "mailbox" && <MailboxDetails mailbox={mailbox} />}
				{current === "assistant" && <AssistantSettings mailbox={mailbox} />}
				{current === "account" && <AccountSettings />}
			</div>
		</div>
	);
}
