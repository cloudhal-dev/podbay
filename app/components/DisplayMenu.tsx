// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { Button, DropdownMenu } from "@cloudflare/kumo";
import { SlidersHorizontalIcon } from "@phosphor-icons/react";
import { type Density, type ListOrder, type ReadingPane, useDisplay } from "~/hooks/useDisplay";
import { m, t } from "~/i18n";

const DENSITY: [Density, string][] = [
	["default", m("Default")],
	["comfortable", m("Comfortable")],
	["compact", m("Compact")],
];
const PANE: [ReadingPane, string][] = [
	["none", m("No split")],
	["right", m("Right of the list")],
	["below", m("Below the list")],
];
/** What a list puts on top; inside each group the newest is first (ADR-0014). */
const ORDER: [ListOrder, string][] = [
	["newest", m("Newest first")],
	["unread", m("Unread first")],
	["starred", m("Starred first")],
];

/**
 * How the mail screens are laid out: the height of a line, where a conversation opens, and
 * what a list puts on top.
 */
export default function DisplayMenu() {
	const { density, readingPane, order, setDensity, setReadingPane, setOrder } = useDisplay();
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
				<DropdownMenu.Separator />
				<DropdownMenu.Group>
					<DropdownMenu.Label>{t("Order of a list")}</DropdownMenu.Label>
					<DropdownMenu.RadioGroup
						value={order}
						onValueChange={(value) => setOrder(value as ListOrder)}
					>
						{ORDER.map(([value, label]) => (
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
