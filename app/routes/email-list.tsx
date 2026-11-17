// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified by the Podbay contributors.

import { Button } from "@cloudflare/kumo";
import {
	ArchiveIcon,
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
import { Folders, getFolderDisplayName } from "shared/folders";
import MailView from "~/components/MailView";
import MessageList from "~/components/MessageList";
import { useUIStore } from "~/hooks/useUIStore";
import { useEmails } from "~/queries/emails";
import { useFolders } from "~/queries/folders";
import { queryKeys } from "~/queries/keys";

const PAGE_SIZE = 25;

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
		title: "Your inbox is empty",
		description:
			"New emails will appear here when they arrive. Send an email to get the conversation started.",
		showCompose: true,
	},
	[Folders.SENT]: {
		icon: <PaperPlaneTiltIcon size={48} weight="thin" className="text-kumo-subtle" />,
		title: "No sent emails",
		description: "Emails you send will show up here.",
		showCompose: true,
	},
	[Folders.DRAFT]: {
		icon: <FileIcon size={48} weight="thin" className="text-kumo-subtle" />,
		title: "No drafts",
		description: "Emails you're still working on will be saved here.",
		showCompose: true,
	},
	[Folders.ARCHIVE]: {
		icon: <ArchiveIcon size={48} weight="thin" className="text-kumo-subtle" />,
		title: "Archive is empty",
		description: "Move emails here to keep your inbox clean without deleting them.",
	},
	[Folders.TRASH]: {
		icon: <TrashIcon size={48} weight="thin" className="text-kumo-subtle" />,
		title: "Trash is empty",
		description:
			"Deleted emails will appear here. You can restore them or permanently delete them.",
	},
};

function FolderEmptyState({ folder, onCompose }: { folder?: string; onCompose: () => void }) {
	const config = (folder && FOLDER_EMPTY_STATES[folder]) || {
		icon: <EnvelopeSimpleIcon size={48} weight="thin" className="text-kumo-subtle" />,
		title: "No emails",
		description: "This folder is empty.",
	};

	return (
		<div className="flex flex-col items-center justify-center py-24 px-6 text-center">
			<div className="mb-4">{config.icon}</div>
			<h3 className="text-base font-semibold text-kumo-default mb-1.5">{config.title}</h3>
			<p className="text-sm text-kumo-subtle max-w-xs mb-5">{config.description}</p>
			{"showCompose" in config && config.showCompose && (
				<Button
					variant="primary"
					size="sm"
					icon={<PencilSimpleIcon size={16} />}
					onClick={onCompose}
				>
					Compose
				</Button>
			)}
		</div>
	);
}

export default function EmailListRoute() {
	const { mailboxId, folder } = useParams({ strict: false });
	const { startCompose } = useUIStore();
	const [page, setPage] = useState(1);
	const queryClient = useQueryClient();

	const params = useMemo(
		() => ({ folder: folder || "", page: String(page), limit: String(PAGE_SIZE) }),
		[folder, page],
	);
	const { data: emailData, isFetching: isRefreshing } = useEmails(mailboxId, params, {
		refetchInterval: 30_000,
	});
	const { data: folders = [] } = useFolders(mailboxId);

	const folderName = useMemo(() => {
		const found = folders.find((f) => f.id === folder);
		return found ? found.name : getFolderDisplayName(folder || Folders.INBOX);
	}, [folders, folder]);

	// A different folder starts on its first page.
	// biome-ignore lint/correctness/useExhaustiveDependencies: the folder is the trigger
	useEffect(() => {
		setPage(1);
	}, [mailboxId, folder]);

	const handleRefresh = () => {
		if (!mailboxId) return;
		queryClient.invalidateQueries({ queryKey: ["emails", mailboxId] });
		queryClient.invalidateQueries({ queryKey: queryKeys.folders.list(mailboxId) });
	};

	return (
		<MailView>
			<MessageList
				title={folderName}
				emails={emailData?.emails ?? []}
				totalCount={emailData?.totalCount ?? 0}
				page={page}
				setPage={setPage}
				pageSize={PAGE_SIZE}
				isLoading={isRefreshing}
				isRefreshing={isRefreshing}
				onRefresh={handleRefresh}
				folder={folder}
				empty={<FolderEmptyState folder={folder} onCompose={() => startCompose()} />}
			/>
		</MailView>
	);
}
