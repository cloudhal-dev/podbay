// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { Button, Tooltip } from "@cloudflare/kumo";
import type { ReactNode } from "react";

/** A toolbar button that is only an icon: its label is its name and its tooltip. */
export default function IconButton({
	label,
	icon,
	onClick,
	disabled,
}: {
	label: string;
	icon: ReactNode;
	onClick: () => void;
	disabled?: boolean;
}) {
	return (
		<Tooltip content={label} side="bottom" asChild>
			<Button
				variant="ghost"
				shape="square"
				size="sm"
				icon={icon}
				onClick={onClick}
				disabled={disabled}
				aria-label={label}
			/>
		</Tooltip>
	);
}
