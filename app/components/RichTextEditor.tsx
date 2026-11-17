// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified by the Podbay contributors.

import { Input, LayerDialog } from "@cloudflare/kumo";
import { Color } from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import TiptapImage from "@tiptap/extension-image";
import LinkExtension from "@tiptap/extension-link";
import TextAlign from "@tiptap/extension-text-align";
import { FontSize, TextStyle } from "@tiptap/extension-text-style";
import Underline from "@tiptap/extension-underline";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { type FormEvent, useEffect, useState } from "react";
import { t } from "~/i18n";
import Toolbar from "./editor/Toolbar";

interface RichTextEditorProps {
	value: string;
	onChange: (value: string) => void;
	/** Put the cursor in the text when it is filled in. Off when writing starts in another field. */
	focusOnLoad?: boolean;
}

export default function RichTextEditor({
	value,
	onChange,
	focusOnLoad = true,
}: RichTextEditorProps) {
	const editor = useEditor({
		extensions: [
			StarterKit,
			Underline,
			TextAlign.configure({ types: ["heading", "paragraph"] }),
			LinkExtension.configure({ openOnClick: false }),
			TiptapImage,
			TextStyle,
			FontSize,
			Color,
			Highlight.configure({ multicolor: true }),
		],
		content: value,
		editorProps: {
			attributes: {
				class:
					"prose prose-sm max-w-none focus:outline-none min-h-[180px] p-3 text-sm [&_blockquote]:border-l-2 [&_blockquote]:border-kumo-line [&_blockquote]:pl-3 [&_blockquote]:text-kumo-subtle [&_blockquote]:bg-kumo-tint [&_blockquote]:py-1 [&_blockquote]:my-2 [&_blockquote]:text-xs [&_blockquote]:rounded-r-sm",
			},
		},
		onUpdate: ({ editor }) => {
			onChange(editor.getHTML());
		},
	});

	useEffect(() => {
		if (editor && !editor.isDestroyed && value !== editor.getHTML()) {
			editor.commands.setContent(value);
			if (!focusOnLoad) return;
			// Place cursor at the start of the document (above quoted text)
			const rafId = requestAnimationFrame(() => {
				if (!editor.isDestroyed) {
					editor.commands.focus("start");
				}
			});
			return () => cancelAnimationFrame(rafId);
		}
	}, [value, editor, focusOnLoad]);

	/** The address being edited in the link dialog; `null` while the dialog is closed. */
	const [linkAddress, setLinkAddress] = useState<string | null>(null);

	function applyLink(event: FormEvent) {
		event.preventDefault();
		// The dialog is drawn outside the compose form, but its events still pass through it.
		event.stopPropagation();
		if (!editor || linkAddress === null) return;
		const address = linkAddress.trim();
		const chain = editor.chain().focus().extendMarkRange("link");
		if (address === "") chain.unsetLink().run();
		else chain.setLink({ href: address }).run();
		setLinkAddress(null);
	}

	if (!editor) return null;

	return (
		<div className="rounded-lg border border-kumo-line overflow-hidden flex flex-col h-full">
			<Toolbar
				editor={editor}
				onLink={() => setLinkAddress(editor.getAttributes("link").href ?? "")}
			/>

			{/* Editor content */}
			<div className="flex-1 overflow-y-auto">
				<EditorContent editor={editor} />
			</div>

			<LayerDialog.Root
				open={linkAddress !== null}
				onOpenChange={(open) => {
					if (!open) setLinkAddress(null);
				}}
			>
				<LayerDialog.Content size="sm">
					<LayerDialog.Title>{t("Link")}</LayerDialog.Title>
					<LayerDialog.Description>
						{t("The selected text will open this address. Leave it empty to remove the link.")}
					</LayerDialog.Description>
					<LayerDialog.Body>
						{/* biome-ignore lint/a11y/noStaticElementInteractions: only keeps the dialog's keys from the compose form */}
						<div onKeyDown={(event) => event.stopPropagation()}>
							<form id="editor-link" onSubmit={applyLink}>
								<Input
									label={t("Address")}
									type="text"
									inputMode="url"
									placeholder="https://example.com"
									value={linkAddress ?? ""}
									onChange={(event) => setLinkAddress(event.target.value)}
								/>
							</form>
						</div>
					</LayerDialog.Body>
					<LayerDialog.Actions dismissLabel={t("Cancel")}>
						<LayerDialog.Action type="submit" form="editor-link">
							{t("Apply")}
						</LayerDialog.Action>
					</LayerDialog.Actions>
				</LayerDialog.Content>
			</LayerDialog.Root>
		</div>
	);
}
