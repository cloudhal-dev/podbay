// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified by the Podbay contributors.

import { Loader } from "@cloudflare/kumo";
import { Link, useParams, useSearch } from "@tanstack/react-router";
import AssistantSettings from "~/components/settings/AssistantSettings";
import GeneralSettings from "~/components/settings/GeneralSettings";
import LabelSettings from "~/components/settings/LabelSettings";
import MailboxDetails from "~/components/settings/MailboxDetails";
import SignatureSettings from "~/components/settings/SignatureSettings";
import { useFeatures } from "~/queries/config";
import { useMailbox } from "~/queries/mailboxes";

const TABS = [
	{ id: "general", name: "General" },
	{ id: "signature", name: "Signature" },
	{ id: "labels", name: "Labels" },
	{ id: "mailbox", name: "Mailbox" },
	{ id: "assistant", name: "Assistant" },
] as const;
type TabId = (typeof TABS)[number]["id"];

/**
 * Settings, in tabs as a mail client has them. General is the reader's own choices, kept in
 * their browser; the other tabs are about the mailbox and are saved to it.
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
				<h1 className="m-0 text-[22px] font-normal leading-7 text-kumo-default">Settings</h1>
				<nav
					aria-label="Settings"
					className="mt-4 flex gap-1 overflow-x-auto border-b border-kumo-line"
				>
					{tabs.map((tab) => (
						<Link
							key={tab.id}
							to="/mailbox/$mailboxId/settings"
							params={{ mailboxId }}
							search={{ tab: tab.id }}
							aria-current={current === tab.id ? "page" : undefined}
							className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-sm no-underline ${
								current === tab.id
									? "border-kumo-brand font-semibold text-kumo-default"
									: "border-transparent text-kumo-subtle hover:text-kumo-default"
							}`}
						>
							{tab.name}
						</Link>
					))}
				</nav>
			</div>
			<div className="max-w-3xl px-4 py-5 md:px-8">
				<h2 className="sr-only">{tabs.find((tab) => tab.id === current)?.name}</h2>
				{current === "general" && <GeneralSettings />}
				{current === "signature" && <SignatureSettings mailbox={mailbox} />}
				{current === "labels" && (
					<LabelSettings mailboxId={mailboxId} canChange={mailbox.role !== "reader"} />
				)}
				{current === "mailbox" && <MailboxDetails mailbox={mailbox} />}
				{current === "assistant" && <AssistantSettings mailbox={mailbox} />}
			</div>
		</div>
	);
}
