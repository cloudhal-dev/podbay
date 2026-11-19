// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { Breadcrumbs } from "@cloudflare/kumo";
import { Fragment, type ReactNode } from "react";
import { t } from "~/i18n";

/** One step of the way to a page: a link, or the page itself when it has no `to`. */
export interface Crumb {
	label: string;
	to?: string;
}

/**
 * The head of every page of the administration area (#127), so its order and spacing are
 * decided once: the way to the page (Kumo's breadcrumbs, from Administration), the page's title
 * and one line of what it is for, its actions, and its tabs when it has parts.
 */
export default function PageHead({
	crumbs,
	title,
	description,
	actions,
	tabs,
}: {
	crumbs: readonly Crumb[];
	title: string;
	description?: string;
	actions?: ReactNode;
	tabs?: ReactNode;
}) {
	const way: Crumb[] = [{ label: t("Administration"), to: "/admin" }, ...crumbs];
	return (
		<div className="mb-6 flex flex-col gap-3">
			<Breadcrumbs size="sm">
				{way.map((crumb, index) => (
					<Fragment key={crumb.to ?? crumb.label}>
						{index > 0 && <Breadcrumbs.Separator />}
						{crumb.to ? (
							<Breadcrumbs.Link href={crumb.to}>{crumb.label}</Breadcrumbs.Link>
						) : (
							<Breadcrumbs.Current>{crumb.label}</Breadcrumbs.Current>
						)}
					</Fragment>
				))}
			</Breadcrumbs>
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0">
					<h1 className="m-0 break-words text-2xl font-semibold text-kumo-default">{title}</h1>
					{description && <p className="m-0 mt-1 text-sm text-kumo-subtle">{description}</p>}
				</div>
				{actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
			</div>
			{tabs}
		</div>
	);
}
