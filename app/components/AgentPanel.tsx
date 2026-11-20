// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified by the Podbay contributors.

import { Badge, Button, InputArea, Loader, Tooltip } from "@cloudflare/kumo";
import {
	ArrowBendUpLeftIcon,
	ArrowUpIcon,
	CheckCircleIcon,
	EnvelopeSimpleIcon,
	EyeIcon,
	MagnifyingGlassIcon,
	PaperPlaneTiltIcon,
	PencilSimpleIcon,
	RobotIcon,
	StopIcon,
	TrashIcon,
	UserIcon,
	WrenchIcon,
} from "@phosphor-icons/react";
import { errorFields, log } from "@podbay/platform/log";
import { useParams } from "@tanstack/react-router";
import type { DynamicToolUIPart, ToolUIPart, UIMessage } from "ai";
import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useConfirm } from "~/components/Confirm";
import { useUIStore } from "~/hooks/useUIStore";
import { m, t } from "~/i18n";
import { escapeHtml } from "~/lib/utils";
import type { Email } from "~/types";

const TOOL_LABELS: Record<string, { label: string; icon: React.ReactNode }> = {
	list_emails: {
		label: m("Fetching emails"),
		icon: <EnvelopeSimpleIcon size={14} weight="bold" />,
	},
	get_email: {
		label: m("Reading email"),
		icon: <EyeIcon size={14} weight="bold" />,
	},
	get_thread: {
		label: m("Loading thread"),
		icon: <ArrowBendUpLeftIcon size={14} weight="bold" />,
	},
	search_emails: {
		label: m("Searching"),
		icon: <MagnifyingGlassIcon size={14} weight="bold" />,
	},
	draft_email: {
		label: m("Drafting email"),
		icon: <PaperPlaneTiltIcon size={14} weight="bold" />,
	},
	draft_reply: {
		label: m("Drafting reply"),
		icon: <PaperPlaneTiltIcon size={14} weight="bold" />,
	},
	discard_draft: {
		label: m("Discarding draft"),
		icon: <TrashIcon size={14} weight="bold" />,
	},
	mark_email_read: {
		label: m("Updating status"),
		icon: <CheckCircleIcon size={14} weight="bold" />,
	},
	move_email: {
		label: m("Moving email"),
		icon: <EnvelopeSimpleIcon size={14} weight="bold" />,
	},
};

function ToolCallBadge({ toolName, state }: { toolName: string; state: string }) {
	const info = TOOL_LABELS[toolName] || {
		label: toolName,
		icon: <WrenchIcon size={14} weight="bold" />,
	};
	const isDone =
		state === "output-available" || state === "output-error" || state === "output-denied";

	return (
		<div className="flex items-center gap-1.5 py-1 px-2 rounded bg-kumo-fill/50 text-xs">
			<span className="text-kumo-brand">{info.icon}</span>
			<span className="text-kumo-strong">{info.label}</span>
			{isDone ? (
				<CheckCircleIcon size={12} weight="fill" className="text-kumo-success ml-auto" />
			) : (
				<Loader size="sm" className="ml-auto" />
			)}
		</div>
	);
}

type MessagePart = UIMessage["parts"][number];
type ToolPart = ToolUIPart | DynamicToolUIPart;

/** A tool call of the assistant: a tool the server defines (`tool-<name>`) or a dynamic one. */
function isToolPart(part: MessagePart): part is ToolPart {
	return part.type === "dynamic-tool" || part.type.startsWith("tool-");
}

function toolNameOf(part: ToolPart): string {
	return part.type === "dynamic-tool" ? part.toolName : part.type.slice("tool-".length);
}

/**
 * The draft that the `draft_reply` tool saved, read from the tool's output. The output is made
 * by the Worker; the UI does not import Worker code, so the shape is checked here.
 */
function savedDraft(output: unknown, mailboxId: string): Email | null {
	if (typeof output !== "object" || output === null) return null;
	if (!("draftId" in output) || typeof output.draftId !== "string") return null;
	if (!("draft" in output) || typeof output.draft !== "object" || output.draft === null) {
		return null;
	}
	const fields = new Map<string, unknown>(Object.entries(output.draft));
	const text = (key: string): string => {
		const value = fields.get(key);
		return typeof value === "string" ? value : "";
	};
	return {
		id: output.draftId,
		subject: text("subject"),
		sender: mailboxId,
		recipient: text("to"),
		date: new Date().toISOString(),
		read: true,
		starred: false,
		// The tool returns the reply as plain text; the composer edits HTML.
		body: escapeHtml(text("body")).replace(/\n/g, "<br>"),
		in_reply_to: text("originalEmailId") || null,
	};
}

/** The draft of the first finished `draft_reply` call in a message, or null. */
function draftReplyOf(message: UIMessage, mailboxId: string): Email | null {
	for (const part of message.parts) {
		if (!isToolPart(part) || toolNameOf(part) !== "draft_reply") continue;
		if (part.state !== "output-available") continue;
		const draft = savedDraft(part.output, mailboxId);
		if (draft) return draft;
	}
	return null;
}

function hasDraftReplyTool(message: UIMessage): boolean {
	return message.parts.some((part) => isToolPart(part) && toolNameOf(part) === "draft_reply");
}

function DraftActions({ onEdit, disabled }: { onEdit: () => void; disabled: boolean }) {
	return (
		<div className="flex gap-1.5 mt-1">
			<Button
				variant="primary"
				size="sm"
				icon={<PencilSimpleIcon size={14} />}
				onClick={onEdit}
				disabled={disabled}
			>
				{t("Edit & send in composer")}
			</Button>
		</div>
	);
}

function MessageBubble({
	message,
	onAction,
	isStreaming,
}: {
	message: UIMessage;
	onAction?: (action: string) => void;
	isStreaming: boolean;
}) {
	const isUser = message.role === "user";

	return (
		<div className={`flex gap-2 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
			<div
				className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
					isUser ? "bg-kumo-brand text-kumo-inverse" : "bg-kumo-fill text-kumo-default"
				}`}
			>
				{isUser ? <UserIcon size={12} weight="bold" /> : <RobotIcon size={12} weight="bold" />}
			</div>
			<div
				className={`flex flex-col gap-1 max-w-[85%] min-w-0 ${
					isUser ? "items-end" : "items-start"
				}`}
			>
				{message.parts.map((part, i) => {
					const key = `${message.id}-part-${i}`;
					if (part.type === "text" && part.text.trim()) {
						return (
							<div
								key={key}
								className={`rounded-lg px-3 py-2 text-[13px] leading-relaxed break-words overflow-wrap-anywhere ${
									isUser
										? "bg-kumo-brand text-kumo-inverse rounded-br-sm"
										: "bg-kumo-elevated text-kumo-default border border-kumo-line rounded-bl-sm overflow-hidden"
								}`}
							>
								{isUser ? (
									part.text
								) : (
									<Markdown
										remarkPlugins={[remarkGfm]}
										components={{
											a: ({ href, children }) => (
												<a
													href={href}
													target="_blank"
													rel="noopener noreferrer"
													style={{
														color: "var(--color-link)",
														textDecoration: "underline",
													}}
												>
													{children}
												</a>
											),
											p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
											strong: ({ children }) => (
												<strong className="font-semibold">{children}</strong>
											),
											ul: ({ children }) => (
												<ul className="list-disc pl-4 mb-2 last:mb-0 space-y-0.5">{children}</ul>
											),
											ol: ({ children }) => (
												<ol className="list-decimal pl-4 mb-2 last:mb-0 space-y-0.5">{children}</ol>
											),
											li: ({ children }) => <li>{children}</li>,
											h1: ({ children }) => (
												<h3 className="font-semibold text-sm mb-1">{children}</h3>
											),
											h2: ({ children }) => (
												<h4 className="font-semibold text-[13px] mb-1">{children}</h4>
											),
											h3: ({ children }) => (
												<h5 className="font-semibold text-[13px] mb-0.5">{children}</h5>
											),
											code: ({ children }) => (
												<code className="bg-kumo-fill px-1 py-0.5 rounded text-[12px]">
													{children}
												</code>
											),
											table: ({ children }) => (
												<div className="overflow-x-auto my-2">
													<table className="w-full text-xs border-collapse">{children}</table>
												</div>
											),
											thead: ({ children }) => (
												<thead className="border-b border-kumo-line bg-kumo-fill/30">
													{children}
												</thead>
											),
											th: ({ children }) => (
												<th className="text-left px-2 py-1 font-semibold text-kumo-strong">
													{children}
												</th>
											),
											td: ({ children }) => (
												<td className="px-2 py-1 border-b border-kumo-line/50">{children}</td>
											),
										}}
									>
										{part.text}
									</Markdown>
								)}
							</div>
						);
					}
					if (isToolPart(part)) {
						return <ToolCallBadge key={key} toolName={toolNameOf(part)} state={part.state} />;
					}
					return null;
				})}
				{/* Show action buttons for draft replies */}
				{!isUser && hasDraftReplyTool(message) && onAction && (
					<DraftActions onEdit={() => onAction("edit")} disabled={isStreaming} />
				)}
			</div>
		</div>
	);
}

function AgentChatConnected({
	mailboxId,
	useAgent,
	useAgentChat,
}: {
	mailboxId: string;
	useAgent: typeof import("agents/react").useAgent;
	useAgentChat: typeof import("@cloudflare/ai-chat/react").useAgentChat;
}) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const [inputValue, setInputValue] = useState("");
	const { startCompose } = useUIStore();

	const agent = useAgent({ agent: "EmailAgent", name: mailboxId });
	const { messages, sendMessage, status, setMessages, stop } = useAgentChat({ agent });
	const confirm = useConfirm();
	const isStreaming = status === "streaming" || status === "submitted";

	// Keep the newest message in view; a streamed answer changes `messages` without adding one.
	useEffect(() => {
		const el = scrollRef.current;
		if (el && messages.length > 0) el.scrollTop = el.scrollHeight;
	}, [messages]);

	useEffect(() => {
		inputRef.current?.focus();
	}, []);

	const handleSend = () => {
		const text = inputValue.trim();
		if (!text || isStreaming) return;
		setInputValue("");
		sendMessage({ text });
		if (inputRef.current) inputRef.current.style.height = "auto";
	};

	const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			handleSend();
		}
	};

	const suggestedPrompts = [
		t("Show me the latest inbox emails"),
		t("Any unread emails?"),
		t("Draft a response to the latest email"),
	];

	return (
		<div className="flex flex-col h-full">
			{/* Header */}
			<div className="flex items-center justify-between px-3 py-1.5 border-b border-kumo-line shrink-0">
				<div className="flex items-center gap-2">
					<Badge variant="beta">{t("AI")}</Badge>
					<span className="text-xs text-kumo-subtle">{t("Email Agent")}</span>
				</div>
				<div className="flex items-center gap-1">
					{isStreaming && <Loader size="sm" />}
					{messages.length > 0 && (
						<Tooltip content={t("Clear chat")} asChild>
							<Button
								variant="ghost"
								shape="square"
								size="sm"
								icon={<TrashIcon size={14} />}
								onClick={async () => {
									const sure = await confirm({
										title: t("Clear this chat?"),
										body: t(
											"The conversation with the assistant will be removed. Your mail is not touched.",
										),
										action: t("Clear"),
										destructive: true,
									});
									if (sure) setMessages([]);
								}}
								aria-label={t("Clear chat")}
							/>
						</Tooltip>
					)}
				</div>
			</div>

			{/* Messages */}
			<div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-4">
				{messages.length === 0 ? (
					<div className="flex flex-col items-center justify-center h-full gap-4">
						<div className="flex h-12 w-12 items-center justify-center rounded-xl bg-kumo-brand/10">
							<RobotIcon size={24} weight="duotone" className="text-kumo-brand" />
						</div>
						<p className="text-xs text-kumo-subtle text-center leading-relaxed px-4">
							{t("I can read emails, search conversations, and draft replies.")}
						</p>
						<div className="flex flex-col gap-1.5 w-full">
							{suggestedPrompts.map((prompt) => (
								<button
									key={prompt}
									type="button"
									onClick={() => sendMessage({ text: prompt })}
									className="text-left px-3 py-2 rounded-lg border border-kumo-line text-xs text-kumo-strong hover:bg-kumo-tint hover:border-kumo-fill-hover transition-colors cursor-pointer bg-transparent"
								>
									{prompt}
								</button>
							))}
						</div>
					</div>
				) : (
					<div className="flex flex-col gap-3">
						{messages.map((msg: UIMessage) => (
							<MessageBubble
								key={msg.id}
								message={msg}
								isStreaming={isStreaming}
								onAction={(action) => {
									if (action === "edit") {
										// Open the saved draft in the composer. Sending stays the person's action.
										const draftEmail = draftReplyOf(msg, mailboxId);
										if (draftEmail) {
											startCompose({ mode: "reply", originalEmail: null, draftEmail });
										} else {
											sendMessage({
												text: t(
													"Let me edit this draft first. Show me what you have so I can modify it.",
												),
											});
										}
									}
								}}
							/>
						))}
						{isStreaming && (
							<div className="flex gap-2">
								<div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-kumo-fill text-kumo-default">
									<RobotIcon size={12} weight="bold" />
								</div>
								<div className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-kumo-elevated border border-kumo-line rounded-bl-sm">
									<Loader size="sm" />
									<span className="text-xs text-kumo-subtle">{t("Thinking...")}</span>
								</div>
							</div>
						)}
					</div>
				)}
			</div>

			{/* Input */}
			<div className="shrink-0 border-t border-kumo-line px-3 py-2">
				{isStreaming ? (
					<div className="flex justify-center">
						<Button
							variant="secondary"
							size="sm"
							icon={<StopIcon size={14} weight="fill" />}
							onClick={() => stop()}
						>
							{t("Stop generating")}
						</Button>
					</div>
				) : (
					<div className="flex items-end gap-1.5">
						{/* Kumo's text area at the small size: 12 px words as before, growing to five lines. */}
						<InputArea
							ref={inputRef}
							id="agent-chat-input"
							name="agent-chat-input"
							size="sm"
							autoResize
							minRows={1}
							maxRows={5}
							value={inputValue}
							onChange={(e) => setInputValue(e.target.value)}
							onKeyDown={handleKeyDown}
							placeholder={t("Ask your email agent...")}
							aria-label={t("Chat message input")}
							className="flex-1"
						/>
						<Button
							variant="primary"
							shape="square"
							size="sm"
							disabled={!inputValue.trim()}
							icon={<ArrowUpIcon size={14} weight="bold" />}
							onClick={handleSend}
							aria-label={t("Send message")}
						/>
					</div>
				)}
			</div>
		</div>
	);
}

export default function AgentPanel() {
	const { mailboxId } = useParams({ strict: false });
	const [hooks, setHooks] = useState<{
		useAgent: typeof import("agents/react").useAgent;
		useAgentChat: typeof import("@cloudflare/ai-chat/react").useAgentChat;
	} | null>(null);

	const [loadError, setLoadError] = useState<string | null>(null);

	useEffect(() => {
		Promise.all([import("agents/react"), import("@cloudflare/ai-chat/react")])
			.then(([a, c]) =>
				setHooks({
					useAgent: a.useAgent,
					useAgentChat: c.useAgentChat,
				}),
			)
			.catch((err) => {
				log.error("ui.agent_modules_failed", errorFields(err));
				setLoadError(t("Failed to connect to agent. Reload to retry."));
			});
	}, []);

	if (loadError) {
		return (
			<div className="flex flex-col items-center justify-center h-full gap-2 px-4 text-center">
				<span className="text-xs text-kumo-error">{loadError}</span>
			</div>
		);
	}

	if (!hooks) {
		return (
			<div className="flex flex-col items-center justify-center h-full gap-2">
				<Loader size="base" />
				<span className="text-xs text-kumo-subtle">{t("Connecting...")}</span>
			</div>
		);
	}

	return (
		<AgentChatConnected
			mailboxId={mailboxId ?? "default"}
			useAgent={hooks.useAgent}
			useAgentChat={hooks.useAgentChat}
		/>
	);
}
