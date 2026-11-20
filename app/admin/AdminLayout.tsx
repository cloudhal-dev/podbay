// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { Button, Sidebar, Tooltip } from "@cloudflare/kumo";
import {
	ArrowLeftIcon,
	EnvelopeSimpleIcon,
	type Icon,
	ShieldCheckIcon,
	SquaresFourIcon,
	UsersIcon,
} from "@phosphor-icons/react";
import { Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { m, t } from "~/i18n";
import { useMe } from "~/lib/session";
import NotFoundRoute from "~/routes/not-found";

interface AdminPart {
	to: string;
	label: string;
	icon: Icon;
}

/**
 * The rail of the administration area, in groups (#127). A part that is built joins its group
 * here, with its route in `./routes.ts`: one line each. The groups leave room for the parts to
 * come (an overview with figures, domains, activity).
 */
export const ADMIN_GROUPS: readonly { label?: string; parts: readonly AdminPart[] }[] = [
	{ parts: [{ to: "/admin", label: m("Overview"), icon: SquaresFourIcon }] },
	{
		label: m("Directory"),
		parts: [
			{ to: "/admin/people", label: m("People"), icon: UsersIcon },
			{ to: "/admin/mailboxes", label: m("Mailboxes"), icon: EnvelopeSimpleIcon },
		],
	},
];

/** Whether a person may manage the instance. The Worker decides again on every request. */
export const managesInstance = (role: string | undefined) => role === "owner" || role === "admin";

/**
 * The administration area (#127): where the instance is managed, apart from where mail is read.
 * It is Kumo's panel: its sidebar names the parts in groups and has the way back to mail, and on
 * a phone it is a sheet opened from the bar. A person who may not manage the instance sees no
 * way in, and its addresses answer as not found.
 */
export default function AdminLayout() {
	const { data: me, isPending } = useMe();
	const navigate = useNavigate();
	const { pathname } = useLocation();
	if (isPending) return null;
	if (!managesInstance(me?.role)) return <NotFoundRoute />;
	return (
		<Sidebar.Provider defaultOpen className="h-dvh bg-kumo-recessed">
			<Sidebar>
				<Sidebar.Header>
					<p className="m-0 px-2 text-base font-semibold text-kumo-default">
						{t("Administration")}
					</p>
				</Sidebar.Header>
				<Sidebar.Content>
					<nav aria-label={t("Administration")}>
						{ADMIN_GROUPS.map((group) => (
							<Sidebar.Group key={group.parts[0]?.to}>
								{group.label && <Sidebar.GroupLabel>{t(group.label)}</Sidebar.GroupLabel>}
								<Sidebar.Menu>
									{group.parts.map((part) => {
										// The Overview is the area's own address; a part is active on its pages too.
										const active =
											part.to === "/admin"
												? pathname === "/admin" || pathname === "/admin/"
												: pathname === part.to || pathname.startsWith(`${part.to}/`);
										return (
											<Sidebar.MenuButton
												key={part.to}
												icon={part.icon}
												href={part.to}
												active={active}
												aria-current={active ? "page" : undefined}
											>
												{t(part.label)}
											</Sidebar.MenuButton>
										);
									})}
								</Sidebar.Menu>
							</Sidebar.Group>
						))}
					</nav>
				</Sidebar.Content>
				<Sidebar.Footer>
					<Sidebar.Menu>
						<Sidebar.MenuButton icon={ArrowLeftIcon} href="/">
							{t("Back to mail")}
						</Sidebar.MenuButton>
					</Sidebar.Menu>
				</Sidebar.Footer>
			</Sidebar>
			<div className="flex min-h-0 min-w-0 flex-1 flex-col">
				<header className="flex h-14 shrink-0 items-center gap-2 border-b border-kumo-line bg-kumo-base px-4">
					<Sidebar.Trigger />
					<span className="flex-1" />
					{/* The person's own account, as the mail screens' bar has it. */}
					<Tooltip content={t("Sign-in and security")} side="bottom" asChild>
						<Button
							variant="ghost"
							shape="square"
							icon={<ShieldCheckIcon size={20} />}
							onClick={() => void navigate({ to: "/account/security" })}
							aria-label={t("Sign-in and security")}
						/>
					</Tooltip>
				</header>
				<main className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 md:p-8">
					<div className="mx-auto max-w-5xl">
						<Outlet />
					</div>
				</main>
			</div>
		</Sidebar.Provider>
	);
}
