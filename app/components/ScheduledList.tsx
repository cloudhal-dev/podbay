// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { ClockIcon } from "@phosphor-icons/react";
import { useParams } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useOpenConversation } from "~/hooks/useOpenConversation";
import { useUIStore } from "~/hooks/useUIStore";
import { t } from "~/i18n";
import { timeWords } from "~/lib/sending-words";
import { getSnippetText } from "~/lib/utils";
import type { Email } from "~/types";

/**
 * Scheduled: what waits to leave, by its time, soonest first (ADR-0016, decision 2). Every
 * message is a line of its own, with who it goes to and when. A line opens the message, where
 * it can be sent now, given a new time, cancelled or edited; nothing is ticked, moved,
 * starred or labelled here, because nothing but those deeds changes a waiting message.
 */
export default function ScheduledList({
	title,
	emails,
	isLoading,
	empty,
}: {
	/** The page's heading, for assistive technology. */
	title: string;
	emails: Email[];
	isLoading: boolean;
	empty: ReactNode;
}) {
	const { mailboxId } = useParams({ strict: false });
	const open = useOpenConversation(mailboxId);
	const openId = useUIStore((state) => state.selectedEmailId);

	return (
		<>
			<h1 className="sr-only">{title}</h1>
			<p className="m-0 flex h-12 shrink-0 items-center gap-2 border-b border-kumo-line px-4 text-sm text-kumo-subtle">
				<ClockIcon size={16} aria-hidden="true" />
				{t("Messages here have not left yet. Each leaves at its time.")}
			</p>
			<div className="flex-1 overflow-y-auto">
				{emails.length === 0 ? (
					isLoading ? null : (
						empty
					)
				) : (
					<ul aria-label={title} className="m-0 list-none p-0">
						{emails.map((email) => {
							const snippet = getSnippetText(email.snippet, 140);
							const time = email.submission?.send_at ?? email.date;
							return (
								<li key={email.id} className="border-b border-kumo-line">
									<button
										type="button"
										id={`conversation-${email.id}`}
										onClick={() => open(email)}
										className={`flex min-h-10 w-full cursor-pointer flex-col gap-x-3 border-0 px-4 py-1.5 text-left text-sm hover:bg-kumo-tint @2xl:flex-row @2xl:items-center ${
											email.id === openId ? "bg-kumo-brand/15" : "bg-kumo-base"
										}`}
									>
										<span className="truncate text-kumo-strong @2xl:w-56 @2xl:shrink-0">
											{t("To: {recipients}", { recipients: email.recipient })}
										</span>
										<span className="block min-w-0 truncate @2xl:flex-1">
											<span className="text-kumo-default">
												{email.subject || t("(no subject)")}
											</span>
											{snippet && <span className="text-kumo-subtle"> — {snippet}</span>}
										</span>
										<span className="shrink-0 text-xs font-medium text-kumo-default">
											{email.submission?.state === "sending" ? t("Being sent") : timeWords(time)}
										</span>
									</button>
								</li>
							);
						})}
					</ul>
				)}
			</div>
		</>
	);
}
