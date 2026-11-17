// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { Button } from "@cloudflare/kumo";
import { PAGE_SIZES, type PageSize, useDisplay } from "~/hooks/useDisplay";
import { useUIStore } from "~/hooks/useUIStore";
import Row, { Choice } from "./Row";

/**
 * How the mail screens look and behave for this person. A choice takes effect at once and is
 * kept in this browser only.
 */
export default function GeneralSettings() {
	const choices = useDisplay();
	const { setShortcutHelpOpen } = useUIStore();

	return (
		<div>
			<p className="m-0 border-b border-kumo-line pb-4 text-xs text-kumo-subtle">
				These choices take effect at once and are kept in this browser. Another browser, or another
				person of this mailbox, has their own.
			</p>

			<Row name="Conversations on a page" about="How many lines a list shows before it pages.">
				<label className="flex items-center gap-2">
					<span className="sr-only">Conversations on a page</span>
					<select
						className="h-9 rounded-lg border border-kumo-line bg-kumo-control px-3 text-sm text-kumo-default"
						value={choices.pageSize}
						onChange={(event) =>
							choices.choose({ pageSize: Number(event.target.value) as PageSize })
						}
					>
						{PAGE_SIZES.map((size) => (
							<option key={size} value={size}>
								{size}
							</option>
						))}
					</select>
				</label>
			</Row>

			<Row name="Density" about="How tall a line of a list is.">
				<Choice
					legend="Density"
					value={choices.density}
					options={[
						["default", "Default"],
						["comfortable", "Comfortable"],
						["compact", "Compact"],
					]}
					onChange={(density) => choices.choose({ density })}
				/>
			</Row>

			<Row name="Reading pane" about="Where a conversation opens on a wide screen.">
				<Choice
					legend="Reading pane"
					value={choices.readingPane}
					options={[
						["none", "In place of the list"],
						["right", "Beside the list, on its right"],
					]}
					onChange={(readingPane) => choices.choose({ readingPane })}
				/>
			</Row>

			<Row name="Reply button" about="What the Reply button on a message does.">
				<Choice
					legend="Reply button"
					value={choices.defaultReply}
					options={[
						["reply", "Reply to the sender"],
						["reply-all", "Reply to all"],
					]}
					onChange={(defaultReply) => choices.choose({ defaultReply })}
				/>
			</Row>

			<Row
				name="After filing a conversation"
				about="Where to go after the open conversation is archived, deleted, moved or reported."
			>
				<Choice
					legend="After filing a conversation"
					value={choices.afterFiling}
					options={[
						["list", "Back to the list"],
						["newer", "The newer conversation"],
						["older", "The older conversation"],
					]}
					onChange={(afterFiling) => choices.choose({ afterFiling })}
				/>
			</Row>

			<Row name="Keyboard shortcuts" about="Single keys that act on mail, such as c to write.">
				<Choice
					legend="Keyboard shortcuts"
					value={choices.shortcuts ? "on" : "off"}
					options={[
						["on", "On"],
						["off", "Off"],
					]}
					onChange={(value) => choices.choose({ shortcuts: value === "on" })}
				/>
				<Button
					variant="secondary"
					size="sm"
					className="mt-3"
					onClick={() => setShortcutHelpOpen(true)}
				>
					Show the shortcuts
				</Button>
			</Row>

			<Row name="Appearance" about="Light, dark, or whatever this device uses.">
				<Choice
					legend="Appearance"
					value={choices.appearance}
					options={[
						["system", "As this device"],
						["light", "Light"],
						["dark", "Dark"],
					]}
					onChange={(appearance) => choices.choose({ appearance })}
				/>
			</Row>
		</div>
	);
}
