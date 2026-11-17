// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified by the Podbay contributors.

import { Banner, Button, Tooltip } from "@cloudflare/kumo";
import { FileIcon, FloppyDiskIcon, PaperclipIcon, TrashIcon, XIcon } from "@phosphor-icons/react";
import { type DragEvent, type KeyboardEvent, type ReactNode, useEffect, useRef } from "react";
import type { ComposeForm } from "~/hooks/useComposeForm";
import { formatBytes } from "~/lib/utils";
import AddressField from "./AddressField";
import RichTextEditor from "./RichTextEditor";

const FIELD =
	"min-w-0 flex-1 border-0 bg-transparent py-2 text-sm text-kumo-default outline-none placeholder:text-kumo-subtle";

/** One line of the header: a quiet label, a field with no box, a hairline under it. */
function Line({ label, id, children }: { label: string; id: string; children: ReactNode }) {
	return (
		<div className="flex items-center gap-2 border-b border-kumo-line px-4">
			<label htmlFor={id} className="shrink-0 text-sm text-kumo-subtle">
				{label}
			</label>
			{children}
		</div>
	);
}

/**
 * The inside of the compose window: who it goes to, the subject, the message, and one row of
 * actions with Send first. Cmd or Ctrl with Enter sends from anywhere in the form.
 */
export default function ComposePanel({ form }: { form: ComposeForm }) {
	const toField = useRef<HTMLInputElement>(null);
	const filePicker = useRef<HTMLInputElement>(null);

	/** Files dropped anywhere on the message are attached to it. */
	function onDrop(event: DragEvent<HTMLFormElement>) {
		if (event.dataTransfer.files.length === 0) return;
		event.preventDefault();
		form.addFiles(event.dataTransfer.files);
	}
	const { mode, isDraftEdit } = form;

	// A new message starts at "To"; a reply starts in the text, above what it answers.
	const startsInText = isDraftEdit || mode === "reply" || mode === "reply-all";
	useEffect(() => {
		if (!startsInText) toField.current?.focus();
	}, [startsInText]);

	function onKeyDown(event: KeyboardEvent<HTMLFormElement>) {
		if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			event.currentTarget.requestSubmit();
		}
	}

	return (
		<form
			onSubmit={(event) => form.handleSend(event, form.closeCompose)}
			onInput={form.touch}
			onKeyDown={onKeyDown}
			onDragOver={(event) => {
				if (event.dataTransfer.types.includes("Files")) event.preventDefault();
			}}
			onDrop={onDrop}
			className="flex min-h-0 flex-1 flex-col bg-kumo-base"
		>
			{form.error && (
				<div className="px-4 pt-3">
					<Banner variant="error" text={form.error} />
				</div>
			)}

			<Line label="To" id="compose-to">
				<AddressField
					inputRef={toField}
					id="compose-to"
					className={FIELD}
					value={form.to}
					onChange={form.setTo}
					known={form.knownAddresses}
					required
				/>
				{!form.showCcBcc && (
					<button
						type="button"
						onClick={() => form.setShowCcBcc(true)}
						className="shrink-0 cursor-pointer border-0 bg-transparent p-0 text-sm text-kumo-subtle hover:text-kumo-default hover:underline"
					>
						Cc Bcc
					</button>
				)}
			</Line>
			{form.showCcBcc && (
				<Line label="Cc" id="compose-cc">
					<AddressField
						id="compose-cc"
						className={FIELD}
						value={form.cc}
						onChange={form.setCc}
						known={form.knownAddresses}
					/>
				</Line>
			)}
			{form.showCcBcc && (
				<Line label="Bcc" id="compose-bcc">
					<AddressField
						id="compose-bcc"
						className={FIELD}
						value={form.bcc}
						onChange={form.setBcc}
						known={form.knownAddresses}
					/>
				</Line>
			)}
			<div className="flex items-center border-b border-kumo-line px-4">
				<label htmlFor="compose-subject" className="sr-only">
					Subject
				</label>
				<input
					id="compose-subject"
					type="text"
					placeholder="Subject"
					autoComplete="off"
					className={FIELD}
					value={form.subject}
					onChange={(event) => form.setSubject(event.target.value)}
					required
				/>
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto p-2">
				<RichTextEditor value={form.body} onChange={form.setBody} focusOnLoad={startsInText} />
			</div>

			{form.files.length > 0 && (
				<div className="shrink-0 border-t border-kumo-line px-3 pt-2">
					<ul aria-label="Attached files" className="m-0 flex list-none flex-wrap gap-1.5 p-0">
						{form.files.map((file, index) => (
							<li
								key={`${file.name}-${file.size}-${file.lastModified}`}
								className="flex max-w-full items-center gap-1.5 rounded-md border border-kumo-line bg-kumo-recessed py-1 pl-2 pr-1 text-xs text-kumo-default"
							>
								<FileIcon size={14} className="shrink-0 text-kumo-subtle" />
								<span className="truncate">{file.name}</span>
								<span className="shrink-0 text-kumo-subtle">{formatBytes(file.size)}</span>
								<button
									type="button"
									onClick={() => form.removeFile(index)}
									aria-label={`Remove ${file.name}`}
									className="shrink-0 cursor-pointer rounded border-0 bg-transparent p-0.5 text-kumo-subtle hover:bg-kumo-fill hover:text-kumo-default"
								>
									<XIcon size={12} />
								</button>
							</li>
						))}
					</ul>
					<p className="m-0 mt-1 text-xs text-kumo-subtle">
						Files are sent with the message. A draft does not keep them.
					</p>
				</div>
			)}

			<div className="flex shrink-0 items-center gap-1 border-t border-kumo-line px-3 py-2.5">
				<Tooltip content="Send (Ctrl or ⌘ with Enter)" side="top" asChild>
					<Button
						type="submit"
						variant="primary"
						className="rounded-full px-5"
						loading={form.isSending}
						disabled={form.isSavingDraft || form.isSending}
					>
						{form.isSending ? "Sending" : "Send"}
					</Button>
				</Tooltip>
				<input
					ref={filePicker}
					type="file"
					multiple
					className="sr-only"
					tabIndex={-1}
					aria-label="Files to attach"
					onChange={(event) => {
						if (event.target.files) form.addFiles(event.target.files);
						// The same file can be picked again after it was removed.
						event.target.value = "";
					}}
				/>
				<Tooltip content="Attach files" side="top" asChild>
					<Button
						type="button"
						variant="ghost"
						shape="square"
						size="sm"
						icon={<PaperclipIcon size={18} />}
						disabled={form.isSending}
						onClick={() => filePicker.current?.click()}
						aria-label="Attach files"
					/>
				</Tooltip>
				<Tooltip content="Save draft" side="top" asChild>
					<Button
						type="button"
						variant="ghost"
						shape="square"
						size="sm"
						icon={<FloppyDiskIcon size={18} />}
						loading={form.isSavingDraft}
						disabled={form.isSending}
						onClick={() => void form.handleSaveDraft()}
						aria-label="Save draft"
					/>
				</Tooltip>
				<span className="ml-auto" />
				<Tooltip content="Discard" side="top" asChild>
					<Button
						type="button"
						variant="ghost"
						shape="square"
						size="sm"
						icon={<TrashIcon size={18} />}
						disabled={form.isSending}
						onClick={form.discard}
						aria-label="Discard"
					/>
				</Tooltip>
			</div>
		</form>
	);
}
