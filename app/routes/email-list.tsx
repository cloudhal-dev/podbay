// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified by the Podbay contributors.

import { Button } from "@cloudflare/kumo";
import {
	ArchiveIcon,
	ClockIcon,
	EnvelopeSimpleIcon,
	FileIcon,
	PaperPlaneTiltIcon,
	PencilSimpleIcon,
	TrashIcon,
	TrayIcon,
} from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Folders } from "shared/folders";
import EmptyPlace from "~/components/EmptyPlace";
import MailView from "~/components/MailView";
import MessageList from "~/components/MessageList";
import ScheduledList from "~/components/ScheduledList";
import { useDisplay } from "~/hooks/useDisplay";
import { useAskEvery } from "~/hooks/useLive";
import { useUIStore } from "~/hooks/useUIStore";
import { m, t } from "~/i18n";
import { placeName } from "~/lib/places";
import { useEmails } from "~/queries/emails";
import { useFolders } from "~/queries/folders";
import { queryKeys } from "~/queries/keys";

const FOLDER_EMPTY_STATES: Record<
	string,
	{
		icon: React.ReactNode;
		title: string;
		description: string;
		showCompose?: boolean;
	}
> = {
	[Folders.INBOX]: {
		icon: <TrayIcon size={48} weight="thin" className="text-kumo-subtle" />,
		title: m("Your inbox is empty"),
		description: m(
			"New emails will appear here when they arrive. Send an email to get the conversation started.",
		),
		showCompose: true,
	},
	[Folders.SENT]: {
		icon: <PaperPlaneTiltIcon size={48} weight="thin" className="text-kumo-subtle" />,
		title: m("No sent emails"),
		description: m("Emails you send will show up here."),
		showCompose: true,
	},
	[Folders.DRAFT]: {
		icon: <FileIcon size={48} weight="thin" className="text-kumo-subtle" />,
		title: m("No drafts"),
		description: m("Emails you're still working on will be saved here."),
		showCompose: true,
	},
	[Folders.SCHEDULED]: {
		icon: <ClockIcon size={48} weight="thin" className="text-kumo-subtle" />,
		title: m("Nothing is waiting to be sent"),
		description: m("A message you send later waits here until its time."),
	},
	[Folders.ARCHIVE]: {
		icon: <ArchiveIcon size={48} weight="thin" className="text-kumo-subtle" />,
		title: m("Archive is empty"),
		description: m("Move emails here to keep your inbox clean without deleting them."),
	},
	[Folders.TRASH]: {
		icon: <TrashIcon size={48} weight="thin" className="text-kumo-subtle" />,
		title: m("Trash is empty"),
		description: m(
			"Deleted emails will appear here. You can restore them or permanently delete them.",
		),
	},
};

function FolderEmptyState({ folder, onCompose }: { folder?: string; onCompose: () => void }) {
	const config = (folder && FOLDER_EMPTY_STATES[folder]) || {
		icon: <EnvelopeSimpleIcon size={48} weight="thin" className="text-kumo-subtle" />,
		title: m("No emails"),
		description: m("This folder is empty."),
	};

	return (
		<div className="flex flex-col items-center justify-center py-24 px-6 text-center">
			<div className="mb-4">{config.icon}</div>
			<h3 className="text-base font-semibold text-kumo-default mb-1.5">{t(config.title)}</h3>
			<p className="text-sm text-kumo-subtle max-w-xs mb-5">{t(config.description)}</p>
			{"showCompose" in config && config.showCompose && (
				<Button
					variant="primary"
					size="sm"
					icon={<PencilSimpleIcon size={16} />}
					onClick={onCompose}
				>
					{t("Compose")}
				</Button>
			)}
		</div>
	);
}

export default function EmailListRoute() {
	const { mailboxId, folder } = useParams({ strict: false });
	const { startCompose } = useUIStore();
	const [page, setPage] = useState(1);
	const pageSize = useDisplay((state) => state.pageSize);
	const conversations = useDisplay((state) => state.conversationView);
	const order = useDisplay((state) => state.order);
	const queryClient = useQueryClient();

	const isScheduled = folder === Folders.SCHEDULED;
	const params = useMemo(
		() => ({
			folder: folder || "",
			// What waits is one page: a mailbox holds a hundred waiting messages at most.
			page: isScheduled ? "1" : String(page),
			limit: isScheduled ? "100" : String(pageSize),
			threaded: String(conversations),
			// Newest first needs no word; the Worker acts on the request, never on a stored choice.
			...(order === "newest" ? {} : { order }),
		}),
		[folder, isScheduled, page, pageSize, conversations, order],
	);
	// The mailbox says when something changed (ADR-0013); the list still asks by itself, every
	// half minute while nothing is telling it and every five minutes while something is.
	const askEvery = useAskEvery(mailboxId);
	const { data: emailData, isFetching: isRefreshing } = useEmails(mailboxId, params, {
		refetchInterval: askEvery,
	});
	const { data: folders = [] } = useFolders(mailboxId);

	const folderName = useMemo(() => {
		const found = folders.find((f) => f.id === folder);
		return found ? placeName(found.id) : placeName(folder || Folders.INBOX);
	}, [folders, folder]);

	// A different folder starts on its first page.
	// biome-ignore lint/correctness/useExhaustiveDependencies: the folder is the trigger
	useEffect(() => {
		setPage(1);
	}, [mailboxId, folder, order]);

	const handleRefresh = () => {
		if (!mailboxId) return;
		queryClient.invalidateQueries({ queryKey: ["emails", mailboxId] });
		queryClient.invalidateQueries({ queryKey: queryKeys.folders.list(mailboxId) });
	};

	if (isScheduled) {
		return (
			<MailView emails={emailData?.emails ?? []}>
				<ScheduledList
					title={folderName}
					emails={emailData?.emails ?? []}
					isLoading={isRefreshing}
					empty={<FolderEmptyState folder={folder} onCompose={() => startCompose()} />}
				/>
			</MailView>
		);
	}

	return (
		<MailView emails={emailData?.emails ?? []}>
			{mailboxId && (
				<EmptyPlace mailboxId={mailboxId} place={folder} count={emailData?.totalCount ?? 0} />
			)}
			<MessageList
				title={folderName}
				emails={emailData?.emails ?? []}
				totalCount={emailData?.totalCount ?? 0}
				page={page}
				setPage={setPage}
				pageSize={pageSize}
				isLoading={isRefreshing}
				isRefreshing={isRefreshing}
				onRefresh={handleRefresh}
				folder={folder}
				// Drafts are not moved together: each is kept or discarded by itself.
				everything={
					folder && folder !== Folders.DRAFT
						? {
								filter: { folder },
								offer: t("Select everything in {place}", { place: folderName }),
								chosen: t("Everything in {place} is selected.", { place: folderName }),
							}
						: undefined
				}
				empty={<FolderEmptyState folder={folder} onCompose={() => startCompose()} />}
			/>
		</MailView>
	);
}
