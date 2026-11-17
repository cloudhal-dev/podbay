// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { Button, DropdownMenu } from "@cloudflare/kumo";
import { TagIcon } from "@phosphor-icons/react";
import { labelDot } from "~/lib/labels";
import type { Email, Label } from "~/types";

/**
 * "Label as": every label of the mailbox with a tick when all the chosen conversations carry it.
 * Ticking gives the label to all of them, unticking takes it from all of them; the conversations
 * stay where they are. The menu stays open, so several labels are set in one visit.
 */
export default function LabelMenu({
	labels,
	targets,
	onChange,
	iconSize = 18,
}: {
	labels: readonly Label[];
	/** The conversations the menu acts on. */
	targets: readonly Email[];
	onChange: (labelId: string, give: boolean) => void;
	iconSize?: number;
}) {
	const onAll = (id: string) =>
		targets.length > 0 && targets.every((email) => email.labels?.includes(id));
	return (
		<DropdownMenu>
			<DropdownMenu.Trigger
				render={
					<Button
						variant="ghost"
						shape="square"
						size="sm"
						icon={<TagIcon size={iconSize} />}
						aria-label="Label as"
						title="Label as"
						disabled={targets.length === 0}
					/>
				}
			/>
			<DropdownMenu.Content>
				<DropdownMenu.Group>
					<DropdownMenu.Label>Label as</DropdownMenu.Label>
					{labels.length === 0 && (
						<DropdownMenu.Item disabled>No labels yet. Make one in the rail.</DropdownMenu.Item>
					)}
					{labels.map((label) => (
						<DropdownMenu.CheckboxItem
							key={label.id}
							checked={onAll(label.id)}
							onCheckedChange={(give) => onChange(label.id, give)}
						>
							<span
								className={`mr-2 inline-block h-2 w-2 rounded-full ${labelDot(label.color)}`}
								aria-hidden="true"
							/>
							{label.name}
						</DropdownMenu.CheckboxItem>
					))}
				</DropdownMenu.Group>
			</DropdownMenu.Content>
		</DropdownMenu>
	);
}
