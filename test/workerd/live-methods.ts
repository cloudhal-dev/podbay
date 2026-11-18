/**
 * The methods of the mailbox object, as the tests of the signal know them (ADR-0013): which
 * only read, which are the connection itself, and for every other what a call of it that
 * changed a row is about. `live-signal.test.ts` holds these lists against the object: a method
 * that is in none of them fails it, so a list changes on purpose and never to match.
 */
import type { LiveKind } from "../../shared/live.ts";

/** The methods that only read. Each is called below and must change no row. */
export const READS = [
	"allKeys",
	"batchToEmpty",
	"completeAddress",
	"countEmails",
	"countSearchResults",
	"countThreadedEmails",
	"draftFile",
	"findThreadBySubject",
	"findThreadOfReferences",
	"getAttachment",
	"getAutoReply",
	"getEmail",
	"getEmails",
	"getFolders",
	"getLabels",
	"getRules",
	"getThreadEmails",
	"getThreadedEmails",
	"holdsFiles",
	"messageKeys",
	"originalOf",
	"searchEmails",
];
/** The connection itself: taking one, ending one. They change no row either. */
export const HANDLERS = ["closeLive", "fetch", "webSocketClose", "webSocketMessage"];
/** Every other method writes, and this is what a call of it that changed a row is about. */
export const WRITES: Record<string, LiveKind[]> = {
	// Mail
	createEmail: ["mail"],
	deleteEmail: ["mail"],
	emptyBatch: ["mail"],
	filesStored: ["mail"],
	labelConversation: ["mail"],
	markStored: ["mail"],
	markThreadRead: ["mail"],
	moveEmail: ["mail"],
	removeFile: ["mail"],
	runDeed: ["mail"],
	saveDraft: ["mail"],
	undoDeed: ["mail"],
	updateEmail: ["mail"],
	// Outgoing mail (ADR-0016): taken, taken back, given a new time, and the alarm that lets
	// it leave. `delivery` is for mail that arrives, never for mail that goes.
	alarm: ["mail"],
	reschedule: ["mail"],
	submit: ["mail"],
	unsend: ["mail"],
	// Mail, when lines were ticked; nothing, when a filter was only counted
	bulk: ["mail"],
	// Arrival
	fileArrival: ["delivery", "mail"],
	// Labels
	createLabel: ["labels"],
	updateLabel: ["labels"],
	deleteLabel: ["labels", "mail"],
	// Settings: the method moves its own counter
	settingsSaved: [],
	// The rules of a mailbox (ADR-0008) are settings of it
	blockSender: ["settings"],
	setAutoReply: ["settings"],
	setRules: ["settings"],
	unblockSender: ["settings"],
	// Rows no read of mail shows
	beginArrival: [],
	claimArrival: [],
	declareFile: [],
	dropArrival: [],
	forgetAddress: [],
	forgetAddresses: [],
	purge: [],
};
