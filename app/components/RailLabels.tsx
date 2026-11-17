// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { Button, DropdownMenu, Tooltip } from "@cloudflare/kumo";
import { DotsThreeIcon, PlusIcon } from "@phosphor-icons/react";
import { Link, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { useConfirm } from "~/components/Confirm";
import { useConversationActions } from "~/hooks/useConversationActions";
import { useDropTarget } from "~/hooks/useDropTarget";
import { labelTree } from "~/lib/label-tree";
import { labelDot, labelSearch } from "~/lib/labels";
import { useDeleteLabel, useLabels } from "~/queries/labels";
import type { Label } from "~/types";
import LabelDialog from "./LabelDialog";

/**
 * The labels of the mailbox in the rail. A label's list is a search for it, as Starred is. Each
 * label can be renamed, recoloured and deleted here; deleting one deletes no mail.
 */
export default function RailLabels({
	mailboxId,
	onNavigate,
}: {
	mailboxId: string;
	onNavigate: () => void;
}) {
	const { data: labels = [] } = useLabels(mailboxId);
	const deleteLabel = useDeleteLabel();
	const confirm = useConfirm();
	/** `null` is closed, `"new"` makes a label, a label edits it. */
	const [editing, setEditing] = useState<Label | "new" | null>(null);

	async function remove(label: Label) {
		const sure = await confirm({
			title: `Delete the label "${label.name}"?`,
			body:
				label.total === 0
					? "No message carries it. Nothing else changes."
					: `It is taken off ${label.total === 1 ? "one message" : `${label.total} messages`}. No message is deleted or moved.`,
			action: "Delete label",
			destructive: true,
		});
		if (sure) deleteLabel.mutate({ mailboxId, id: label.id });
	}

	return (
		<div className="pt-4">
			<div className="mb-1 flex items-center justify-between pl-4 pr-1">
				<h2 className="m-0 text-xs font-semibold text-kumo-subtle">Labels</h2>
				<Tooltip content="New label" asChild>
					<Button
						variant="ghost"
						shape="square"
						size="sm"
						icon={<PlusIcon size={16} />}
						onClick={() => setEditing("new")}
						aria-label="Create a label"
					/>
				</Tooltip>
			</div>
			<ul className="m-0 list-none space-y-0.5 p-0">
				{labelTree(labels).map(({ item: label, depth, short }) => (
					<RailLabel
						key={label.id}
						label={label}
						depth={depth}
						short={short}
						mailboxId={mailboxId}
						onNavigate={onNavigate}
						onEdit={() => setEditing(label)}
						onDelete={() => void remove(label)}
					/>
				))}
			</ul>
			<LabelDialog
				open={editing !== null}
				onOpenChange={(open) => {
					if (!open) setEditing(null);
				}}
				mailboxId={mailboxId}
				label={editing === "new" || editing === null ? undefined : editing}
			/>
		</div>
	);
}

/** One label of the rail. Dropping conversations on it moves them to it. */
/** How far a label is set in for each label it is under. Written out so the stylesheet holds them. */
const INDENT = ["pl-4", "pl-8", "pl-12", "pl-16"];

function RailLabel({
	label,
	depth,
	short,
	mailboxId,
	onNavigate,
	onEdit,
	onDelete,
}: {
	label: Label;
	/** How many labels it is under, and its name without what they already say. */
	depth: number;
	short: string;
	mailboxId: string;
	onNavigate: () => void;
	onEdit: () => void;
	onDelete: () => void;
}) {
	const { folder } = useParams({ strict: false });
	const actions = useConversationActions(mailboxId, folder);
	const drop = useDropTarget((conversations) => actions.moveToLabel(conversations, label));
	return (
		<li
			className={`group flex items-center rounded-full hover:bg-kumo-tint ${drop.over ? "ring-2 ring-kumo-brand" : ""}`}
			{...drop.handlers}
		>
			<Link
				to="/mailbox/$mailboxId/search"
				params={{ mailboxId }}
				search={{ q: labelSearch(label.name) }}
				onClick={onNavigate}
				aria-label={label.name}
				className={`flex h-9 min-w-0 flex-1 items-center gap-4 rounded-full text-sm text-kumo-strong no-underline ${INDENT[Math.min(depth, INDENT.length - 1)]}`}
				activeProps={{ className: "font-semibold text-kumo-default" }}
			>
				<span className="flex w-[18px] shrink-0 justify-center">
					<span className={`h-2.5 w-2.5 rounded-full ${labelDot(label.color)}`} />
				</span>
				<span className="flex-1 truncate">{short}</span>
				{label.unread > 0 && <span className="text-xs font-semibold">{label.unread}</span>}
			</Link>
			<DropdownMenu>
				<DropdownMenu.Trigger
					render={
						<Button
							variant="ghost"
							shape="square"
							size="sm"
							icon={<DotsThreeIcon size={16} weight="bold" />}
							aria-label={`Options for the label ${label.name}`}
							className="mr-1 opacity-0 focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 data-[popup-open]:opacity-100"
						/>
					}
				/>
				<DropdownMenu.Content>
					<DropdownMenu.Item onClick={onEdit}>Edit</DropdownMenu.Item>
					<DropdownMenu.Item variant="danger" onClick={onDelete}>
						Delete
					</DropdownMenu.Item>
				</DropdownMenu.Content>
			</DropdownMenu>
		</li>
	);
}
