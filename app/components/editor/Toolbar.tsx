// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { Button, DropdownMenu, Tooltip } from "@cloudflare/kumo";
import {
	ArrowClockwiseIcon,
	ArrowCounterClockwiseIcon,
	HighlighterIcon,
	LinkBreakIcon,
	LinkSimpleIcon,
	ListBulletsIcon,
	ListNumbersIcon,
	MinusIcon,
	QuotesIcon,
	TextAaIcon,
	TextAlignCenterIcon,
	TextAlignLeftIcon,
	TextAlignRightIcon,
	TextAUnderlineIcon,
	TextBIcon,
	TextIndentIcon,
	TextItalicIcon,
	TextOutdentIcon,
	TextStrikethroughIcon,
	TextTSlashIcon,
	TextUnderlineIcon,
} from "@phosphor-icons/react";
import { type Editor, useEditorState } from "@tiptap/react";
import type { ReactNode } from "react";
import { m, t } from "~/i18n";

/**
 * What a message is written with. Mail is read in many programs, so every choice here is
 * written into the message as plain markup with literal values: a size in pixels, a colour as
 * a hex number. Nothing of the app's own theme goes out with a message.
 */
const SIZES: readonly (readonly [string, string | null])[] = [
	[m("Small"), "13px"],
	[m("Normal"), null],
	[m("Large"), "18px"],
	[m("Huge"), "26px"],
];
const TEXT_COLOURS: readonly (readonly [string, string])[] = [
	[m("Grey"), "#616161"],
	[m("Red"), "#c62828"],
	[m("Orange"), "#ef6c00"],
	[m("Green"), "#2e7d32"],
	[m("Teal"), "#00838f"],
	[m("Blue"), "#1565c0"],
	[m("Purple"), "#6a1b9a"],
];
const HIGHLIGHTS: readonly (readonly [string, string])[] = [
	[m("Yellow"), "#fff59d"],
	[m("Orange"), "#ffcc80"],
	[m("Red"), "#ef9a9a"],
	[m("Green"), "#a5d6a7"],
	[m("Blue"), "#90caf9"],
	[m("Purple"), "#ce93d8"],
];
const ALIGNMENTS = [
	["left", m("Align left"), TextAlignLeftIcon],
	["center", m("Align centre"), TextAlignCenterIcon],
	["right", m("Align right"), TextAlignRightIcon],
] as const;

/** One button of the bar: an icon with a name, lit while what it does holds for the selection. */
function Tool({
	name,
	icon,
	on = false,
	disabled = false,
	onClick,
}: {
	name: string;
	icon: ReactNode;
	on?: boolean;
	disabled?: boolean;
	onClick: () => void;
}) {
	return (
		<Tooltip content={name} side="bottom" asChild>
			<Button
				variant={on ? "secondary" : "ghost"}
				shape="square"
				size="sm"
				icon={icon}
				onClick={onClick}
				disabled={disabled}
				aria-label={name}
			/>
		</Tooltip>
	);
}

/**
 * A button of the bar that opens a short list of choices. When the list closes, the cursor
 * goes back into the text, not to the button, so writing goes on where it was.
 */
function ToolMenu({
	name,
	icon,
	text,
	children,
}: {
	name: string;
	icon: ReactNode;
	/** The element the text is written in. */
	text: () => HTMLElement;
	children: ReactNode;
}) {
	return (
		<DropdownMenu>
			<DropdownMenu.Trigger
				render={
					<Button
						variant="ghost"
						shape="square"
						size="sm"
						icon={icon}
						aria-label={name}
						title={name}
					/>
				}
			/>
			<DropdownMenu.Portal>
				<DropdownMenu.Positioner>
					<DropdownMenu.Popup finalFocus={text}>{children}</DropdownMenu.Popup>
				</DropdownMenu.Positioner>
			</DropdownMenu.Portal>
		</DropdownMenu>
	);
}

const Swatch = ({ colour }: { colour: string }) => (
	<span
		aria-hidden="true"
		className="mr-2 inline-block h-3 w-3 rounded-full border border-kumo-line align-middle"
		style={{ backgroundColor: colour }}
	/>
);
const Gap = () => <div className="mx-1 h-5 w-px bg-kumo-fill" />;

/** The formatting bar above the text of a message. */
export default function Toolbar({ editor, onLink }: { editor: Editor; onLink: () => void }) {
	const run = () => editor.chain().focus();
	const text = () => editor.view.dom;
	// The editor does not draw the bar again by itself: what the bar shows of the selection is
	// read here, and the bar is drawn again when one of these changes.
	const at = useEditorState({
		editor,
		selector: ({ editor: now }) => ({
			bold: now.isActive("bold"),
			italic: now.isActive("italic"),
			underline: now.isActive("underline"),
			strike: now.isActive("strike"),
			ordered: now.isActive("orderedList"),
			bullets: now.isActive("bulletList"),
			quote: now.isActive("blockquote"),
			link: now.isActive("link"),
			align: ALIGNMENTS.findIndex(([value]) => now.isActive({ textAlign: value })),
			canUndo: now.can().undo(),
			canRedo: now.can().redo(),
			canLift: now.can().liftListItem("listItem"),
			canSink: now.can().sinkListItem("listItem"),
		}),
	});
	const AlignIcon = (ALIGNMENTS[at.align] ?? ALIGNMENTS[0])[2];
	return (
		<div
			role="toolbar"
			aria-label={t("Formatting")}
			className="flex shrink-0 flex-wrap items-center gap-0.5 border-b border-kumo-line bg-kumo-recessed px-2 py-1.5"
		>
			<Tool
				name={t("Undo")}
				icon={<ArrowCounterClockwiseIcon size={16} />}
				disabled={!at.canUndo}
				onClick={() => run().undo().run()}
			/>
			<Tool
				name={t("Redo")}
				icon={<ArrowClockwiseIcon size={16} />}
				disabled={!at.canRedo}
				onClick={() => run().redo().run()}
			/>
			<Gap />

			<ToolMenu name={t("Size")} icon={<TextAaIcon size={16} />} text={text}>
				{SIZES.map(([name, size]) => (
					<DropdownMenu.Item
						key={name}
						onClick={() => (size ? run().setFontSize(size).run() : run().unsetFontSize().run())}
					>
						<span style={{ fontSize: size ?? undefined }}>{t(name)}</span>
					</DropdownMenu.Item>
				))}
			</ToolMenu>
			<Tool
				name={t("Bold")}
				icon={<TextBIcon size={16} />}
				on={at.bold}
				onClick={() => run().toggleBold().run()}
			/>
			<Tool
				name={t("Italic")}
				icon={<TextItalicIcon size={16} />}
				on={at.italic}
				onClick={() => run().toggleItalic().run()}
			/>
			<Tool
				name={t("Underline")}
				icon={<TextUnderlineIcon size={16} />}
				on={at.underline}
				onClick={() => run().toggleUnderline().run()}
			/>
			<ToolMenu name={t("Text colour")} icon={<TextAUnderlineIcon size={16} />} text={text}>
				<DropdownMenu.Item onClick={() => run().unsetColor().run()}>
					{t("Usual colour")}
				</DropdownMenu.Item>
				{TEXT_COLOURS.map(([name, colour]) => (
					<DropdownMenu.Item key={colour} onClick={() => run().setColor(colour).run()}>
						<Swatch colour={colour} />
						{t(name)}
					</DropdownMenu.Item>
				))}
			</ToolMenu>
			<ToolMenu name={t("Highlight")} icon={<HighlighterIcon size={16} />} text={text}>
				<DropdownMenu.Item onClick={() => run().unsetHighlight().run()}>
					{t("No highlight")}
				</DropdownMenu.Item>
				{HIGHLIGHTS.map(([name, colour]) => (
					<DropdownMenu.Item
						key={colour}
						onClick={() => run().setHighlight({ color: colour }).run()}
					>
						<Swatch colour={colour} />
						{t(name)}
					</DropdownMenu.Item>
				))}
			</ToolMenu>
			<Gap />

			<ToolMenu name={t("Align")} icon={<AlignIcon size={16} />} text={text}>
				{ALIGNMENTS.map(([value, name, Icon]) => (
					<DropdownMenu.Item
						key={value}
						icon={Icon}
						onClick={() => run().setTextAlign(value).run()}
					>
						{t(name)}
					</DropdownMenu.Item>
				))}
			</ToolMenu>
			<Tool
				name={t("Numbered list")}
				icon={<ListNumbersIcon size={16} />}
				on={at.ordered}
				onClick={() => run().toggleOrderedList().run()}
			/>
			<Tool
				name={t("Bullet list")}
				icon={<ListBulletsIcon size={16} />}
				on={at.bullets}
				onClick={() => run().toggleBulletList().run()}
			/>
			<Tool
				name={t("Indent less")}
				icon={<TextOutdentIcon size={16} />}
				disabled={!at.canLift}
				onClick={() => run().liftListItem("listItem").run()}
			/>
			<Tool
				name={t("Indent more")}
				icon={<TextIndentIcon size={16} />}
				disabled={!at.canSink}
				onClick={() => run().sinkListItem("listItem").run()}
			/>
			<Gap />

			<Tool
				name={t("Blockquote")}
				icon={<QuotesIcon size={16} />}
				on={at.quote}
				onClick={() => run().toggleBlockquote().run()}
			/>
			<Tool
				name={t("Strikethrough")}
				icon={<TextStrikethroughIcon size={16} />}
				on={at.strike}
				onClick={() => run().toggleStrike().run()}
			/>
			<Tool name={t("Link")} icon={<LinkSimpleIcon size={16} />} on={at.link} onClick={onLink} />
			{at.link && (
				<Tool
					name={t("Remove link")}
					icon={<LinkBreakIcon size={16} />}
					onClick={() => run().unsetLink().run()}
				/>
			)}
			<Tool
				name={t("Horizontal rule")}
				icon={<MinusIcon size={16} />}
				onClick={() => run().setHorizontalRule().run()}
			/>
			<Tool
				name={t("Remove formatting")}
				icon={<TextTSlashIcon size={16} />}
				onClick={() => run().unsetAllMarks().clearNodes().unsetTextAlign().run()}
			/>
		</div>
	);
}
