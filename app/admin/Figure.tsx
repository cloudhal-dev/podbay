// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { LayerCard, Loader } from "@cloudflare/kumo";
import { Link } from "@tanstack/react-router";

/**
 * One figure of the Overview, on Kumo's layer card: what it counts, the number, a line under
 * it, and where the things it counts are listed.
 */
export default function Figure({
	label,
	value,
	detail,
	to,
	linkLabel,
}: {
	label: string;
	value: number | undefined;
	detail?: string;
	to: string;
	linkLabel: string;
}) {
	return (
		<LayerCard render={<section aria-label={label} />}>
			<LayerCard.Secondary className="flex items-center justify-between gap-3">
				<h2 className="m-0 text-sm font-medium text-kumo-strong">{label}</h2>
				<Link to={to} className="text-sm text-kumo-default underline">
					{linkLabel}
				</Link>
			</LayerCard.Secondary>
			<LayerCard.Primary>
				{value === undefined ? (
					<Loader />
				) : (
					<p className="m-0 text-3xl font-semibold text-kumo-default">{value}</p>
				)}
				{detail && <p className="m-0 mt-1 text-sm text-kumo-subtle">{detail}</p>}
			</LayerCard.Primary>
		</LayerCard>
	);
}
