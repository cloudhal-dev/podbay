// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified by the Podbay contributors.

import { Button, useKumoToastManager } from "@cloudflare/kumo";
import { ArrowBendUpLeftIcon, ArrowBendUpRightIcon, ChatCircleIcon } from "@phosphor-icons/react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Folders } from "shared/folders";
import { useConfirm } from "~/components/Confirm";
import EmailPanelDialogs from "~/components/email-panel/EmailPanelDialogs";
import EmailPanelHeader from "~/components/email-panel/EmailPanelHeader";
import EmailPanelToolbar from "~/components/email-panel/EmailPanelToolbar";
import type { MessageActions } from "~/components/email-panel/MessageHeader";
import SingleMessageView from "~/components/email-panel/SingleMessageView";
import ThreadMessage from "~/components/email-panel/ThreadMessage";
import InlineReply from "~/components/InlineReply";
import { LabelChips } from "~/components/LabelChip";
import { useConversationActions } from "~/hooks/useConversationActions";
import { useDisplay } from "~/hooks/useDisplay";
import { useOpenConversation } from "~/hooks/useOpenConversation";
import { useShortcuts } from "~/hooks/useShortcuts";
import { useUIStore } from "~/hooks/useUIStore";
import { plural, t } from "~/i18n";
import { unsubscribeOf } from "~/lib/unsubscribe";
import { splitEmailList, toEmailListValue } from "~/lib/utils";
import {
	useDeleteEmail,
	useEmail,
	useReplyToEmail,
	useSendEmail,
	useThreadReplies,
} from "~/queries/emails";
import { useMailbox } from "~/queries/mailboxes";
import api from "~/services/api";
import type { Email, Mailbox } from "~/types";

function EmailPanelSkeleton() {
	return (
		<div className="animate-pulse p-5 space-y-4">
			<div className="h-5 w-2/3 rounded bg-kumo-fill" />
			<div className="flex items-center gap-3">
				<div className="w-10 h-10 rounded-full bg-kumo-fill" />
				<div className="space-y-2 flex-1">
					<div className="h-3 w-40 rounded bg-kumo-fill" />
					<div className="h-2.5 w-24 rounded bg-kumo-fill" />
				</div>
			</div>
			<div className="space-y-2 pt-4">
				<div className="h-2.5 w-full rounded bg-kumo-fill" />
				<div className="h-2.5 w-5/6 rounded bg-kumo-fill" />
				<div className="h-2.5 w-4/6 rounded bg-kumo-fill" />
				<div className="h-2.5 w-3/4 rounded bg-kumo-fill" />
			</div>
		</div>
	);
}

interface EmailPanelProps {
	emailId: string;
	/** The list this conversation was opened from, newest first, to step to the next one. */
	siblings?: Email[];
	/** Shown beside the list: the list keeps the keys that file a conversation. */
	inPane?: boolean;
}

export default function EmailPanel({ emailId, siblings = [], inPane = false }: EmailPanelProps) {
	const { mailboxId, folder } = useParams({ strict: false });
	const { data: email } = useEmail(mailboxId, emailId) as { data?: Email };
	const { data: threadRepliesRaw } = useThreadReplies(mailboxId, email?.thread_id) as {
		data?: Email[];
	};
	const deleteEmailMut = useDeleteEmail();
	const sendEmailMut = useSendEmail();
	const replyMut = useReplyToEmail();
	const { data: currentMailbox } = useMailbox(mailboxId) as {
		data?: Mailbox;
	};
	const { closePanel, startCompose } = useUIStore();
	const toastManager = useKumoToastManager();
	const confirm = useConfirm();
	const actions = useConversationActions(mailboxId, folder || email?.folder_id || undefined);
	const navigate = useNavigate();
	/** What is being printed: one message, the whole conversation, or nothing. */
	const [printing, setPrinting] = useState<string | "all" | null>(null);
	const openConversation = useOpenConversation(mailboxId);
	const position = siblings.findIndex((sibling) => sibling.id === emailId);
	const newer = position > 0 ? siblings[position - 1] : undefined;
	const older = position >= 0 ? siblings[position + 1] : undefined;
	const [isSending, setIsSending] = useState(false);
	const [sourceViewEmail, setSourceViewEmail] = useState<Email | null>(null);
	const [expandedMessages, setExpandedMessages] = useState<Set<string>>(new Set());
	const [previewImage, setPreviewImage] = useState<{ url: string; filename: string } | null>(null);
	const isDraftFolder = folder === Folders.DRAFT;

	// With conversations turned off, a message is read by itself.
	const conversations = useDisplay((state) => state.conversationView);
	const threadReplies = useMemo(() => {
		if (!conversations || !threadRepliesRaw || !email) return [];
		return threadRepliesRaw.filter((e) => e.id !== email.id);
	}, [threadRepliesRaw, email, conversations]);

	/** The folder this conversation is in: the one on screen, or its own in search results. */
	const place = folder || email?.folder_id || undefined;

	// Oldest first, as a conversation is read. A message that was deleted or reported from this
	// conversation is not shown in it, unless the conversation is being read in Trash or Spam.
	const allMessages = useMemo(() => {
		if (!email) return [];
		const away = (msg: Email) =>
			msg.id !== email.id &&
			(msg.folder_id === Folders.TRASH || msg.folder_id === Folders.SPAM) &&
			msg.folder_id !== place;
		return [email, ...threadReplies]
			.filter((msg) => !away(msg))
			.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
	}, [email, threadReplies, place]);

	// Until the reader folds or opens something, a conversation shows its newest message and
	// whatever is still unread, also when its other messages arrive after the first one.
	const currentEmailId = email?.id;
	const choseWhatIsOpen = useRef(false);
	/** A long conversation keeps its middle folded into one line until the reader asks for it. */
	const [showsMiddle, setShowsMiddle] = useState(false);
	// biome-ignore lint/correctness/useExhaustiveDependencies: a different conversation starts afresh
	useEffect(() => {
		choseWhatIsOpen.current = false;
		setExpandedMessages(new Set());
		setShowsMiddle(false);
	}, [currentEmailId]);
	const openByDefault = allMessages
		.filter((msg, index) => index === allMessages.length - 1 || !msg.read)
		.map((msg) => msg.id)
		.join(",");
	useEffect(() => {
		// Only ever opens more: a message that was open because it was unread stays open once read.
		if (!choseWhatIsOpen.current) {
			setExpandedMessages((open) => new Set([...open, ...openByDefault.split(",")]));
		}
	}, [openByDefault]);
	const setExpanded: typeof setExpandedMessages = (next) => {
		choseWhatIsOpen.current = true;
		setExpandedMessages(next);
	};

	const toggleExpand = (msgId: string) => {
		setExpanded((prev) => {
			const next = new Set(prev);
			if (next.has(msgId)) next.delete(msgId);
			else next.add(msgId);
			return next;
		});
	};

	const draftMessageIds = useMemo(() => {
		const ids = new Set<string>();
		for (const msg of allMessages) {
			if (msg.folder_id === Folders.DRAFT) ids.add(msg.id);
			else if (isDraftFolder && msg.id === emailId) ids.add(msg.id);
		}
		return ids;
	}, [allMessages, isDraftFolder, emailId]);

	const lastReceivedMessage = useMemo(() => {
		const ce = currentMailbox?.email;
		const received = allMessages.filter((msg) => !draftMessageIds.has(msg.id) && msg.sender !== ce);
		if (received.length > 0) return received[received.length - 1];
		const nonDrafts = allMessages.filter((msg) => !draftMessageIds.has(msg.id));
		return nonDrafts.length > 0 ? nonDrafts[nonDrafts.length - 1] : email;
	}, [allMessages, draftMessageIds, currentMailbox?.email, email]);

	// Printing waits for the screen to show what will be printed, and ends when the dialog closes.
	useEffect(() => {
		if (printing === null) return;
		const done = () => setPrinting(null);
		window.addEventListener("afterprint", done, { once: true });
		const timer = setTimeout(() => window.print(), 150);
		return () => {
			clearTimeout(timer);
			window.removeEventListener("afterprint", done);
		};
	}, [printing]);

	const isOpen = email !== undefined && !isDraftFolder;
	/**
	 * After the conversation is filed away: back to the list, or on to the next one, as the reader
	 * chose in the settings.
	 */
	const afterFiling = useDisplay((state) => state.afterFiling);
	const away = (did: boolean) => {
		if (!did) return;
		const next = afterFiling === "newer" ? newer : afterFiling === "older" ? older : undefined;
		if (next) openConversation(next);
		else closePanel();
	};
	// An answer to an open conversation is written under it.
	const reply = (mode: "reply" | "reply-all" | "forward") =>
		startCompose(
			{ mode, originalEmail: mode === "forward" ? email : lastReceivedMessage },
			"inline",
		);
	const answering = useUIStore((state) => state.isComposing && state.composePlacement === "inline");
	// Beside the list only the keys that answer live here; the list has the rest.
	useShortcuts(
		{ r: () => reply("reply"), a: () => reply("reply-all"), f: () => reply("forward") },
		isOpen && inPane,
	);
	useShortcuts(
		{
			r: () => reply("reply"),
			a: () => reply("reply-all"),
			f: () => reply("forward"),
			k: () => newer && openConversation(newer),
			j: () => older && openConversation(older),
			";": () => {
				setShowsMiddle(true);
				setExpanded(new Set(allMessages.map((msg) => msg.id)));
			},
			":": () => setExpanded(new Set()),
			// Archive and go on to the next one, whatever "after filing" says.
			"]": () => {
				if (!email || place === Folders.ARCHIVE || !actions.archive([email])) return;
				if (older) openConversation(older);
				else closePanel();
			},
			"[": () => {
				if (!email || place === Folders.ARCHIVE || !actions.archive([email])) return;
				if (newer) openConversation(newer);
				else closePanel();
			},
			e: () => email && place !== Folders.ARCHIVE && away(actions.archive([email])),
			"#": () => email && void actions.remove([email]).then(away),
			"!": () => email && place !== Folders.SPAM && away(actions.reportSpam([email])),
			s: () => email && actions.star(email),
			"Shift+U": () => {
				if (email) actions.setRead([email], false);
				closePanel();
			},
		},
		isOpen && !inPane,
	);

	if (!email) return <EmailPanelSkeleton />;

	const handleEditDraft = (draftMsg?: Email) => {
		const target = draftMsg || email;
		if (target.in_reply_to) {
			startCompose({
				mode: "reply",
				originalEmail: allMessages.find((msg) => msg.id === target.in_reply_to),
				draftEmail: target,
			});
		} else {
			startCompose({ mode: "new", originalEmail: undefined, draftEmail: target });
		}
	};

	const handleDeleteDraft = async (draftMsg?: Email) => {
		const target = draftMsg || email;
		if (!mailboxId) return;
		const sure = await confirm({
			title: t("Discard this draft?"),
			body: t("The draft will be deleted. This cannot be undone."),
			action: t("Discard"),
			destructive: true,
		});
		if (!sure) return;
		deleteEmailMut.mutate({ mailboxId, id: target.id });
		toastManager.add({ title: t("Draft discarded") });
		if (target.id === emailId) closePanel();
	};

	const handleSendDraft = async (draftMsg?: Email) => {
		let target = draftMsg || email;
		if (!mailboxId || !currentMailbox) return;
		setIsSending(true);
		try {
			if (!target.recipient || !target.subject) {
				try {
					const fresh = (await api.getEmail(mailboxId, target.id)) as Email;
					if (fresh) target = fresh;
				} catch {}
			}
			if (!target.recipient) {
				toastManager.add({
					title: t("Cannot send: no recipient set on this draft."),
					variant: "error",
				});
				return;
			}
			const toRecipients = splitEmailList(target.recipient);
			if (toRecipients.length === 0) {
				toastManager.add({
					title: t("Cannot send: no valid recipient set on this draft."),
					variant: "error",
				});
				return;
			}
			const fromName = currentMailbox.settings?.fromName || currentMailbox.name;
			const from =
				fromName && fromName !== currentMailbox.email
					? { email: currentMailbox.email, name: fromName }
					: currentMailbox.email;
			const originalEmail = target.in_reply_to
				? allMessages.find((msg) => msg.id === target.in_reply_to)
				: undefined;
			const emailData = {
				to: toEmailListValue(toRecipients),
				cc: toEmailListValue(splitEmailList(target.cc)),
				bcc: toEmailListValue(splitEmailList(target.bcc)),
				from,
				subject: target.subject || t("(no subject)"),
				html: target.body || "",
				text: target.body ? target.body.replace(/<[^>]*>/g, "").trim() : "",
			};
			if (originalEmail)
				await replyMut.mutateAsync({ mailboxId, emailId: originalEmail.id, email: emailData });
			else await sendEmailMut.mutateAsync({ mailboxId, email: emailData });
			await deleteEmailMut.mutateAsync({ mailboxId, id: target.id });
			toastManager.add({ title: t("Message sent") });
			if (isDraftFolder) closePanel();
		} catch (err) {
			const message = (err instanceof Error ? err.message : null) || t("Failed to send email.");
			toastManager.add({ title: message, variant: "error" });
		} finally {
			setIsSending(false);
		}
	};

	const hasThread = allMessages.length > 1;
	const findFrom = (msg: Email) => {
		if (!mailboxId) return;
		void navigate({
			to: "/mailbox/$mailboxId/search",
			params: { mailboxId },
			search: { q: `from:${msg.sender}` },
		});
	};
	/** After one message leaves the conversation: go back when none is left, or stand on another. */
	const afterLeaving = (msg: Email) => (did: boolean) => {
		if (!did) return;
		const left = allMessages.filter((other) => other.id !== msg.id);
		const next = left[left.length - 1];
		if (!next) closePanel();
		else if (msg.id === emailId) useUIStore.getState().selectEmail(next.id);
	};
	/**
	 * Leaving the mailing list a message came from, as the message says how. Podbay contacts
	 * nobody by itself: a page is opened by the person, after being told where it leads, and a
	 * message is written for the person to send.
	 */
	const leaveList = (msg: Email) => {
		const way = msg.sender === currentMailbox?.email ? null : unsubscribeOf(msg.raw_headers);
		if (way === null) return undefined;
		return async () => {
			if (way.kind === "mail") {
				startCompose({ mode: "new", prefill: { to: way.address, subject: way.subject } });
				return;
			}
			const sure = await confirm({
				title: t("Unsubscribe from this list?"),
				body: t(
					"This opens {host} in a new tab, where the list takes you off. Podbay sends nothing by itself.",
					{ host: way.host },
				),
				action: t("Open the page"),
			});
			if (sure) window.open(way.url, "_blank", "noopener,noreferrer");
		};
	};
	const messageActions = (msg: Email): MessageActions => ({
		onReply: () => startCompose({ mode: "reply", originalEmail: msg }, "inline"),
		onReplyAll: () => startCompose({ mode: "reply-all", originalEmail: msg }, "inline"),
		onForward: () => startCompose({ mode: "forward", originalEmail: msg }, "inline"),
		onDelete: () => void actions.remove([msg], "message").then(afterLeaving(msg)),
		onMarkUnread: () => {
			actions.setRead([msg], false);
			closePanel();
		},
		onSpam:
			msg.folder_id === Folders.SPAM
				? undefined
				: () => afterLeaving(msg)(actions.reportSpam([msg], "message")),
		onStar: () => actions.star(msg),
		onPrint: () => {
			setExpanded((open) => new Set([...open, msg.id]));
			setPrinting(msg.id);
		},
		onFindFromSender: () => findFrom(msg),
		onShowHeaders: () => setSourceViewEmail(msg),
		onUnsubscribe: leaveList(msg),
	});
	const allExpanded = allMessages.every((msg) => expandedMessages.has(msg.id));
	// With five messages or more, the ones between the first and the last two that are folded
	// anyway are put away behind one line.
	const middle =
		showsMiddle || allMessages.length < 5
			? []
			: allMessages
					.slice(1, -2)
					.filter((msg) => !expandedMessages.has(msg.id) && !draftMessageIds.has(msg.id));
	const inMiddle = new Set(middle.map((msg) => msg.id));

	return (
		<div className="flex h-full flex-col print:block print:h-auto">
			<EmailPanelToolbar
				email={email}
				folder={place}
				isDraftFolder={isDraftFolder}
				isSending={isSending}
				moveToFolders={actions.moveTargets}
				labels={actions.labels}
				inPane={inPane}
				onBack={closePanel}
				onNewer={newer ? () => openConversation(newer) : undefined}
				onOlder={older ? () => openConversation(older) : undefined}
				showSteps={siblings.length > 0}
				onSendDraft={() => handleSendDraft()}
				onEditDraft={() => handleEditDraft()}
				onArchive={() => away(actions.archive([email]))}
				onSpam={() => away(actions.reportSpam([email]))}
				onNotSpam={() => away(actions.notSpam([email]))}
				onDelete={() => void actions.remove([email]).then(away)}
				onMarkUnread={() => {
					actions.setRead([email], false);
					closePanel();
				}}
				onToggleStar={() => actions.star(email)}
				onMove={(folderId) => away(actions.moveTo([email], folderId))}
				onMoveToLabel={(label) => away(actions.moveToLabel([email], label))}
				onLabel={(labelId, give) => actions.label([email], labelId, give)}
				onViewSource={() => setSourceViewEmail(email)}
				onPrintAll={() => {
					setShowsMiddle(true);
					setExpanded(new Set(allMessages.map((msg) => msg.id)));
					setPrinting("all");
				}}
				onToggleAll={
					hasThread
						? () => {
								setShowsMiddle(true);
								setExpanded(allExpanded ? new Set() : new Set(allMessages.map((msg) => msg.id)));
							}
						: undefined
				}
				allExpanded={allExpanded}
				onFindFromSender={() => findFrom(lastReceivedMessage ?? email)}
			/>

			<EmailPanelHeader
				labels={<LabelChips ids={email.labels} labels={actions.labels} />}
				subject={email.subject}
				messageCount={allMessages.length}
				showThreadCount={hasThread}
			/>

			<div className="flex-1 overflow-y-auto print:overflow-visible">
				{hasThread ? (
					allMessages.map((msg, idx) => {
						const isDraft = draftMessageIds.has(msg.id);
						if (inMiddle.has(msg.id)) {
							// One line stands for all of them, where the first of them would be.
							return msg.id === middle[0]?.id ? (
								<button
									key="middle"
									type="button"
									onClick={() => setShowsMiddle(true)}
									className="flex w-full cursor-pointer items-center gap-3 border-0 border-b border-kumo-line bg-kumo-recessed/60 px-4 py-2 text-left text-xs text-kumo-subtle hover:bg-kumo-tint md:px-6 print:hidden"
								>
									<span className="flex h-6 w-10 items-center justify-center rounded-full border border-kumo-line bg-kumo-base font-semibold text-kumo-default">
										{middle.length}
									</span>
									{plural(
										middle.length,
										"Show {count} older message",
										"Show {count} older messages",
									)}
								</button>
							) : null;
						}
						return (
							<ThreadMessage
								key={msg.id}
								email={msg}
								mailboxId={mailboxId}
								mailboxEmail={currentMailbox?.email}
								isLast={idx === allMessages.length - 1}
								isDraft={isDraft}
								isSending={isDraft ? isSending : false}
								isExpanded={expandedMessages.has(msg.id)}
								onToggleExpand={() => toggleExpand(msg.id)}
								onSendDraft={isDraft ? () => handleSendDraft(msg) : undefined}
								onEditDraft={isDraft ? () => handleEditDraft(msg) : undefined}
								onDeleteDraft={isDraft ? () => handleDeleteDraft(msg) : undefined}
								actions={isDraft ? undefined : messageActions(msg)}
								inTrash={msg.folder_id === Folders.TRASH}
								hiddenInPrint={printing !== null && printing !== "all" && printing !== msg.id}
								onPreviewImage={(url, filename) => setPreviewImage({ url, filename })}
							/>
						);
					})
				) : (
					<SingleMessageView
						email={email}
						mailboxId={mailboxId}
						mailboxEmail={currentMailbox?.email}
						isDraft={isDraftFolder}
						inTrash={place === Folders.TRASH}
						actions={isDraftFolder ? undefined : messageActions(email)}
						onPreviewImage={(url, filename) => setPreviewImage({ url, filename })}
					/>
				)}
				{answering && <InlineReply />}
				{!isDraftFolder && !answering && (
					<div className="flex flex-wrap gap-2 px-4 py-5 md:px-6 print:hidden">
						<Button
							variant="outline"
							className="rounded-full"
							icon={<ArrowBendUpLeftIcon size={16} />}
							onClick={() => reply("reply")}
						>
							{t("Reply")}
						</Button>
						<Button
							variant="outline"
							className="rounded-full"
							icon={<ChatCircleIcon size={16} />}
							onClick={() => reply("reply-all")}
						>
							{t("Reply all")}
						</Button>
						<Button
							variant="outline"
							className="rounded-full"
							icon={<ArrowBendUpRightIcon size={16} />}
							onClick={() => reply("forward")}
						>
							{t("Forward")}
						</Button>
					</div>
				)}
			</div>

			<EmailPanelDialogs
				sourceViewEmail={sourceViewEmail}
				previewImage={previewImage}
				onCloseSource={() => setSourceViewEmail(null)}
				onClosePreview={() => setPreviewImage(null)}
			/>
		</div>
	);
}
