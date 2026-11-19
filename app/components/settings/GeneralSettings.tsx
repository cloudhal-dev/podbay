// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { Button, Select } from "@cloudflare/kumo";
import { useEffect, useRef, useState } from "react";
import { UNDO_SECONDS, type UndoSeconds } from "shared/sending";
import { PAGE_SIZES, type PageSize, useDisplay } from "~/hooks/useDisplay";
import { useUIStore } from "~/hooks/useUIStore";
import { LANGUAGE_NAMES, LANGUAGES, m, t } from "~/i18n";
import Row, { Choice } from "./Row";

/**
 * How the mail screens look and behave for this person. A choice takes effect at once. Most
 * are kept with the person's account (ADR-0012); three depend on the device and stay here.
 */
/**
 * Set when the language was just chosen. The whole app is drawn again in the new language, so
 * the button that was pressed is gone; the new one gets the focus, and the keyboard stays
 * where it was.
 */
let languageJustChosen = false;

/** The undo window of a send (ADR-0016, decision 10). There is no "off". */
const UNDO_WORDS: Record<UndoSeconds, string> = {
	5: m("5 seconds"),
	10: m("10 seconds"),
	30: m("30 seconds"),
};

export default function GeneralSettings() {
	const choices = useDisplay();
	const { setShortcutHelpOpen } = useUIStore();
	const [refused, setRefused] = useState(false);
	const languageChoice = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!languageJustChosen) return;
		languageJustChosen = false;
		languageChoice.current
			?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')
			?.focus();
	}, []);

	/** Turning notifications on asks the browser first; a no leaves them off and says why. */
	async function notify(on: boolean) {
		setRefused(false);
		if (!on) return choices.choose({ notifications: false });
		const allowed =
			typeof Notification !== "undefined" && (await Notification.requestPermission()) === "granted";
		setRefused(!allowed);
		choices.choose({ notifications: allowed });
	}

	return (
		<div>
			<p className="m-0 border-b border-kumo-line pb-4 text-xs text-kumo-subtle">
				{t(
					"These choices take effect at once and are kept with your account, so they are the same wherever you sign in. Density, the reading pane and notifications depend on the device and are kept in this browser only.",
				)}
			</p>

			<Row
				name={t("Conversations on a page")}
				about={t("How many lines a list shows before it pages.")}
			>
				<Select
					aria-label={t("Conversations on a page")}
					className="w-24"
					value={choices.pageSize}
					onValueChange={(size) => choices.choose({ pageSize: size as PageSize })}
					items={PAGE_SIZES.map((size) => ({ label: String(size), value: size }))}
				/>
			</Row>

			<Row
				name={t("Order of a list")}
				about={t("What a list puts on top. Inside each group the newest is first.")}
			>
				<Choice
					legend={t("Order of a list")}
					value={choices.order}
					options={[
						["newest", m("Newest first")],
						["unread", m("Unread first")],
						["starred", m("Starred first")],
					]}
					onChange={(order) => choices.choose({ order })}
				/>
			</Row>

			<Row name={t("Density")} about={t("How tall a line of a list is.")}>
				<Choice
					legend={t("Density")}
					value={choices.density}
					options={[
						["default", m("Default")],
						["comfortable", m("Comfortable")],
						["compact", m("Compact")],
					]}
					onChange={(density) => choices.choose({ density })}
				/>
			</Row>

			<Row
				name={t("Reading pane")}
				about={t("Where a conversation opens when the screen has room.")}
			>
				<Choice
					legend={t("Reading pane")}
					value={choices.readingPane}
					options={[
						["none", m("In place of the list")],
						["right", m("Beside the list, on its right")],
						["below", m("Under the list")],
					]}
					onChange={(readingPane) => choices.choose({ readingPane })}
				/>
			</Row>

			<Row
				name={t("Conversation view")}
				about={t("Whether a message and the answers to it are one line and one screen.")}
			>
				<Choice
					legend={t("Conversation view")}
					value={choices.conversationView ? "on" : "off"}
					options={[
						["on", m("On: messages of a conversation together")],
						["off", m("Off: each message by itself")],
					]}
					onChange={(value) => choices.choose({ conversationView: value === "on" })}
				/>
			</Row>

			<Row name={t("Snippets")} about={t("The start of a message after its subject, in a list.")}>
				<Choice
					legend={t("Snippets")}
					value={choices.snippets ? "on" : "off"}
					options={[
						["on", m("Show them")],
						["off", m("Subject only")],
					]}
					onChange={(value) => choices.choose({ snippets: value === "on" })}
				/>
			</Row>

			<Row
				name={t("Actions on a line")}
				about={t("Archive, delete and read on the line under the pointer, in place of its date.")}
			>
				<Choice
					legend={t("Actions on a line")}
					value={choices.hoverActions ? "on" : "off"}
					options={[
						["on", m("Show them")],
						["off", m("Keep the date")],
					]}
					onChange={(value) => choices.choose({ hoverActions: value === "on" })}
				/>
			</Row>

			<Row name={t("Reply button")} about={t("What the Reply button on a message does.")}>
				<Choice
					legend={t("Reply button")}
					value={choices.defaultReply}
					options={[
						["reply", m("Reply to the sender")],
						["reply-all", m("Reply to all")],
					]}
					onChange={(defaultReply) => choices.choose({ defaultReply })}
				/>
			</Row>

			<Row
				name={t("After filing a conversation")}
				about={t(
					"Where to go after the open conversation is archived, deleted, moved or reported.",
				)}
			>
				<Choice
					legend={t("After filing a conversation")}
					value={choices.afterFiling}
					options={[
						["list", m("Back to the list")],
						["newer", m("The newer conversation")],
						["older", m("The older conversation")],
					]}
					onChange={(afterFiling) => choices.choose({ afterFiling })}
				/>
			</Row>

			<Row
				name={t("Send and archive")}
				about={t("A second button on an answer: send it and file its conversation in one press.")}
			>
				<Choice
					legend={t("Send and archive")}
					value={choices.sendAndArchive ? "on" : "off"}
					options={[
						["on", m("Show the button")],
						["off", m("Hide it")],
					]}
					onChange={(value) => choices.choose({ sendAndArchive: value === "on" })}
				/>
			</Row>

			<Row
				name={t("Undo send")}
				about={t(
					"How long a message you sent can still be taken back. It leaves when this time is over.",
				)}
			>
				<Choice
					legend={t("Undo send")}
					value={choices.undoSeconds}
					options={UNDO_SECONDS.map((seconds) => [seconds, UNDO_WORDS[seconds]] as const)}
					onChange={(undoSeconds) => choices.choose({ undoSeconds })}
				/>
			</Row>

			<Row
				name={t("Notifications")}
				about={t(
					"A notification of this device when mail arrives while Podbay is open in a tab. It shows who wrote and the subject.",
				)}
			>
				<Choice
					legend={t("Notifications")}
					value={choices.notifications ? "on" : "off"}
					options={[
						["on", m("For new mail")],
						["off", m("None")],
					]}
					onChange={(value) => void notify(value === "on")}
				/>
				{refused && (
					<p role="alert" className="m-0 mt-2 text-xs text-kumo-danger">
						{t(
							"This browser does not allow notifications for Podbay. Allow them in the browser's settings for this site, then choose again.",
						)}
					</p>
				)}
			</Row>

			<Row
				name={t("Keyboard shortcuts")}
				about={t("Single keys that act on mail, such as c to write.")}
			>
				<Choice
					legend={t("Keyboard shortcuts")}
					value={choices.shortcuts ? "on" : "off"}
					options={[
						["on", m("On")],
						["off", m("Off")],
					]}
					onChange={(value) => choices.choose({ shortcuts: value === "on" })}
				/>
				<Button variant="secondary" className="mt-3" onClick={() => setShortcutHelpOpen(true)}>
					{t("Show the shortcuts")}
				</Button>
			</Row>

			<Row
				name={t("Language")}
				about={t(
					"The language of Podbay's own words. Mail stays in the language it was written in.",
				)}
			>
				<div ref={languageChoice}>
					<Choice
						legend={t("Language")}
						value={choices.language}
						options={[
							["system", m("As this device")],
							...LANGUAGES.map((language) => [language, LANGUAGE_NAMES[language]] as const),
						]}
						onChange={(language) => {
							languageJustChosen = true;
							choices.choose({ language });
						}}
					/>
				</div>
			</Row>

			<Row name={t("Appearance")} about={t("Light, dark, or whatever this device uses.")}>
				<Choice
					legend={t("Appearance")}
					value={choices.appearance}
					options={[
						["system", m("As this device")],
						["light", m("Light")],
						["dark", m("Dark")],
					]}
					onChange={(appearance) => choices.choose({ appearance })}
				/>
			</Row>
		</div>
	);
}
