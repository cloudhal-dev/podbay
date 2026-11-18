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
 * - **No control made of a role.** A plain element with the role of a control (`button`,
 *   `checkbox`, `radio`, `switch`, `combobox`, `listbox`, `textbox`, `slider`) is refused, except
 *   as a debt in `ROLES_TO_MOVE`.
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

/** Native controls that stay, each with why. Empty when the check came in; #82 fills it. */
export const ON_PURPOSE: readonly OnPurpose[] = [];

/**
 * What was written by hand when the check came in (main at b200fd7, 2026-11-19), file by file:
 * the debt #82 and #83 pay. Lower a number when a control moves to Kumo; never raise one.
 */
export const TO_MOVE: Readonly<Record<string, Partial<Record<Native, number>>>> = {
	"app/components/AccessKeys.tsx": { input: 1, select: 2 },
	"app/components/AddressField.tsx": { button: 2, input: 1 },
	"app/components/AgentPanel.tsx": { button: 1, textarea: 1 },
	"app/components/AgentSidebar.tsx": { button: 2 },
	"app/components/ComposePanel.tsx": { button: 3, input: 2 },
	"app/components/ComposeWindow.tsx": { button: 1 },
	"app/components/EmailAttachmentList.tsx": { button: 2 },
	"app/components/EmailPanel.tsx": { button: 1 },
	"app/components/Header.tsx": { button: 2, input: 1 },
	"app/components/InlineReply.tsx": { button: 2 },
	"app/components/InvitePerson.tsx": { select: 1 },
	"app/components/LabelDialog.tsx": { input: 1 },
	"app/components/MessageList.tsx": { button: 2, input: 1 },
	"app/components/MessageListToolbar.tsx": { input: 1 },
	"app/components/ScheduledList.tsx": { button: 1 },
	"app/components/SearchOptions.tsx": { input: 4, select: 2 },
	"app/components/SendLater.tsx": { input: 1 },
	"app/components/SignInSteps.tsx": { button: 1 },
	"app/components/email-panel/MessageHeader.tsx": { button: 4 },
	"app/components/email-panel/ThreadMessage.tsx": { button: 1 },
	"app/components/rules/FilterDialog.tsx": { input: 4, select: 2 },
	"app/components/settings/AssistantSettings.tsx": { textarea: 1 },
	"app/components/settings/AutoReplySettings.tsx": { input: 3, textarea: 1 },
	"app/components/settings/GeneralSettings.tsx": { select: 1 },
	"app/components/settings/Row.tsx": { input: 1 },
	"app/components/settings/SignatureSettings.tsx": { input: 1 },
	"app/routes/home.tsx": { button: 1 },
	"app/routes/mailbox.tsx": { button: 1 },
	"app/routes/members.tsx": { select: 1 },
	"app/routes/search-results.tsx": { button: 1 },
};

/**
 * Kumo controls with a size, height or corner written by hand when the check came in, by file:
 * pill-shaped text buttons, which Kumo's `shape` gives to icon buttons only. #82 and #83 decide
 * them. Lower a number when one goes; never raise one.
 */
export const SIZED_BY_HAND: Readonly<Record<string, number>> = {
	"app/components/ComposePanel.tsx": 2,
	"app/components/EmailPanel.tsx": 3,
	"app/components/SendLater.tsx": 1,
};

/**
 * Plain elements with the role of a control when the check came in, by file. #82 and #83 decide
 * them. Lower a number when one goes; never raise one.
 */
export const ROLES_TO_MOVE: Readonly<Record<string, number>> = {
	"app/components/AddressField.tsx": 1,
};

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
function classesOf(tag: string): string[] {
	const attribute = /className=(?:"([^"]*)"|\{([\s\S]*)\})/.exec(tag);
	if (attribute === null) return [];
	if (attribute[1] !== undefined) return [attribute[1]];
	return [...(attribute[2] ?? "").matchAll(/"([^"]*)"|'([^']*)'|`([^`$]*)`/g)].map(
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
		for (const { name, line, tag } of tagsOf(text, controls)) {
			const hand = classesOf(tag)
				.map((classes) => HAND_SIZE.exec(classes))
				.find((one) => one !== null);
			if (hand) sized.push(`${file}:${line}: <${name}> with "${hand[2]}…" written by hand`);
			else if (/\sstyle=\{/.test(tag))
				sized.push(`${file}:${line}: <${name}> with a style attribute`);
		}
		const allowed = sizedByHand[file] ?? 0;
		if (sized.length > allowed) {
			problems.push(...sized.map((one) => `${one}; a control's size is its size prop`));
		} else if (sized.length < allowed) {
			problems.push(
				`${file}: ${sized.length} Kumo controls sized by hand, fewer than the ${allowed} listed; lower SIZED_BY_HAND in scripts/checks/controls.ts`,
			);
		}
		const roles = tagsOf(text, ["[a-z][a-z0-9]*"]).filter(
			({ name, tag }) => !(NATIVE as readonly string[]).includes(name) && CONTROL_ROLES.test(tag),
		);
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
