// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified by the Podbay contributors.

import {
	Button,
	Input,
	LayerDialog,
	Loader,
	Select,
	Text,
	useKumoToastManager,
} from "@cloudflare/kumo";
import { EnvelopeIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link as RouterLink, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Folders } from "shared/folders";
import { useFreshProof } from "~/components/FreshProof";
import InvitePerson from "~/components/InvitePerson";
import People from "~/components/People";
import Registry from "~/components/Registry";
import { plural, t } from "~/i18n";
import { rich } from "~/i18n/rich";
import { signOut, useMe } from "~/lib/session";
import { useFolders } from "~/queries/folders";
import { queryKeys } from "~/queries/keys";
import { useCreateMailbox, useDeleteMailbox, useMailboxes } from "~/queries/mailboxes";
import api from "~/services/api";

export function meta() {
	return [{ title: "Podbay" }];
}

export default function HomeRoute() {
	const toastManager = useKumoToastManager();
	const {
		data: mailboxes = [],
		refetch: refetchMailboxes,
		isFetched: mailboxesFetched,
	} = useMailboxes();
	const createMailbox = useCreateMailbox();
	const deleteMailbox = useDeleteMailbox();
	const withFreshProof = useFreshProof();

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
	const [isCreateOpen, setIsCreateOpen] = useState(false);
	const [newPrefix, setNewPrefix] = useState("");
	const [selectedDomain, setSelectedDomain] = useState("");
	const [newName, setNewName] = useState("");
	const [isCreating, setIsCreating] = useState(false);
	const [createError, setCreateError] = useState<string | null>(null);
	const [isDeleteOpen, setIsDeleteOpen] = useState(false);
	const [mailboxToDelete, setMailboxToDelete] = useState<{
		id: string;
		email: string;
	} | null>(null);
	const [isDeleting, setIsDeleting] = useState(false);

	// Set default domain when config loads
	useEffect(() => {
		if (domains.length > 0 && !selectedDomain) {
			setSelectedDomain(domains[0]);
		}
	}, [domains, selectedDomain]);

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

	const handleCreate = async (e: FormEvent) => {
		e.preventDefault();
		setCreateError(null);
		if (!newPrefix || !selectedDomain) {
			setCreateError(t("Please fill in all fields"));
			return;
		}
		const email = `${newPrefix}@${selectedDomain}`;
		const name = newName || newPrefix;
		setIsCreating(true);
		try {
			await createMailbox.mutateAsync({ email, name });
			toastManager.add({ title: t("Mailbox created successfully!") });
			setIsCreateOpen(false);
			setNewPrefix("");
			setNewName("");
		} catch (err: unknown) {
			const message = (err instanceof Error ? err.message : null) || t("Failed to create mailbox");
			setCreateError(message);
		} finally {
			setIsCreating(false);
		}
	};

	// How many messages wait to leave the mailbox that is about to be deleted.
	const { data: placesOfDoomed = [] } = useFolders(isDeleteOpen ? mailboxToDelete?.id : undefined);
	const waitingToLeave =
		placesOfDoomed.find((place) => place.id === Folders.SCHEDULED)?.waiting ?? 0;

	const handleDelete = async () => {
		if (!mailboxToDelete) return;
		setIsDeleting(true);
		try {
			const id = mailboxToDelete.id;
			await withFreshProof(() => deleteMailbox.mutateAsync(id));
			toastManager.add({ title: t("Mailbox deleted") });
			setIsDeleteOpen(false);
			setMailboxToDelete(null);
		} catch {
			toastManager.add({ title: t("Failed to delete mailbox"), variant: "error" });
		} finally {
			setIsDeleting(false);
		}
	};

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
						{!isConfigured && canManage && (
							<Button
								variant="primary"
								icon={<PlusIcon size={16} />}
								onClick={() => setIsCreateOpen(true)}
							>
								{t("New Mailbox")}
							</Button>
						)}
					</div>
					{me && (
						<div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-kumo-subtle">
							<span>{t("Signed in as {email}.", { email: me.user.email })}</span>
							<RouterLink to="/account/security" className="underline">
								{t("Sign-in and security")}
							</RouterLink>
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
								{!isConfigured && (
									<Button
										variant="ghost"
										size="sm"
										shape="square"
										icon={<TrashIcon size={16} />}
										aria-label={t("Delete mailbox {name}", { name: account.email })}
										onClick={(e) => {
											e.preventDefault();
											e.stopPropagation();
											setMailboxToDelete({
												id: account.id,
												email: account.email,
											});
											setIsDeleteOpen(true);
										}}
									/>
								)}
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
							{!isConfigured && canManage && (
								<Button
									variant="primary"
									icon={<PlusIcon size={16} />}
									onClick={() => setIsCreateOpen(true)}
								>
									{t("Create Mailbox")}
								</Button>
							)}
						</div>
					</div>
				)}
			</div>

			{canManage && (
				<div className="mx-auto max-w-2xl px-4 pb-16 md:px-6">
					<Registry />
					{me && <People me={me} />}
					<InvitePerson canInviteAdmin={me?.role === "owner"} />
				</div>
			)}

			<LayerDialog.Root open={isCreateOpen} onOpenChange={setIsCreateOpen}>
				<LayerDialog.Content size="sm">
					<LayerDialog.Title>{t("Create a mailbox")}</LayerDialog.Title>
					<LayerDialog.Body>
						<form id="create-mailbox" onSubmit={handleCreate} className="space-y-4">
							{createError && (
								<Text variant="error" size="sm">
									{createError}
								</Text>
							)}
							<div>
								<span className="text-sm font-medium text-kumo-default mb-1.5 block">
									{t("Email Address")}
								</span>
								<div className="flex items-center gap-2">
									<div className="flex-1">
										<Input
											aria-label={t("Address prefix")}
											placeholder={t("info")}
											size="sm"
											value={newPrefix}
											onChange={(e) => setNewPrefix(e.target.value)}
											required
										/>
									</div>
									<span className="text-sm text-kumo-subtle">@</span>
									{domains.length > 1 ? (
										<div className="flex-1">
											<Select
												aria-label={t("Domain")}
												value={selectedDomain}
												onValueChange={(value) => {
													if (value) setSelectedDomain(value);
												}}
											>
												{domains.map((d) => (
													<Select.Option key={d} value={d}>
														{d}
													</Select.Option>
												))}
											</Select>
										</div>
									) : (
										<span className="text-sm text-kumo-subtle">
											{selectedDomain || t("no domain")}
										</span>
									)}
								</div>
							</div>
							<Input
								label={t("Display Name (optional)")}
								placeholder={t("Info")}
								size="sm"
								value={newName}
								onChange={(e) => setNewName(e.target.value)}
							/>
						</form>
					</LayerDialog.Body>
					<LayerDialog.Actions dismissLabel={t("Cancel")}>
						<LayerDialog.Action
							type="submit"
							form="create-mailbox"
							loading={isCreating}
							disabled={!selectedDomain}
						>
							{t("Create")}
						</LayerDialog.Action>
					</LayerDialog.Actions>
				</LayerDialog.Content>
			</LayerDialog.Root>

			<LayerDialog.Alert
				open={isDeleteOpen}
				onOpenChange={(open) => {
					setIsDeleteOpen(open);
					if (!open) setMailboxToDelete(null);
				}}
			>
				<LayerDialog.Content size="sm">
					<LayerDialog.Title>{t("Delete this mailbox?")}</LayerDialog.Title>
					<LayerDialog.Body>
						<p className="text-sm text-kumo-strong">
							{rich("{mailbox} and every message in it will be deleted. This cannot be undone.", {
								mailbox: <strong className="text-kumo-default">{mailboxToDelete?.email}</strong>,
							})}
						</p>
						{/* A deleted mailbox sends nothing: what waits in it is said first (ADR-0016). */}
						{waitingToLeave > 0 && (
							<p className="mt-2 text-sm text-kumo-strong">
								{plural(
									waitingToLeave,
									"{count} message is waiting to be sent from it. It will not be sent.",
									"{count} messages are waiting to be sent from it. They will not be sent.",
								)}
							</p>
						)}
					</LayerDialog.Body>
					<LayerDialog.Actions dismissLabel={t("Cancel")}>
						<LayerDialog.Action variant="destructive" loading={isDeleting} onClick={handleDelete}>
							{t("Delete")}
						</LayerDialog.Action>
					</LayerDialog.Actions>
				</LayerDialog.Content>
			</LayerDialog.Alert>
		</div>
	);
}
