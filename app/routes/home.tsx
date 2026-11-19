// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified by the Podbay contributors.

import { Button, Loader } from "@cloudflare/kumo";
import { EnvelopeIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link as RouterLink, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { t } from "~/i18n";
import { signOut, useMe } from "~/lib/session";
import { queryKeys } from "~/queries/keys";
import { useMailboxes } from "~/queries/mailboxes";
import api from "~/services/api";

export function meta() {
	return [{ title: "Podbay" }];
}

export default function HomeRoute() {
	const {
		data: mailboxes = [],
		refetch: refetchMailboxes,
		isFetched: mailboxesFetched,
	} = useMailboxes();

	const { data: configData } = useQuery({
		queryKey: queryKeys.config,
		queryFn: () => api.getConfig(),
		staleTime: Infinity, // config rarely changes
	});

	const domains = configData?.domains ?? [];
	const emailAddresses = configData?.emailAddresses ?? [];

	const { data: me } = useMe();
	const queryClient = useQueryClient();
	const navigate = useNavigate();

	// Auto-create mailboxes from config (run once when both data sources are ready)
	const autoCreateDone = useRef(false);
	useEffect(() => {
		if (autoCreateDone.current) return;
		if (emailAddresses.length === 0 || !mailboxesFetched) return;
		const existingEmails = new Set(mailboxes.map((m) => m.email.toLowerCase()));
		const toCreate = emailAddresses.filter((addr) => !existingEmails.has(addr.toLowerCase()));
		if (toCreate.length === 0) {
			autoCreateDone.current = true;
			return;
		}
		autoCreateDone.current = true;
		let cancelled = false;
		Promise.all(
			toCreate.map((addr) => {
				const localPart = addr.split("@")[0] || addr;
				return api.createMailbox(addr, localPart).catch(() => {});
			}),
		).then(() => {
			if (!cancelled) refetchMailboxes();
		});
		return () => {
			cancelled = true;
		};
	}, [emailAddresses, mailboxes, mailboxesFetched, refetchMailboxes]);

	const isConfigured = emailAddresses.length > 0;
	const accounts = isConfigured
		? emailAddresses.map((addr) => ({
				id: addr,
				email: addr,
				name: addr.split("@")[0] || addr,
			}))
		: mailboxes;

	const isLoading = !configData;
	// Creating a mailbox is for owners and administrators; the Worker enforces it.
	const canManage = me?.role === "owner" || me?.role === "admin";

	return (
		<div className="min-h-screen bg-kumo-recessed">
			<div className="mx-auto max-w-2xl px-4 py-8 md:px-6 md:py-16">
				<div className="mb-8">
					<div className="flex items-center justify-between">
						<h1 className="text-2xl font-bold text-kumo-default">{t("Mailboxes")}</h1>
					</div>
					{me && (
						<div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-kumo-subtle">
							<span>{t("Signed in as {email}.", { email: me.user.email })}</span>
							<RouterLink to="/account/security" className="underline">
								{t("Sign-in and security")}
							</RouterLink>
							{/* People and, next, the mailboxes of the instance are managed in an area of
							    their own (#127). */}
							{canManage && (
								<RouterLink to="/admin" className="underline">
									{t("Administration")}
								</RouterLink>
							)}
							<Button
								size="sm"
								onClick={async () => {
									await signOut();
									queryClient.clear();
									await navigate({ to: "/sign-in" });
								}}
							>
								{t("Sign out")}
							</Button>
						</div>
					)}
					{domains.length > 0 && (
						<p className="text-sm text-kumo-subtle mt-1">{domains.join(", ")}</p>
					)}
				</div>

				{isLoading ? (
					<div className="flex justify-center py-20">
						<Loader size="lg" />
					</div>
				) : accounts.length > 0 ? (
					<div className="rounded-xl border border-kumo-line bg-kumo-base overflow-hidden">
						{accounts.map((account, idx) => (
							<RouterLink
								key={account.id}
								to="/mailbox/$mailboxId"
								params={{ mailboxId: account.id }}
								className={`group flex items-center gap-4 px-5 py-4 no-underline transition-colors hover:bg-kumo-tint ${
									idx > 0 ? "border-t border-kumo-line" : ""
								}`}
							>
								<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-kumo-fill text-sm font-bold text-kumo-default">
									{account.name.charAt(0).toUpperCase()}
								</div>
								<div className="min-w-0 flex-1">
									<div className="text-sm font-medium text-kumo-default truncate">
										{account.name}
									</div>
									<div className="text-sm text-kumo-subtle">{account.email}</div>
								</div>
							</RouterLink>
						))}
					</div>
				) : (
					<div className="rounded-xl border border-kumo-line bg-kumo-base py-16 px-6">
						<div className="flex flex-col items-center text-center">
							<div className="mb-4">
								<EnvelopeIcon size={48} weight="thin" className="text-kumo-subtle" />
							</div>
							<h3 className="text-base font-semibold text-kumo-default mb-1.5">
								{t("No mailboxes yet")}
							</h3>
							<p className="text-sm text-kumo-subtle max-w-sm mb-5">
								{isConfigured
									? t(
											"Your email routing is configured but no mailboxes have been created yet. They will appear here automatically.",
										)
									: canManage
										? t("Create a mailbox to start sending and receiving emails with your domain.")
										: t("You are not a member of any mailbox yet. A mailbox owner can add you.")}
							</p>
							{/* Mailboxes are made in the administration area (#127). */}
							{!isConfigured && canManage && (
								<RouterLink to="/admin/mailboxes" className="text-sm text-kumo-default underline">
									{t("Mailboxes in Administration")}
								</RouterLink>
							)}
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
