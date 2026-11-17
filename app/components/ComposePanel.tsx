// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified by the Podbay contributors.

import { Banner, Button, Tooltip } from "@cloudflare/kumo";
import { FloppyDiskIcon, TrashIcon } from "@phosphor-icons/react";
import { type KeyboardEvent, type ReactNode, useEffect, useRef } from "react";
import type { ComposeForm } from "~/hooks/useComposeForm";
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
			className="flex min-h-0 flex-1 flex-col bg-kumo-base"
		>
			{form.error && (
				<div className="px-4 pt-3">
					<Banner variant="error" text={form.error} />
				</div>
			)}

			<Line label="To" id="compose-to">
				<input
					ref={toField}
					id="compose-to"
					type="text"
					autoComplete="off"
					className={FIELD}
					value={form.to}
					onChange={(event) => form.setTo(event.target.value)}
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
					<input
						id="compose-cc"
						type="text"
						autoComplete="off"
						className={FIELD}
						value={form.cc}
						onChange={(event) => form.setCc(event.target.value)}
					/>
				</Line>
			)}
			{form.showCcBcc && (
				<Line label="Bcc" id="compose-bcc">
					<input
						id="compose-bcc"
						type="text"
						autoComplete="off"
						className={FIELD}
						value={form.bcc}
						onChange={(event) => form.setBcc(event.target.value)}
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
