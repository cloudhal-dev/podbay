// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { Button, DropdownMenu } from "@cloudflare/kumo";
import { FolderSimpleIcon } from "@phosphor-icons/react";
import type { Folder } from "~/types";

/** The "Move to" menu: the folders a conversation can go to. */
export default function MoveMenu({
	folders,
	onMove,
	iconSize = 18,
}: {
	folders: Folder[];
	onMove: (folderId: string) => void;
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
						aria-label="Move to"
						title="Move to"
						disabled={folders.length === 0}
					/>
				}
			/>
			<DropdownMenu.Content>
				<DropdownMenu.Group>
					<DropdownMenu.Label>Move to</DropdownMenu.Label>
					{folders.map((folder) => (
						<DropdownMenu.Item key={folder.id} onClick={() => onMove(folder.id)}>
							{folder.name}
						</DropdownMenu.Item>
					))}
				</DropdownMenu.Group>
			</DropdownMenu.Content>
		</DropdownMenu>
	);
}
