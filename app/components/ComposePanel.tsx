// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified by the Podbay contributors.

import { Banner, Button, Tooltip } from "@cloudflare/kumo";
import { FileIcon, FloppyDiskIcon, PaperclipIcon, TrashIcon, XIcon } from "@phosphor-icons/react";
import { type DragEvent, type KeyboardEvent, type ReactNode, useEffect, useRef } from "react";
import type { ComposeForm } from "~/hooks/useComposeForm";
import { useDisplay } from "~/hooks/useDisplay";
import { m, t } from "~/i18n";
import { reasonWords } from "~/lib/sending-words";
import { formatBytes } from "~/lib/utils";
import AddressField from "./AddressField";
import { useConfirm } from "./Confirm";
import RichTextEditor from "./RichTextEditor";
import SendLater from "./SendLater";

/** Why a file of a forwarded message was not carried into the draft. */
const LEFT_BEHIND = {
	risk: m("{name} was not carried over: it can do harm when opened."),
	size: m("{name} was not carried over: it is too large to send with the rest."),
	count: m("{name} was not carried over: a message carries no more files."),
	missing: m("{name} could not be carried over."),
} as const;

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
	const formElement = useRef<HTMLFormElement>(null);
	const confirm = useConfirm();

	/** Files dropped anywhere on the message are attached to it. */
	function onDrop(event: DragEvent<HTMLFormElement>) {
		if (event.dataTransfer.files.length === 0) return;
		event.preventDefault();
		form.addFiles(event.dataTransfer.files);
	}
	const { mode, isDraftEdit } = form;
	const sendAndArchive = useDisplay((state) => state.sendAndArchive);

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
			ref={formElement}
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
			{form.notSent !== undefined && !form.error && (
				<div className="px-4 pt-3">
					<Banner
						variant="alert"
						text={t("This message was not sent. {reason}", { reason: reasonWords(form.notSent) })}
					/>
				</div>
			)}

			<Line label={t("To")} id="compose-to">
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
					// Kumo's ghost button at the small size, 26 px, a larger target than the 15 px line of text
					// it was; set back by its padding so its word ends where it ended.
					<Button
						variant="ghost"
						size="sm"
						onClick={() => form.setShowCcBcc(true)}
						className="-mr-2 shrink-0 text-kumo-subtle"
					>
						{t("Cc Bcc")}
					</Button>
				)}
			</Line>
			{form.showCcBcc && (
				<Line label={t("Cc")} id="compose-cc">
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
				<Line label={t("Bcc")} id="compose-bcc">
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
					{t("Subject")}
				</label>
				<input
					id="compose-subject"
					type="text"
					placeholder={t("Subject")}
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

			{form.leftBehind.length > 0 && (
				<ul
					aria-label={t("Files that were not carried over")}
					className="m-0 shrink-0 list-none space-y-0.5 border-t border-kumo-line px-3 pt-2 text-xs text-kumo-warning"
				>
					{form.leftBehind.map((left) => (
						<li key={left.id} className="flex flex-wrap items-center gap-x-2">
							<span>{t(LEFT_BEHIND[left.reason], { name: left.name })}</span>
							{left.reason === "risk" && (
								<Button
									variant="ghost"
									size="xs"
									onClick={async () => {
										const sure = await confirm({
											title: t("Forward this file?"),
											body: t(
												"{name} is a kind of file that can do harm when it is opened. Whoever gets your message gets it too.",
												{ name: left.name },
											),
											action: t("Add it anyway"),
											destructive: true,
										});
										if (sure) form.carryAnyway(left);
									}}
									// Underlined, the text action it was; its margins give back its padding and height.
									className="-my-0.5 -ml-1.5 text-kumo-default underline"
								>
									{t("Add it anyway")}
								</Button>
							)}
						</li>
					))}
				</ul>
			)}
			{form.files.length > 0 && (
				<div className="shrink-0 border-t border-kumo-line px-3 pt-2">
					<ul aria-label={t("Attached files")} className="m-0 flex list-none flex-wrap gap-1.5 p-0">
						{form.files.map((file) => (
							<li
								key={file.key}
								className="flex max-w-full items-center gap-1.5 rounded-md border border-kumo-line bg-kumo-recessed py-1 pl-2 pr-1 text-xs text-kumo-default"
							>
								<FileIcon size={14} className="shrink-0 text-kumo-subtle" />
								<span className="truncate">{file.name}</span>
								<span className="shrink-0 text-kumo-subtle">
									{file.uploading === null
										? formatBytes(file.size)
										: t("Attaching {percent}%", { percent: Math.round(file.uploading * 100) })}
								</span>
								{/* Kumo's square button at the small size, 26 px, larger than the 16 px it was; its
								    margins give back the 10 px it is larger, so the file's chip keeps its size. */}
								<Button
									variant="ghost"
									shape="square"
									size="sm"
									onClick={() => form.removeFile(file)}
									aria-label={t("Remove {name}", { name: file.name })}
									className="-m-[5px] shrink-0 text-kumo-subtle"
									icon={<XIcon size={12} />}
								/>
							</li>
						))}
					</ul>
				</div>
			)}

			{/* One row of one height: on a phone Send later shows its clock alone, the saved note gives
			    way and is cut, and Delete keeps its place at the right end, before and after a save. */}
			<div className="flex shrink-0 items-center gap-1 border-t border-kumo-line px-3 py-2.5">
				<Tooltip content={t("Send (Ctrl or ⌘ with Enter)")} side="top" asChild>
					<Button
						type="submit"
						variant="primary"
						className="rounded-full"
						loading={form.isSending}
						disabled={form.isSavingDraft || form.isSending}
					>
						{form.isSending ? t("Sending") : t("Send")}
					</Button>
				</Tooltip>
				{sendAndArchive && (mode === "reply" || mode === "reply-all") && (
					<Button
						type="button"
						variant="secondary"
						className="rounded-full"
						disabled={form.isSavingDraft || form.isSending}
						onClick={(event) => void form.handleSend(event, form.closeCompose, true)}
					>
						{t("Send and archive")}
					</Button>
				)}
				{/* A time later on: the message waits in Scheduled until then (ADR-0016). */}
				<SendLater
					label={t("Send later")}
					action={t("Schedule send")}
					iconOnPhone
					disabled={form.isSavingDraft || form.isSending}
					onChoose={(sendAt) => {
						// The same fields must be filled as for Send.
						if (formElement.current?.reportValidity() === false) return;
						void form.handleSend({ preventDefault() {} }, form.closeCompose, false, sendAt);
					}}
				/>
				<input
					ref={filePicker}
					type="file"
					multiple
					className="sr-only"
					tabIndex={-1}
					aria-label={t("Files to attach")}
					onChange={(event) => {
						if (event.target.files) form.addFiles(event.target.files);
						// The same file can be picked again after it was removed.
						event.target.value = "";
					}}
				/>
				<Tooltip content={t("Attach files")} side="top" asChild>
					<Button
						type="button"
						variant="ghost"
						shape="square"
						size="sm"
						icon={<PaperclipIcon size={18} />}
						disabled={form.isSending}
						onClick={() => filePicker.current?.click()}
						aria-label={t("Attach files")}
					/>
				</Tooltip>
				<Tooltip content={t("Save draft")} side="top" asChild>
					<Button
						type="button"
						variant="ghost"
						shape="square"
						size="sm"
						icon={<FloppyDiskIcon size={18} />}
						loading={form.isSavingDraft}
						disabled={form.isSending}
						onClick={() => void form.handleSaveDraft()}
						aria-label={t("Save draft")}
					/>
				</Tooltip>
				{form.isSaved && (
					<span className="ml-1 min-w-0 truncate text-xs text-kumo-subtle">{t("Saved")}</span>
				)}
				<span className="ml-auto" />
				<Tooltip content={t("Discard")} side="top" asChild>
					<Button
						type="button"
						variant="ghost"
						shape="square"
						size="sm"
						icon={<TrashIcon size={18} />}
						disabled={form.isSending}
						onClick={form.discard}
						aria-label={t("Discard")}
					/>
				</Tooltip>
			</div>
		</form>
	);
}
