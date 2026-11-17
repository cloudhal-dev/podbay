// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified by the Podbay contributors.

import { PencilSimpleIcon, PlugsIcon, WrenchIcon } from "@phosphor-icons/react";
import { useParams } from "@tanstack/react-router";
import { MCP_TOOLS } from "shared/mcp-tools";
import { t } from "~/i18n";
import AccessKeys from "./AccessKeys";
import CopyButton from "./CopyButton";

export default function MCPPanel() {
	const { mailboxId } = useParams({ strict: false });
	const mcpUrl = `${window.location.origin}/mcp`;

	return (
		<div className="flex flex-col h-full">
			<div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
				<div className="space-y-2">
					<div className="flex items-center gap-2">
						<div className="flex h-10 w-10 items-center justify-center rounded-xl bg-kumo-brand/10">
							<PlugsIcon size={20} weight="duotone" className="text-kumo-brand" />
						</div>
						<div>
							<h3 className="text-sm font-semibold text-kumo-default">
								{t("Connect an AI client")}
							</h3>
							<p className="text-xs text-kumo-subtle">Model Context Protocol</p>
						</div>
					</div>
					<p className="text-xs text-kumo-subtle leading-relaxed">
						{t(
							"An AI client can read the mailboxes you choose, organise them and prepare drafts. It can never send: a person opens the draft here and sends it. Each client gets its own key, and a key stops working the moment you revoke it or lose access to a mailbox.",
						)}
					</p>
				</div>

				<div className="space-y-1.5">
					<p className="text-xs font-medium text-kumo-strong">{t("Server URL")}</p>
					<div className="relative">
						<div className="absolute right-1.5 top-1/2 -translate-y-1/2">
							<CopyButton text={mcpUrl} label={t("Copy the server URL")} />
						</div>
						<div className="bg-kumo-recessed text-kumo-default font-mono text-[11px] px-3 py-2.5 pr-10 rounded-lg border border-kumo-line break-all leading-relaxed">
							{mcpUrl}
						</div>
					</div>
				</div>

				<AccessKeys currentMailbox={mailboxId} />

				<div className="space-y-2">
					<h4 className="text-xs uppercase tracking-wider font-semibold text-kumo-subtle">
						{t("What a client can do")}
					</h4>
					<ul className="border border-kumo-line rounded-lg divide-y divide-kumo-line">
						{MCP_TOOLS.map((tool) => (
							<li key={tool.name} className="flex items-center gap-2.5 px-3 py-2">
								{tool.changes ? (
									<PencilSimpleIcon size={12} weight="bold" className="text-kumo-brand shrink-0" />
								) : (
									<WrenchIcon size={12} weight="bold" className="text-kumo-subtle shrink-0" />
								)}
								<span className="text-xs text-kumo-default flex-1 min-w-0">{tool.summary}</span>
								<span className="text-[11px] font-mono text-kumo-subtle shrink-0">{tool.name}</span>
							</li>
						))}
					</ul>
					<p className="text-[11px] text-kumo-subtle">
						{t(
							'The marked actions need a key with "Read, organise, draft" and a mailbox you can write in.',
						)}
					</p>
				</div>
			</div>
		</div>
	);
}
