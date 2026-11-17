// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * The words of outgoing mail (ADR-0016): why a message was not sent, in the app's own words,
 * and the times the app offers for sending later. Pure functions: the screens show what these
 * return, and the unit tests hold them.
 */
import { formatDetailDate } from "shared/dates";
import { SENDING } from "shared/sending";
import { dateLanguage, m, t } from "~/i18n";

const NOT_SET_UP = m(
	"This domain is not set up for sending yet. Whoever runs Podbay can fix that.",
);
const NO_LONGER_FITS = m(
	"The message does not fit what can be sent: too many recipients, too many files, or too large.",
);
const NOT_AS_WRITTEN = m("The sending service does not take the message as it is written.");
const RECIPIENT = m("The sending service does not send to one of the recipients.");
const BUSY = m("The sending service could not take the message for hours. Try again later.");

/**
 * Why a message did not leave. The reasons are Podbay's own (`right`, `sender`, `limits`,
 * `late`, `unknown`) or a code of the sending service; the service's own words are never
 * shown, and a code the app does not know gets a sentence that says only that.
 */
const REASONS: Readonly<Record<string, string>> = {
	right: m(
		"Whoever sent this may no longer send from this mailbox, or their account was recovered since.",
	),
	sender: m("The address this message is from is no longer the address of this mailbox."),
	limits: NO_LONGER_FITS,
	late: m("The message could not leave within a day of its time."),
	unknown: m(
		"The sending service gave no answer, so the message may have been sent. Check with the recipient before you send it again.",
	),
	// One recipient may still have got it: the service does not say.
	E_DELIVERY_FAILED: m(
		"The message could not be delivered. The sending service does not say whether another recipient got it.",
	),
	E_RATE_LIMIT_EXCEEDED: BUSY,
	E_INTERNAL_SERVER_ERROR: BUSY,
	E_EMAIL_SENDING_NOT_READY: NOT_SET_UP,
	E_SENDER_NOT_VERIFIED: NOT_SET_UP,
	E_SENDER_DOMAIN_NOT_AVAILABLE: NOT_SET_UP,
	E_SENDER_DOMAIN_NOT_CONFIGURED: NOT_SET_UP,
	E_DAILY_LIMIT_EXCEEDED: m("This instance has sent as much mail as it may today."),
	E_ACCOUNT_SUSPENDED: m("Sending is paused for this instance."),
	E_RECIPIENT_NOT_ALLOWED: RECIPIENT,
	E_RECIPIENT_PLAN_RESTRICTED: RECIPIENT,
	E_RECIPIENT_SUPPRESSED: m("One of the recipients does not take mail from this domain any more."),
	E_CONTENT_TOO_LARGE: NO_LONGER_FITS,
	E_TOO_MANY_RECIPIENTS: NO_LONGER_FITS,
	E_TOO_MANY_ATTACHMENTS: NO_LONGER_FITS,
	E_VALIDATION_ERROR: NOT_AS_WRITTEN,
	E_FIELD_MISSING: NOT_AS_WRITTEN,
	E_HEADER_NOT_ALLOWED: NOT_AS_WRITTEN,
	E_HEADER_USE_API_FIELD: NOT_AS_WRITTEN,
	E_HEADER_VALUE_INVALID: NOT_AS_WRITTEN,
	E_HEADER_VALUE_TOO_LONG: NOT_AS_WRITTEN,
	E_HEADER_NAME_INVALID: NOT_AS_WRITTEN,
	E_HEADERS_TOO_LARGE: NOT_AS_WRITTEN,
	E_HEADERS_TOO_MANY: NOT_AS_WRITTEN,
};
const OTHER = m("The sending service refused the message.");

/** The English of a reason, as the catalog names it. */
export function reasonMessage(error: string | null | undefined): string {
	return REASONS[error ?? ""] ?? OTHER;
}

/** Why a message was not sent, in the reader's language. */
export function reasonWords(error: string | null | undefined): string {
	return t(reasonMessage(error));
}

/** Whether nobody knows if the message left: sending it again may send it twice. */
export const mayHaveLeft = (error: string | null | undefined): boolean => error === "unknown";

/** A time a message leaves, as a person reads it: "Thu, Nov 19, 8:00 AM". */
export function timeWords(sendAt: string | number | Date): string {
	return formatDetailDate(new Date(sendAt).toISOString(), dateLanguage());
}

export interface LaterChoice {
	/** The English of what the time is called. */
	name: string;
	/** The time itself, in this device's time zone, as an instant. */
	at: Date;
}

/** The hours the app means by "morning" and "afternoon". */
const MORNING = 8;
const AFTERNOON = 13;

/**
 * The few times the app offers for sending later (decision 12), in this device's time zone:
 * in an hour, tomorrow morning, tomorrow afternoon, and Monday morning when that is not
 * tomorrow. Each is shown with its date and time before it is chosen.
 */
export function laterChoices(now: Date): LaterChoice[] {
	const at = (days: number, hour: number) => {
		const time = new Date(now);
		time.setDate(time.getDate() + days);
		time.setHours(hour, 0, 0, 0);
		return time;
	};
	const choices: LaterChoice[] = [
		{ name: m("In an hour"), at: new Date(now.getTime() + 60 * 60_000) },
		{ name: m("Tomorrow morning"), at: at(1, MORNING) },
		{ name: m("Tomorrow afternoon"), at: at(1, AFTERNOON) },
	];
	// 1 is Monday. From a Sunday, Monday morning is tomorrow morning.
	const toMonday = (8 - now.getDay()) % 7 || 7;
	if (toMonday > 1) choices.push({ name: m("Monday morning"), at: at(toMonday, MORNING) });
	return choices;
}

/** What is wrong with a time a person picked, or `null` when a message can be sent then. */
export function timeRefusal(at: Date, now: Date): string | null {
	if (Number.isNaN(at.getTime())) return t("Choose a date and a time.");
	if (at.getTime() <= now.getTime()) return t("Choose a time that is still to come.");
	if (at.getTime() > now.getTime() + SENDING.farthestMs) {
		return t("A message can be sent later by a year at most.");
	}
	return null;
}

/** A time as the date-and-time field of a form holds it: this device's time, to the minute. */
export function fieldValue(time: Date): string {
	const two = (value: number) => String(value).padStart(2, "0");
	return `${time.getFullYear()}-${two(time.getMonth() + 1)}-${two(time.getDate())}T${two(
		time.getHours(),
	)}:${two(time.getMinutes())}`;
}
