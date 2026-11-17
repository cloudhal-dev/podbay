// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { Button, DropdownMenu } from "@cloudflare/kumo";
import { SlidersHorizontalIcon } from "@phosphor-icons/react";
import { type Density, type ReadingPane, useDisplay } from "~/hooks/useDisplay";
import { m, t } from "~/i18n";

const DENSITY: [Density, string][] = [
	["default", m("Default")],
	["comfortable", m("Comfortable")],
	["compact", m("Compact")],
];
const PANE: [ReadingPane, string][] = [
	["none", m("No split")],
	["right", m("Right of the list")],
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
						aria-label={t("Display")}
						title={t("Display")}
						className="hidden md:inline-flex"
					/>
				}
			/>
			<DropdownMenu.Content>
				<DropdownMenu.Group>
					<DropdownMenu.Label>{t("Density")}</DropdownMenu.Label>
					<DropdownMenu.RadioGroup
						value={density}
						onValueChange={(value) => setDensity(value as Density)}
					>
						{DENSITY.map(([value, label]) => (
							<DropdownMenu.RadioItem key={value} value={value}>
								{t(label)}
								<DropdownMenu.RadioItemIndicator />
							</DropdownMenu.RadioItem>
						))}
					</DropdownMenu.RadioGroup>
				</DropdownMenu.Group>
				<DropdownMenu.Separator />
				<DropdownMenu.Group>
					<DropdownMenu.Label>{t("Reading pane")}</DropdownMenu.Label>
					<DropdownMenu.RadioGroup
						value={readingPane}
						onValueChange={(value) => setReadingPane(value as ReadingPane)}
					>
						{PANE.map(([value, label]) => (
							<DropdownMenu.RadioItem key={value} value={value}>
								{t(label)}
								<DropdownMenu.RadioItemIndicator />
							</DropdownMenu.RadioItem>
						))}
					</DropdownMenu.RadioGroup>
				</DropdownMenu.Group>
			</DropdownMenu.Content>
		</DropdownMenu>
	);
}
