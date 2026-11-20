// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified by the Podbay contributors.

import { Loader, Tabs } from "@cloudflare/kumo";
import { PlugsIcon, RobotIcon } from "@phosphor-icons/react";
import { errorFields, log } from "@podbay/platform/log";
import { useEffect, useState } from "react";
import { t } from "~/i18n";
import { useFeatures } from "~/queries/config";
import MCPPanel from "./MCPPanel";

function LazyAgentPanel() {
	const [AgentChat, setAgentChat] = useState<React.ComponentType | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);

	useEffect(() => {
		import("~/components/AgentPanel")
			.then((mod) => {
				setAgentChat(() => mod.default);
			})
			.catch((err) => {
				log.error("ui.agent_panel_failed", errorFields(err));
				setLoadError(t("Failed to load agent panel"));
			});
	}, []);

	if (loadError) {
		return (
			<div className="flex items-center justify-center h-full">
				<span className="text-xs text-kumo-error">{loadError}</span>
			</div>
		);
	}
	if (!AgentChat) {
		return (
			<div className="flex flex-col items-center justify-center h-full gap-2">
				<Loader size="base" />
				<span className="text-xs text-kumo-subtle">{t("Loading agent...")}</span>
			</div>
		);
	}
	return <AgentChat />;
}

export default function AgentSidebar() {
	const enabled = useFeatures();
	const [chosenTab, setActiveTab] = useState<"agent" | "mcp">("agent");
	// Only an enabled feature can be the active tab.
	const activeTab =
		chosenTab === "agent" && !enabled.agent
			? "mcp"
			: chosenTab === "mcp" && !enabled.mcp
				? "agent"
				: chosenTab;

	return (
		<div className="flex flex-col h-full">
			{/* Tab bar: Kumo's tabs, the underline kind, with the roles of a tab list; room above them
			    keeps the bar the height it had, with the underline on its line. */}
			<div className="shrink-0 border-b border-kumo-line px-2 pt-2">
				<Tabs
					variant="underline"
					value={activeTab}
					onValueChange={(next) => setActiveTab(next === "mcp" ? "mcp" : "agent")}
					tabs={[
						...(enabled.agent
							? [
									{
										value: "agent",
										label: (
											<span className="flex items-center gap-1.5">
												<RobotIcon size={14} weight={activeTab === "agent" ? "fill" : "regular"} />
												{t("Agent")}
											</span>
										),
									},
								]
							: []),
						...(enabled.mcp
							? [
									{
										value: "mcp",
										label: (
											<span className="flex items-center gap-1.5">
												<PlugsIcon size={14} weight={activeTab === "mcp" ? "fill" : "regular"} />
												MCP
											</span>
										),
									},
								]
							: []),
					]}
				/>
			</div>

			{/* Tab content — keep agent mounted so chat isn't lost */}
			<div className="flex-1 min-h-0 overflow-hidden">
				{enabled.agent && (
					<div className={activeTab === "agent" ? "h-full" : "hidden"}>
						<LazyAgentPanel />
					</div>
				)}
				{enabled.mcp && activeTab === "mcp" && <MCPPanel />}
			</div>
		</div>
	);
}
