// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { LayerCard } from "@cloudflare/kumo";
import type { ReactNode } from "react";

/**
 * A part of a page of the administration area, on Kumo's layer card: its title (and an action
 * beside it) on the card's upper layer, what it holds below.
 */
export default function Card({
	title,
	description,
	action,
	children,
}: {
	title: string;
	description?: string;
	action?: ReactNode;
	children?: ReactNode;
}) {
	return (
		<LayerCard>
			<LayerCard.Secondary className="flex items-center justify-between gap-3">
				<h2 className="m-0 text-base font-semibold text-kumo-default">{title}</h2>
				{action}
			</LayerCard.Secondary>
			<LayerCard.Primary>
				{description && <p className="m-0 mb-4 text-sm text-kumo-subtle">{description}</p>}
				{children}
			</LayerCard.Primary>
		</LayerCard>
	);
}
