/**
 * The app's controls are Kumo's (issue #84; the `podbay-ui` skill, rule 6). Every `.tsx` file in
 * `app/` is held to two things:
 *
 * - **No control written by hand.** `<select>`, `<textarea>`, `<input>` and `<button>` are refused,
 *   except at a place in `ON_PURPOSE`, which says why that one stays native, or as a debt in
 *   `TO_MOVE`. A debt is a count for one element in one file, from the day the check came in. It
 *   only goes down: a count above it is refused, and so is one below it until the number here is
 *   lowered. A file that is not listed has no debt.
 * - **No size, height, padding or corner written by hand on a Kumo control.** A control's size
 *   is its `size` prop. On `Button`, `Input` or another Kumo control, one of its dotted parts
 *   (`Select.Trigger`) or a wrapper of `app/components/controls/`, a class that sets a height
 *   (`h-`, `min-h-`, `max-h-`), a size (`size-`), padding (`p-`, `px-`, `py-`, `pt-`, `pb-` and the
 *   rest), a corner (`rounded`), a type size (`text-xs` to `text-9xl`, `text-[…]`) or a line height
 *   (`leading-`) is refused, with or without the important mark (`!h-9`, `h-9!`), and so is a
 *   `style` attribute. Width and margins are layout and are the screen's.
 *   One shape is let through where it is listed: a Kumo control made fully round with
 *   `rounded-full` and nothing else written by hand, at a place of `ROUND_ON_PURPOSE` with its
 *   reason. It keeps a shape a screen had before Kumo, which Kumo gives to a button with an icon
 *   alone. The count of such controls in a listed file must be the number listed.
 * - **No control made of a role.** A plain element with the role of a control (`button`,
 *   `checkbox`, `radio`, `switch`, `combobox`, `listbox`, `textbox`, `slider`) is refused, except
 *   as a debt in `ROLES_TO_MOVE`, or where `ROLES_ON_PURPOSE` keeps that role in that file with its
 *   reason and its count.
 *
 * A tag is read whole, across lines, braces and quotes, so an attribute on its own line counts.
 *
 * **What it does not prove.** It reads the text of JSX. A control made with `createElement`, or
 * with a tag held in a variable (`<Tag>`), is not seen; nor is a Kumo control imported under
 * another name, nor a class that comes from a variable or after a `${…}` in a template. Those are
 * held by review.
 */
import { type Check, read, repoFiles } from "./lib.ts";

const NATIVE = ["select", "textarea", "input", "button"] as const;
export type Native = (typeof NATIVE)[number];

/** Kumo's controls, by the name the app imports them under. */
const KUMO_CONTROLS = [
	"Button",
	"Input",
	"InputArea",
	"InputGroup",
	"Select",
	"Checkbox",
	"Radio",
	"Switch",
	"Combobox",
	"DatePicker",
	"SensitiveInput",
	"TagInput",
];
const HAND_SIZE =
	/(^|\s)(?:[a-z0-9-]+:)*!?(h-|min-h-|max-h-|size-|p[xytblrse]?-|rounded\b|rounded-|text-(?:xs|sm|base|lg|xl|[2-9]xl)\b|text-\[|leading-)/;
/** The roles of a control, which a plain element must not take. */
const CONTROL_ROLES =
	/\srole=(?:"|\{["'`])(button|checkbox|radio|switch|combobox|listbox|textbox|slider)["'`]/;

/** A native control kept on purpose: one line of this list is one such place, with its reason. */
export interface OnPurpose {
	file: string;
	element: Native;
	count: number;
	reason: string;
}

/** Native controls that stay, each with why. #82 decides each one. */
export const ON_PURPOSE: readonly OnPurpose[] = [
	{
		file: "app/components/controls/DateTimeField.tsx",
		element: "input",
		count: 1,
		reason:
			"Kumo 2.18.1 has no field for a date and a time: its DatePicker is a calendar only. The browser's own field stands here alone, sized to Kumo's default, and every screen uses this wrapper.",
	},
	{
		file: "app/components/AgentPanel.tsx",
		element: "button",
		count: 1,
		reason:
			"A suggestion the assistant offers before a conversation starts: a line of words the width of the panel, set at its left and free to run to a second line, which asks the assistant when pressed. Kumo's Button holds one line of a label, as wide as its words.",
	},
	{
		file: "app/components/AddressField.tsx",
		element: "input",
		count: 1,
		reason:
			"The field of addresses in a line of the writing window: no box, no line, no corner, 13 px type, the addresses as chips before it and the line's hairline under it. Kumo 2.18.1's Input, Combobox and TagInput are boxes with a line and a corner, and a height, padding or type size by hand is refused, so the line would become a form's field.",
	},
	{
		file: "app/components/ComposePanel.tsx",
		element: "input",
		count: 1,
		reason:
			"The subject in a line of the writing window, as the address field is: no box, no line, no corner, 13 px type, with the line's hairline under it. Kumo 2.18.1's Input is a box with a line and a corner, and a height, padding or type size by hand is refused.",
	},
	{
		file: "app/components/ComposePanel.tsx",
		element: "input",
		count: 1,
		reason:
			"The browser's own file picker, hidden and out of the tab order: Attach files, Kumo's button, opens it. Kumo 2.18.1 has no control that picks files, and only the browser's file input can ask the device for them.",
	},
	{
		file: "app/components/Header.tsx",
		element: "input",
		count: 1,
		reason:
			"The top bar's search box: one wide field 48 px tall, fully round and filled, with no line, that turns to the page's colour with a ring when it has focus. Kumo 2.18.1's Input and InputGroup give a size alone (40 px at their largest) with Kumo's corner and line, and a height, a corner or padding by hand is refused, so that shape cannot be carried. Its two buttons are Kumo's.",
	},
	{
		file: "app/components/EmailPanel.tsx",
		element: "button",
		count: 1,
		reason:
			"The line that stands for the middle of a long conversation, with how many messages it holds: a line of the conversation, drawn across its width as the folded messages are, which opens them. Kumo's Button is a control of fixed height, not a line of the thread.",
	},
	{
		file: "app/components/email-panel/MessageHeader.tsx",
		element: "button",
		count: 1,
		reason:
			"The sender's picture folds an open message: a round picture 40 px across, white on the brand colour for one's own message, which keeps its colour and takes a ring under the pointer. Kumo's Button sets its own text colour with an important mark and its own background under the pointer, so the picture's colours would be Kumo's.",
	},
	{
		file: "app/components/email-panel/MessageHeader.tsx",
		element: "button",
		count: 1,
		reason:
			"The sender's name opens what can be done with the sender: a line of text 13 px, level with the top of the picture, and the same line as one's own name, which is plain text. Kumo's Button is a box of 20, 26, 36 or 40 px with its own padding, not a line of text.",
	},
	{
		file: "app/components/email-panel/MessageHeader.tsx",
		element: "button",
		count: 1,
		reason:
			"The line of who a message went to shows its details: a line of text 12 px under the name, so the two lines stand beside the picture as a pair within its 40 px. Kumo's Button is a box of 20 px at its smallest, with its own padding.",
	},
	{
		file: "app/components/email-panel/ThreadMessage.tsx",
		element: "button",
		count: 1,
		reason:
			"A folded message is one line of the conversation that opens it: the sender's picture, the name, the date and the start of the text across the width of the thread. Kumo's Button holds a label and an icon in one row.",
	},
	{
		file: "app/components/MessageList.tsx",
		element: "button",
		count: 1,
		reason:
			"A line of the list is the conversation itself: one button that holds who wrote, the subject, the start of the text, its labels and the date, laid out for the width of the list, so the line has one name and one action. Kumo's Button holds a label and an icon in one row of fixed height, not a line of that content.",
	},
	{
		file: "app/routes/mailbox.tsx",
		element: "button",
		count: 1,
		reason:
			"The shade behind the rail when it slides over the list on a phone: the whole screen around the rail, which closes it when pressed. It is not a control a person moves to: it is out of the tab order, Escape and the rail's own button close the rail too, and Kumo's Button cannot be a surface the size of the screen.",
	},
];

/** Kumo controls made fully round on purpose: one line of this list is one file, with its reason. */
export interface RoundOnPurpose {
	file: string;
	count: number;
	reason: string;
}

/**
 * Kumo controls that keep a fully round shape a screen had before Kumo (`rounded-full` and no other
 * class written by hand). Kumo's Button is round only with `shape="circle"`, for an icon alone.
 */
export const ROUND_ON_PURPOSE: readonly RoundOnPurpose[] = [
	{
		file: "app/components/ComposePanel.tsx",
		count: 2,
		reason:
			"Send, and Send and archive under an answer, are round in the writing window's bar, as they were before Kumo and as Send later beside them is. Kumo's Button is round only as a circle for an icon alone.",
	},
	{
		file: "app/components/EmailPanel.tsx",
		count: 3,
		reason:
			"Reply, Reply all and Forward under the last message are round, as they were before Kumo: three answers with an icon and a word each. Kumo's Button is round only as a circle for an icon alone.",
	},
	{
		file: "app/components/SendLater.tsx",
		count: 1,
		reason:
			"Send later is round, beside Send in the writing window's bar and under a waiting message, as it was before Kumo. Kumo's Button is round only as a circle for an icon alone.",
	},
	{
		file: "app/routes/search-results.tsx",
		count: 1,
		reason:
			"The quick filters above a search's results are round chips, as they were before Kumo and as the folder's label in a result's line still is. Kumo's Button is round only as a circle for an icon alone.",
	},
];

/**
 * What was written by hand when the check came in (main at b200fd7, 2026-11-19), file by file:
 * the debt #82 and #83 pay. Lower a number when a control moves to Kumo; never raise one.
 */
export const TO_MOVE: Readonly<Record<string, Partial<Record<Native, number>>>> = {
	"app/components/EmailAttachmentList.tsx": { button: 2 },
	"app/components/InlineReply.tsx": { button: 2 },
	"app/components/LabelDialog.tsx": { input: 1 },
	"app/components/ScheduledList.tsx": { button: 1 },
	"app/components/settings/SignatureSettings.tsx": { input: 1 },
};

/**
 * Kumo controls with a size, height or corner written by hand when the check came in, by file:
 * pill-shaped text buttons, which Kumo's `shape` gives to icon buttons only. #82 and #83 decide
 * them. Lower a number when one goes; never raise one.
 */
export const SIZED_BY_HAND: Readonly<Record<string, number>> = {};

/** A plain element with the role of a control, kept on purpose: one line is one file and role. */
export interface RoleOnPurpose {
	file: string;
	role: string;
	count: number;
	reason: string;
}

/** Plain elements that keep the role of a control on purpose, each with why. */
export const ROLES_ON_PURPOSE: readonly RoleOnPurpose[] = [
	{
		file: "app/components/AddressField.tsx",
		role: "listbox",
		count: 1,
		reason:
			"The addresses the address field offers as one types: the list its combobox controls (aria-controls, aria-activedescendant), which keeps the focus in the field while a suggestion is pressed. It belongs to the field, which stays the browser's own (see ON_PURPOSE), so it cannot be Kumo's Combobox list.",
	},
];

/**
 * Plain elements with the role of a control when the check came in, by file. #82 and #83 decide
 * them. Lower a number when one goes; never raise one.
 */
export const ROLES_TO_MOVE: Readonly<Record<string, number>> = {};

/** The components a file of `app/components/controls/` exports: wrappers, held as Kumo's are. */
function wrappersOf(files: ReadonlyMap<string, string>): string[] {
	const names: string[] = [];
	for (const [file, text] of files) {
		if (!file.startsWith("app/components/controls/")) continue;
		for (const m of text.matchAll(
			/export\s+(?:default\s+)?(?:function|const)\s+([A-Z][A-Za-z0-9]*)/g,
		)) {
			names.push(m[1] as string);
		}
	}
	return names;
}

/** Every opening tag of a name in `text`, read whole, with the line it starts on. */
export function tagsOf(
	text: string,
	names: readonly string[],
): { name: string; line: number; tag: string }[] {
	const found: { name: string; line: number; tag: string }[] = [];
	const start = new RegExp(`<(${names.join("|")})(?=[\\s/>])`, "g");
	for (const match of text.matchAll(start)) {
		const from = match.index ?? 0;
		let depth = 0;
		let quote: string | null = null;
		let end = from + match[0].length;
		for (; end < text.length; end++) {
			const ch = text[end];
			if (quote !== null) {
				if (ch === quote) quote = null;
			} else if (ch === '"' || ch === "'" || ch === "`") {
				quote = ch;
			} else if (ch === "{") depth++;
			else if (ch === "}") depth--;
			else if (ch === ">" && depth === 0) break;
		}
		found.push({
			name: match[1] as string,
			line: text.slice(0, from).split("\n").length,
			tag: text.slice(from, end + 1),
		});
	}
	return found;
}

/** The class names written as plain strings in a tag's `className`, or in a `cn(…)` inside it. */
/** Where the tag's own className begins: outside every brace, so not inside a label given as JSX. */
function ownClassName(tag: string): number {
	let depth = 0;
	for (let at = 0; at < tag.length; at += 1) {
		const char = tag[at];
		if (char === "{") depth += 1;
		else if (char === "}") depth = Math.max(0, depth - 1);
		else if (depth === 0 && /\s/.test(char ?? "") && tag.startsWith("className=", at + 1))
			return at + 1;
	}
	return -1;
}

function classesOf(tag: string): string[] {
	const at = ownClassName(tag);
	if (at < 0) return [];
	const rest = tag.slice(at + "className=".length);
	const quoted = /^"([^"]*)"/.exec(rest);
	if (quoted) return [quoted[1] ?? ""];
	if (!rest.startsWith("{")) return [];
	// The braces of the value, matched, so what follows it (a label given as JSX) is not read.
	let depth = 0;
	let end = 0;
	for (; end < rest.length; end += 1) {
		if (rest[end] === "{") depth += 1;
		else if (rest[end] === "}" && --depth === 0) break;
	}
	return [...rest.slice(1, end).matchAll(/"([^"]*)"|'([^']*)'|`([^`$]*)`/g)].map(
		(m) => m[1] ?? m[2] ?? m[3] ?? "",
	);
}

/** What is wrong with the controls of the app, one message per problem. */
export function controlProblems(
	files: ReadonlyMap<string, string>,
	onPurpose: readonly OnPurpose[] = ON_PURPOSE,
	toMove: Readonly<Record<string, Partial<Record<Native, number>>>> = TO_MOVE,
	sizedByHand: Readonly<Record<string, number>> = SIZED_BY_HAND,
	rolesToMove: Readonly<Record<string, number>> = ROLES_TO_MOVE,
	roundOnPurpose: readonly RoundOnPurpose[] = ROUND_ON_PURPOSE,
	rolesOnPurpose: readonly RoleOnPurpose[] = ROLES_ON_PURPOSE,
): string[] {
	const problems: string[] = [];
	// A control is Kumo's, one of its dotted parts, or a wrapper of app/components/controls/.
	const controls = [...KUMO_CONTROLS, ...wrappersOf(files)].map(
		(name) => `${name}(?:\\.[A-Z][A-Za-z]*)?`,
	);
	for (const [file, text] of files) {
		const counts = new Map<Native, number>();
		for (const { name } of tagsOf(text, NATIVE)) {
			counts.set(name as Native, (counts.get(name as Native) ?? 0) + 1);
		}
		for (const element of NATIVE) {
			const found = counts.get(element) ?? 0;
			const kept = onPurpose
				.filter((one) => one.file === file && one.element === element)
				.reduce((sum, one) => sum + one.count, 0);
			const owed = toMove[file]?.[element] ?? 0;
			if (found > kept + owed) {
				problems.push(
					`${file}: ${found} <${element}> written by hand, ${kept + owed} allowed; use Kumo's control (podbay-ui, rule 6)`,
				);
			} else if (found < kept + owed && owed > 0) {
				problems.push(
					`${file}: ${found} <${element}> written by hand, fewer than the ${kept + owed} listed; lower TO_MOVE in scripts/checks/controls.ts`,
				);
			} else if (found < kept) {
				problems.push(`${file}: ON_PURPOSE lists ${kept} <${element}>, the file has ${found}`);
			}
		}
		const sized: string[] = [];
		const round: string[] = [];
		const roundKept = roundOnPurpose
			.filter((one) => one.file === file)
			.reduce((sum, one) => sum + one.count, 0);
		for (const { name, line, tag } of tagsOf(text, controls)) {
			const hand = classesOf(tag)
				.map((classes) => HAND_SIZE.exec(classes))
				.find((one) => one !== null);
			const handTokens = classesOf(tag)
				.flatMap((classes) => classes.split(/\s+/))
				.filter((token) => HAND_SIZE.test(token));
			const roundAlone =
				handTokens.length > 0 &&
				handTokens.every((token) => token === "rounded-full") &&
				!/\sstyle=\{/.test(tag);
			if (roundAlone && roundKept > 0) round.push(`${file}:${line}: <${name}> made round by hand`);
			else if (hand) sized.push(`${file}:${line}: <${name}> with "${hand[2]}…" written by hand`);
			else if (/\sstyle=\{/.test(tag))
				sized.push(`${file}:${line}: <${name}> with a style attribute`);
		}
		if (round.length > roundKept) {
			problems.push(
				...round.map((one) => `${one}; ROUND_ON_PURPOSE lists ${roundKept} in this file`),
			);
		} else if (round.length < roundKept) {
			problems.push(
				`${file}: ROUND_ON_PURPOSE lists ${roundKept} round Kumo controls, the file has ${round.length}`,
			);
		}
		const allowed = sizedByHand[file] ?? 0;
		if (sized.length > allowed) {
			problems.push(...sized.map((one) => `${one}; a control's size is its size prop`));
		} else if (sized.length < allowed) {
			problems.push(
				`${file}: ${sized.length} Kumo controls sized by hand, fewer than the ${allowed} listed; lower SIZED_BY_HAND in scripts/checks/controls.ts`,
			);
		}
		const found = tagsOf(text, ["[a-z][a-z0-9]*"]).filter(
			({ name, tag }) => !(NATIVE as readonly string[]).includes(name) && CONTROL_ROLES.test(tag),
		);
		// What is kept on purpose, role by role, is taken out first; the rest is debt or refused.
		const roles = [...found];
		for (const one of rolesOnPurpose.filter((kept) => kept.file === file)) {
			const ofRole = roles.filter(({ tag }) => CONTROL_ROLES.exec(tag)?.[1] === one.role);
			if (ofRole.length < one.count) {
				problems.push(
					`${file}: ROLES_ON_PURPOSE lists ${one.count} with role "${one.role}", the file has ${ofRole.length}`,
				);
			}
			for (const taken of ofRole.slice(0, one.count)) roles.splice(roles.indexOf(taken), 1);
		}
		const rolesAllowed = rolesToMove[file] ?? 0;
		if (roles.length > rolesAllowed) {
			problems.push(
				...roles.map(
					({ name, line, tag }) =>
						`${file}:${line}: <${name}> with role "${CONTROL_ROLES.exec(tag)?.[1]}" is a control made by hand; use Kumo's (podbay-ui, rule 6)`,
				),
			);
		} else if (roles.length < rolesAllowed) {
			problems.push(
				`${file}: ${roles.length} elements with a control's role, fewer than the ${rolesAllowed} listed; lower ROLES_TO_MOVE in scripts/checks/controls.ts`,
			);
		}
	}
	for (const [list, file] of [
		...Object.keys(toMove).map((file) => ["TO_MOVE", file]),
		...Object.keys(sizedByHand).map((file) => ["SIZED_BY_HAND", file]),
		...Object.keys(rolesToMove).map((file) => ["ROLES_TO_MOVE", file]),
	]) {
		if (!files.has(file as string))
			problems.push(`${file}: listed in ${list} and gone; remove its line`);
	}
	for (const one of onPurpose) {
		if (one.reason.trim().length < 20)
			problems.push(`${one.file}: an ON_PURPOSE line needs its reason`);
	}
	for (const one of rolesOnPurpose) {
		if (one.reason.trim().length < 20)
			problems.push(`${one.file}: a ROLES_ON_PURPOSE line needs its reason`);
		if (!files.has(one.file))
			problems.push(`${one.file}: listed in ROLES_ON_PURPOSE and gone; remove its line`);
	}
	for (const one of roundOnPurpose) {
		if (one.reason.trim().length < 20)
			problems.push(`${one.file}: a ROUND_ON_PURPOSE line needs its reason`);
		if (!files.has(one.file))
			problems.push(`${one.file}: listed in ROUND_ON_PURPOSE and gone; remove its line`);
	}
	return problems;
}

export const check: Check = {
	name: "controls",
	run() {
		const files = new Map<string, string>();
		for (const file of repoFiles()) {
			if (file.startsWith("app/") && file.endsWith(".tsx")) files.set(file, read(file));
		}
		return controlProblems(files);
	},
};
