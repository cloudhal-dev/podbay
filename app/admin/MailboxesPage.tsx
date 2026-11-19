// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import {
	Badge,
	Button,
	Input,
	LayerDialog,
	Loader,
	Select,
	Table,
	Text,
	useKumoToastManager,
} from "@cloudflare/kumo";
import { PlusIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type FormEvent, useEffect, useState } from "react";
import { plural, t } from "~/i18n";
import { queryKeys } from "~/queries/keys";
import { useCreateMailbox } from "~/queries/mailboxes";
import api from "~/services/api";
import { useAdminTitle } from "./useAdminTitle";

/**
 * Every mailbox of the instance (#127): its address and name, how many members it has and who
 * owns it, and whether you are a member. Each has a page of its own. Managing is not reading:
 * this lists no mail, and a mailbox you are not a member of stays closed to you.
 */
export default function MailboxesPage() {
	useAdminTitle(t("Mailboxes"));
	const {
		data: mailboxes = [],
		isPending,
		isError,
	} = useQuery({
		queryKey: queryKeys.registry,
		queryFn: api.listRegistry,
	});
	const { data: config } = useQuery({
		queryKey: queryKeys.config,
		queryFn: () => api.getConfig(),
		staleTime: Number.POSITIVE_INFINITY,
	});
	// An instance whose addresses are set in its configuration makes its mailboxes by itself.
	const configured = (config?.emailAddresses ?? []).length > 0;
	const [creating, setCreating] = useState(false);

	return (
		<section className="rounded-xl border border-kumo-line bg-kumo-base p-5">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0">
					<h2 className="text-base font-semibold text-kumo-default">{t("Mailboxes")}</h2>
					<p className="mt-1 text-sm text-kumo-subtle">
						{t(
							"You manage who the members of every mailbox are. You read only the mailboxes you are a member of.",
						)}
					</p>
				</div>
				{!configured && (
					<Button variant="primary" icon={<PlusIcon size={16} />} onClick={() => setCreating(true)}>
						{t("New Mailbox")}
					</Button>
				)}
			</div>
			{isPending ? (
				<div className="flex justify-center py-6">
					<Loader />
				</div>
			) : isError ? (
				<p role="alert" className="mt-3 text-sm text-kumo-danger">
					{t("The mailboxes could not be loaded.")}
				</p>
			) : mailboxes.length === 0 ? (
				<p className="mt-3 text-sm text-kumo-subtle">{t("There are no mailboxes yet.")}</p>
			) : (
				<div className="mt-4 overflow-hidden rounded-lg border border-kumo-line">
					<Table aria-label={t("Mailboxes")}>
						<Table.Header>
							<Table.Row>
								<Table.Head>{t("Mailbox")}</Table.Head>
								{/* On a narrow screen who owns it is under the address, not in a column. */}
								<Table.Head className="hidden md:table-cell">{t("Owners")}</Table.Head>
								<Table.Head className="hidden sm:table-cell">{t("You")}</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{mailboxes.map((mailbox) => {
								const owners = mailbox.owners.join(", ") || t("nobody");
								const yours = (
									<Badge variant={mailbox.role === null ? "outline" : "secondary"}>
										{mailbox.role === null ? t("Not a member") : t("You are a member")}
									</Badge>
								);
								return (
									<Table.Row key={mailbox.address}>
										<Table.Cell className="max-w-0">
											<Link
												to="/admin/mailboxes/$mailboxId"
												params={{ mailboxId: mailbox.address }}
												className="block truncate text-sm text-kumo-default underline"
											>
												{mailbox.address}
											</Link>
											<p className="truncate text-xs text-kumo-subtle">
												{mailbox.name} ·{" "}
												{plural(mailbox.members, "{count} member", "{count} members")}
											</p>
											<p className="truncate text-xs text-kumo-subtle md:hidden">
												{t("owned by {owners}", { owners })}
											</p>
											<div className="mt-1 sm:hidden">{yours}</div>
										</Table.Cell>
										<Table.Cell className="hidden max-w-0 md:table-cell">
											<p className="truncate text-sm text-kumo-strong">{owners}</p>
										</Table.Cell>
										<Table.Cell className="hidden sm:table-cell">{yours}</Table.Cell>
									</Table.Row>
								);
							})}
						</Table.Body>
					</Table>
				</div>
			)}
			<CreateMailbox open={creating} onOpenChange={setCreating} domains={config?.domains ?? []} />
		</section>
	);
}

/** Making a mailbox: an address on one of the instance's domains, and a name. */
function CreateMailbox({
	open,
	onOpenChange,
	domains,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	domains: string[];
}) {
	const toasts = useKumoToastManager();
	const createMailbox = useCreateMailbox();
	const [prefix, setPrefix] = useState("");
	const [domain, setDomain] = useState("");
	const [name, setName] = useState("");
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (domains.length > 0 && !domain) setDomain(domains[0] ?? "");
	}, [domains, domain]);

	async function create(event: FormEvent) {
		event.preventDefault();
		setError(null);
		if (!prefix || !domain) {
			setError(t("Please fill in all fields"));
			return;
		}
		try {
			await createMailbox.mutateAsync({ email: `${prefix}@${domain}`, name: name || prefix });
			toasts.add({ title: t("Mailbox created successfully!") });
			onOpenChange(false);
			setPrefix("");
			setName("");
		} catch (caught) {
			setError((caught instanceof Error ? caught.message : null) || t("Failed to create mailbox"));
		}
	}

	return (
		<LayerDialog.Root open={open} onOpenChange={onOpenChange}>
			<LayerDialog.Content size="sm">
				<LayerDialog.Title>{t("Create a mailbox")}</LayerDialog.Title>
				<LayerDialog.Body>
					<form id="create-mailbox" onSubmit={create} className="space-y-4">
						{error && (
							<Text variant="error" size="sm">
								{error}
							</Text>
						)}
						<div>
							<span className="mb-1.5 block text-sm font-medium text-kumo-default">
								{t("Email Address")}
							</span>
							<div className="flex items-center gap-2">
								<div className="flex-1">
									<Input
										aria-label={t("Address prefix")}
										placeholder={t("info")}
										size="sm"
										value={prefix}
										onChange={(event) => setPrefix(event.target.value)}
										required
									/>
								</div>
								<span className="text-sm text-kumo-subtle">@</span>
								{domains.length > 1 ? (
									<div className="flex-1">
										<Select
											aria-label={t("Domain")}
											value={domain}
											onValueChange={(value) => {
												if (value) setDomain(value);
											}}
										>
											{domains.map((one) => (
												<Select.Option key={one} value={one}>
													{one}
												</Select.Option>
											))}
										</Select>
									</div>
								) : (
									<span className="text-sm text-kumo-subtle">{domain || t("no domain")}</span>
								)}
							</div>
						</div>
						<Input
							label={t("Display Name (optional)")}
							placeholder={t("Info")}
							size="sm"
							value={name}
							onChange={(event) => setName(event.target.value)}
						/>
					</form>
				</LayerDialog.Body>
				<LayerDialog.Actions dismissLabel={t("Cancel")}>
					<LayerDialog.Action
						type="submit"
						form="create-mailbox"
						loading={createMailbox.isPending}
						disabled={!domain}
					>
						{t("Create")}
					</LayerDialog.Action>
				</LayerDialog.Actions>
			</LayerDialog.Content>
		</LayerDialog.Root>
	);
}
