// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified by the Podbay contributors.

import type { ReactNode } from "react";

interface EmailPanelHeaderProps {
	subject: string;
	/** The chips of the labels the conversation carries, beside the subject. */
	labels?: ReactNode;
	messageCount: number;
	showThreadCount: boolean;
}

export default function EmailPanelHeader({
	subject,
	labels,
	messageCount,
	showThreadCount,
}: EmailPanelHeaderProps) {
	return (
		<div className="shrink-0 px-4 pt-4 pb-2 md:px-6">
			<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
				<h2 className="text-[22px] leading-7 font-normal text-kumo-default">
					{subject || "(no subject)"}
				</h2>
				{labels}
			</div>
			{showThreadCount && (
				<span className="text-xs text-kumo-subtle mt-0.5 block">
					{messageCount} messages in this conversation
				</span>
			)}
		</div>
	);
}
