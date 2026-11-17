// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { Button, DropdownMenu } from "@cloudflare/kumo";
import { FolderSimpleIcon } from "@phosphor-icons/react";
import { t } from "~/i18n";
import { labelDot } from "~/lib/labels";
import { placeName } from "~/lib/places";
import type { Folder, Label } from "~/types";

/**
 * "Move to": the places a conversation can go, and the labels. Moving to a label gives the
 * label and takes the conversation out of the inbox (ADR-0007, decision 9).
 */
export default function MoveMenu({
	folders,
	labels = [],
	onMove,
	onMoveToLabel,
	iconSize = 18,
}: {
	folders: Folder[];
	labels?: readonly Label[];
	onMove: (folderId: string) => void;
	onMoveToLabel?: (label: Label) => void;
	iconSize?: number;
}) {
	return (
		<DropdownMenu>
			<DropdownMenu.Trigger
				render={
					<Button
						variant="ghost"
						shape="square"
						size="sm"
						icon={<FolderSimpleIcon size={iconSize} />}
						aria-label={t("Move to")}
						title={t("Move to")}
						disabled={folders.length === 0}
					/>
				}
			/>
			<DropdownMenu.Content>
				<DropdownMenu.Group>
					<DropdownMenu.Label>{t("Move to")}</DropdownMenu.Label>
					{folders.map((folder) => (
						<DropdownMenu.Item key={folder.id} onClick={() => onMove(folder.id)}>
							{placeName(folder.id)}
						</DropdownMenu.Item>
					))}
				</DropdownMenu.Group>
				{onMoveToLabel && labels.length > 0 && (
					<>
						<DropdownMenu.Separator />
						<DropdownMenu.Group>
							<DropdownMenu.Label>{t("Labels")}</DropdownMenu.Label>
							{labels.map((label) => (
								<DropdownMenu.Item key={label.id} onClick={() => onMoveToLabel(label)}>
									<span
										className={`mr-2 inline-block h-2 w-2 rounded-full ${labelDot(label.color)}`}
										aria-hidden="true"
									/>
									{label.name}
								</DropdownMenu.Item>
							))}
						</DropdownMenu.Group>
					</>
				)}
			</DropdownMenu.Content>
		</DropdownMenu>
	);
}
