// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { Badge, Button, useKumoToastManager } from "@cloudflare/kumo";
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { t } from "~/i18n";
import { useUpdateMailbox } from "~/queries/mailboxes";
import type { Mailbox } from "~/types";

// Shown while no prompt of the mailbox's own is set. The prompt that is really used is in the
// Worker (workers/agent/index.ts).
const PROMPT_PLACEHOLDER = `You are an email assistant that helps manage this inbox. You read emails, draft replies, and help organize conversations.\n\nWrite like a real person. Short, direct, flowing prose. Plain text only.\n\n(Leave empty to use the built-in prompt)`;

/** How the assistant of this mailbox is told to behave. */
export default function AssistantSettings({ mailbox }: { mailbox: Mailbox }) {
	const toasts = useKumoToastManager();
	const updateMailbox = useUpdateMailbox();
	const isOwner = mailbox.role === "owner";
	const [prompt, setPrompt] = useState("");
	const custom = prompt.trim().length > 0;

	// biome-ignore lint/correctness/useExhaustiveDependencies: filled when the mailbox arrives or changes
	useEffect(() => {
		setPrompt(mailbox.settings?.agentSystemPrompt || "");
	}, [mailbox.id]);

	async function save() {
		try {
			await updateMailbox.mutateAsync({
				mailboxId: mailbox.id,
				settings: { ...mailbox.settings, agentSystemPrompt: prompt.trim() || undefined },
			});
			toasts.add({ title: t("Prompt saved") });
		} catch {
			toasts.add({ title: t("The prompt could not be saved"), variant: "error" });
		}
	}

	return (
		<div className="space-y-3">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<span className="text-sm font-medium text-kumo-default">{t("Prompt")}</span>
					<Badge variant={custom ? "primary" : "secondary"}>
						{custom ? t("Custom") : t("Built in")}
					</Badge>
				</div>
				{custom && isOwner && (
					<Button
						variant="ghost"
						size="xs"
						icon={<ArrowCounterClockwiseIcon size={14} />}
						onClick={() => setPrompt("")}
					>
						{t("Back to the built-in prompt")}
					</Button>
				)}
			</div>
			<p className="m-0 text-xs text-kumo-subtle">
				{t(
					"The prompt is what the assistant is told before it reads any mail of this mailbox: how to write and what to mind. The assistant never sends; it saves drafts for a person to send.",
				)}
			</p>
			<textarea
				aria-label={t("Prompt")}
				value={prompt}
				disabled={!isOwner}
				onChange={(event) => setPrompt(event.target.value)}
				placeholder={PROMPT_PLACEHOLDER}
				rows={12}
				className="w-full resize-y rounded-lg border border-kumo-line bg-kumo-recessed px-3 py-2 font-mono text-xs leading-relaxed text-kumo-default placeholder:text-kumo-subtle focus:outline-none focus:ring-1 focus:ring-kumo-ring"
			/>
			{isOwner ? (
				<Button variant="primary" size="sm" loading={updateMailbox.isPending} onClick={save}>
					{t("Save prompt")}
				</Button>
			) : (
				<p className="m-0 text-xs text-kumo-subtle">
					{t("An owner of this mailbox can change it.")}
				</p>
			)}
		</div>
	);
}
