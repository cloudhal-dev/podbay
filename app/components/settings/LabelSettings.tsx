// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { Button } from "@cloudflare/kumo";
import { PlusIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { LABEL_LIMITS } from "shared/labels";
import { useConfirm } from "~/components/Confirm";
import LabelDialog from "~/components/LabelDialog";
import { labelDot, labelSearch } from "~/lib/labels";
import { useDeleteLabel, useLabels } from "~/queries/labels";
import type { Label } from "~/types";

/** The labels of the mailbox: make, rename, recolour and delete. Deleting one deletes no mail. */
export default function LabelSettings({
	mailboxId,
	canChange,
}: {
	mailboxId: string;
	/** A reader of the mailbox sees the labels and changes none. */
	canChange: boolean;
}) {
	const { data: labels = [] } = useLabels(mailboxId);
	const deleteLabel = useDeleteLabel();
	const confirm = useConfirm();
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
		<div>
			<div className="flex items-center justify-between gap-4 border-b border-kumo-line pb-4">
				<p className="m-0 text-xs text-kumo-subtle">
					A conversation can carry several labels, and everyone with access to this mailbox sees the
					same ones. {labels.length} of {LABEL_LIMITS.perMailbox}.
				</p>
				{canChange && (
					<Button
						variant="secondary"
						size="sm"
						icon={<PlusIcon size={14} />}
						onClick={() => setEditing("new")}
					>
						New label
					</Button>
				)}
			</div>
			{labels.length === 0 ? (
				<p className="py-10 text-center text-sm text-kumo-subtle">
					This mailbox has no labels yet.
				</p>
			) : (
				<table className="w-full border-collapse text-sm">
					<thead>
						<tr className="text-left text-xs text-kumo-subtle">
							<th scope="col" className="py-2 font-medium">
								Label
							</th>
							<th scope="col" className="w-24 py-2 font-medium">
								Messages
							</th>
							<th scope="col" className="w-24 py-2 font-medium">
								Unread
							</th>
							<th scope="col" className="w-40 py-2">
								<span className="sr-only">Actions</span>
							</th>
						</tr>
					</thead>
					<tbody>
						{labels.map((label) => (
							<tr key={label.id} className="border-t border-kumo-line">
								<td className="py-2">
									<Link
										to="/mailbox/$mailboxId/search"
										params={{ mailboxId }}
										search={{ q: labelSearch(label.name) }}
										className="inline-flex items-center gap-2 text-kumo-default no-underline hover:underline"
									>
										<span className={`h-2.5 w-2.5 rounded-full ${labelDot(label.color)}`} />
										{label.name}
									</Link>
								</td>
								<td className="py-2 text-kumo-subtle">{label.total}</td>
								<td className="py-2 text-kumo-subtle">{label.unread}</td>
								<td className="py-2 text-right">
									{canChange && (
										<>
											<Button variant="ghost" size="sm" onClick={() => setEditing(label)}>
												Edit
											</Button>
											<Button variant="ghost" size="sm" onClick={() => void remove(label)}>
												Delete
											</Button>
										</>
									)}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			)}
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
