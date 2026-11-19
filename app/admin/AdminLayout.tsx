// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { ArrowLeftIcon, type Icon, UsersIcon } from "@phosphor-icons/react";
import { Link, Outlet } from "@tanstack/react-router";
import { m, t } from "~/i18n";
import { useMe } from "~/lib/session";
import NotFoundRoute from "~/routes/not-found";

/**
 * The parts of the administration area, in the order of its rail. A part that is built joins
 * here, with its route in `./routes.ts`: one line each (#127).
 */
export const ADMIN_PARTS: readonly { to: string; label: string; icon: Icon }[] = [
	{ to: "/admin/people", label: m("People"), icon: UsersIcon },
];

/** Whether a person may manage the instance. The Worker decides again on every request. */
export const managesInstance = (role: string | undefined) => role === "owner" || role === "admin";

/**
 * The administration area (#127): where the instance is managed, apart from where mail is read.
 * Its rail names its parts and the way back to mail is always there. A person who may not
 * manage the instance sees no way in, and its addresses answer as not found.
 */
export default function AdminLayout() {
	const { data: me, isPending } = useMe();
	if (isPending) return null;
	if (!managesInstance(me?.role)) return <NotFoundRoute />;
	return (
		<div className="min-h-screen bg-kumo-recessed">
			<header className="flex h-16 items-center gap-4 border-b border-kumo-line bg-kumo-base px-4 md:px-6">
				<Link
					to="/"
					className="flex items-center gap-1.5 text-sm text-kumo-strong no-underline hover:text-kumo-default"
				>
					<ArrowLeftIcon size={16} aria-hidden />
					{t("Back to mail")}
				</Link>
				<h1 className="m-0 text-base font-semibold text-kumo-default">{t("Administration")}</h1>
			</header>
			<div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 md:flex-row md:px-6 md:py-8">
				<nav aria-label={t("Administration")} className="md:w-52 md:shrink-0">
					<ul className="m-0 flex list-none gap-1 overflow-x-auto p-0 md:flex-col">
						{ADMIN_PARTS.map((part) => (
							<li key={part.to}>
								<Link
									to={part.to}
									className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-kumo-strong no-underline hover:bg-kumo-tint"
									activeProps={{
										className: "bg-kumo-fill font-medium text-kumo-default",
										"aria-current": "page",
									}}
								>
									<part.icon size={18} aria-hidden />
									{t(part.label)}
								</Link>
							</li>
						))}
					</ul>
				</nav>
				<main className="min-w-0 flex-1">
					<Outlet />
				</main>
			</div>
		</div>
	);
}
