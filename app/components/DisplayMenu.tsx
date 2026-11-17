// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { Button, DropdownMenu } from "@cloudflare/kumo";
import { SlidersHorizontalIcon } from "@phosphor-icons/react";
import { type Density, type ReadingPane, useDisplay } from "~/hooks/useDisplay";

const DENSITY: [Density, string][] = [
	["default", "Default"],
	["comfortable", "Comfortable"],
	["compact", "Compact"],
];
const PANE: [ReadingPane, string][] = [
	["none", "No split"],
	["right", "Right of the list"],
];

/** How the mail screens are laid out: the height of a line, and where a conversation opens. */
export default function DisplayMenu() {
	const { density, readingPane, setDensity, setReadingPane } = useDisplay();
	return (
		<DropdownMenu>
			<DropdownMenu.Trigger
				render={
					<Button
						variant="ghost"
						shape="square"
						icon={<SlidersHorizontalIcon size={20} />}
						aria-label="Display"
						title="Display"
						className="hidden md:inline-flex"
					/>
				}
			/>
			<DropdownMenu.Content>
				<DropdownMenu.Group>
					<DropdownMenu.Label>Density</DropdownMenu.Label>
					<DropdownMenu.RadioGroup
						value={density}
						onValueChange={(value) => setDensity(value as Density)}
					>
						{DENSITY.map(([value, label]) => (
							<DropdownMenu.RadioItem key={value} value={value}>
								{label}
								<DropdownMenu.RadioItemIndicator />
							</DropdownMenu.RadioItem>
						))}
					</DropdownMenu.RadioGroup>
				</DropdownMenu.Group>
				<DropdownMenu.Separator />
				<DropdownMenu.Group>
					<DropdownMenu.Label>Reading pane</DropdownMenu.Label>
					<DropdownMenu.RadioGroup
						value={readingPane}
						onValueChange={(value) => setReadingPane(value as ReadingPane)}
					>
						{PANE.map(([value, label]) => (
							<DropdownMenu.RadioItem key={value} value={value}>
								{label}
								<DropdownMenu.RadioItemIndicator />
							</DropdownMenu.RadioItem>
						))}
					</DropdownMenu.RadioGroup>
				</DropdownMenu.Group>
			</DropdownMenu.Content>
		</DropdownMenu>
	);
}
