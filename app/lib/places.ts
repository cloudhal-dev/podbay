// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { Folders, getFolderDisplayName } from "shared/folders";
import { m, t } from "~/i18n";

/**
 * The places as a person reads them. They say `place|`, because a place and what is done to
 * mail can be one word in English and two in another language: Archive, the place, and
 * Archive, the button.
 */
const NAMES: Record<string, string> = {
	[Folders.INBOX]: m("place|Inbox"),
	[Folders.SENT]: m("place|Sent"),
	[Folders.DRAFT]: m("place|Drafts"),
	[Folders.SCHEDULED]: m("place|Scheduled"),
	[Folders.ARCHIVE]: m("place|Archive"),
	[Folders.SPAM]: m("place|Spam"),
	[Folders.TRASH]: m("place|Trash"),
};

/** What a place (Inbox, Sent, …) is called in the reader's language. */
export function placeName(id: string): string {
	const name = NAMES[id.toLowerCase()];
	return name === undefined ? getFolderDisplayName(id) : t(name);
}
