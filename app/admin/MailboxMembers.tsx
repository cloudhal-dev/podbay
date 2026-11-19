// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { Badge, Button, Input, Select } from "@cloudflare/kumo";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { useFreshProof } from "~/components/FreshProof";
import { dateLanguage, m, t } from "~/i18n";
import { sessionKeys, useMe } from "~/lib/session";
import { queryKeys } from "~/queries/keys";
import api, { ApiError } from "~/services/api";
import type { MailboxRole, Member, MemberChange } from "~/types";

const ROLES: { value: MailboxRole; label: string; means: string }[] = [
	{ value: "reader", label: m("Reader"), means: m("reads the mail") },
	{ value: "sender", label: m("Sender"), means: m("reads the mail and sends as the mailbox") },
	{
		value: "owner",
		label: m("Owner"),
		means: m("reads, sends, and manages settings and members"),
	},
];
const ROLE_LABEL = { owner: m("Owner"), sender: m("Sender"), reader: m("Reader") } as const;
const day = (value: string) =>
	new Date(value).toLocaleString(dateLanguage(), { dateStyle: "medium", timeStyle: "short" });
const toRole = (value: string): MailboxRole =>
	value === "owner" || value === "sender" ? value : "reader";

function RoleSelect({
	label,
	shown = false,
	value,
	disabled,
	onChange,
}: {
	label: string;
	/** The label stands above the select; otherwise it names the select for assistive technology. */
	shown?: boolean;
	value: MailboxRole;
	disabled?: boolean;
	onChange: (role: MailboxRole) => void;
}) {
	return (
		<Select
			{...(shown ? { label } : { "aria-label": label })}
			size="sm"
			value={value}
			disabled={disabled}
			onValueChange={(next) => onChange(toRole(String(next)))}
			items={ROLES.map((role) => ({ label: t(role.label), value: role.value }))}
		/>
	);
}

const MADE: Record<MailboxRole | "member", string> = {
	owner: m("{by} made {person} an owner"),
	sender: m("{by} made {person} a sender"),
	reader: m("{by} made {person} a reader"),
	member: m("{by} made {person} a member"),
};
const MADE_THEMSELVES: Record<MailboxRole | "member", string> = {
	owner: m("{by} made themselves an owner"),
	sender: m("{by} made themselves a sender"),
	reader: m("{by} made themselves a reader"),
	member: m("{by} made themselves a member"),
};

/** One line of the record: who changed whose membership, and in which capacity. */
function changeText(change: MemberChange): string {
	const by = change.by ?? t("A person whose account is gone");
	const person = change.person ?? t("a person whose account is gone");
	if (change.change === "removed") {
		return change.self
			? t("{by} left the mailbox", { by })
			: t("{by} removed {person}", { by, person });
	}
	// Each is a whole sentence, so a language can order it its own way.
	const made = change.self ? MADE_THEMSELVES : MADE;
	return t(made[change.role ?? "member"], { by, person });
}

/**
 * Who may read and send as a mailbox. A mailbox's owners manage this; so do the owners and
 * administrators of the instance, who cannot read the mail unless they add themselves, which
 * the record below then shows to the mailbox's owners.
 */
export default function MailboxMembers({ mailboxId }: { mailboxId: string }) {
	const queryClient = useQueryClient();
	const withFreshProof = useFreshProof();
	const { data: me } = useMe();
	const myRole = me?.mailboxes.find((m) => m.address === mailboxId)?.role ?? null;
	const manager = me?.role === "owner" || me?.role === "admin";
	const canManage = manager || myRole === "owner";

	const members = useQuery({
		queryKey: queryKeys.members.list(mailboxId),
		queryFn: () => api.listMembers(mailboxId),
		retry: false,
	});
	const history = useQuery({
		queryKey: queryKeys.members.history(mailboxId),
		queryFn: () => api.memberHistory(mailboxId),
		enabled: canManage,
		retry: false,
	});
	const [email, setEmail] = useState("");
	const [role, setRole] = useState<MailboxRole>("reader");
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	async function change(what: string, fallback: string, action: () => Promise<unknown>) {
		setBusy(what);
		setError(null);
		try {
			await withFreshProof(action);
		} catch (caught) {
			setError(caught instanceof ApiError ? caught.message : fallback);
		} finally {
			setBusy(null);
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: queryKeys.members.list(mailboxId) }),
				queryClient.invalidateQueries({ queryKey: queryKeys.registry }),
				// Adding or removing yourself changes which mailboxes you can open.
				queryClient.invalidateQueries({ queryKey: sessionKeys.me }),
				queryClient.invalidateQueries({ queryKey: queryKeys.mailboxes.all }),
			]);
		}
	}

	function add(event: FormEvent) {
		event.preventDefault();
		void change("add", t("The person could not be added."), async () => {
			await api.addMember(mailboxId, email.trim(), role);
			setEmail("");
		});
	}

	const list: Member[] = members.data ?? [];

	return (
		<div className="space-y-5">
			{members.isError ? (
				<p role="alert" className="text-sm text-kumo-danger">
					{t("This mailbox does not exist, or you may not see its members.")}
				</p>
			) : (
				<>
					{manager && myRole === null && (
						<p className="rounded-md bg-kumo-tint px-3 py-2 text-sm text-kumo-strong">
							{t(
								"You are not a member of this mailbox, so you cannot read its mail. You manage who is. If you add yourself, that is recorded and its owners see it below.",
							)}
						</p>
					)}

					<section className="rounded-xl border border-kumo-line bg-kumo-base p-5">
						<h2 className="text-base font-semibold text-kumo-default">{t("Who has access")}</h2>
						<ul className="mt-3 rounded-lg border border-kumo-line divide-y divide-kumo-line">
							{list.map((member) => (
								<li
									key={member.userId}
									className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2"
								>
									<div className="min-w-0 flex-1">
										<p className="truncate text-sm text-kumo-default">
											{member.name}
											{member.userId === me?.user.id ? t(" (you)") : ""}
										</p>
										<p className="truncate text-xs text-kumo-subtle">
											{member.email}
											{" · "}
											{!member.addedBy
												? t("added {date}", { date: day(member.addedAt) })
												: member.addedBy === member.email
													? t("added {date} by themselves", { date: day(member.addedAt) })
													: t("added {date} by {who}", {
															date: day(member.addedAt),
															who: member.addedBy,
														})}
										</p>
									</div>
									{canManage ? (
										<>
											<RoleSelect
												label={t("Role of {name}", { name: member.email })}
												value={member.role}
												disabled={busy !== null}
												onChange={(next) =>
													change(member.userId, t("The role could not be changed."), () =>
														api.setMemberRole(mailboxId, member.userId, next),
													)
												}
											/>
											<Button
												variant="ghost"
												size="sm"
												loading={busy === `remove-${member.userId}`}
												onClick={() =>
													change(
														`remove-${member.userId}`,
														t("The member could not be removed."),
														() => api.removeMember(mailboxId, member.userId),
													)
												}
											>
												{t("Remove")}
											</Button>
										</>
									) : (
										<Badge variant="outline">{t(ROLE_LABEL[member.role])}</Badge>
									)}
								</li>
							))}
						</ul>
						<ul className="mt-3 text-xs text-kumo-subtle space-y-0.5">
							{ROLES.map((r) => (
								<li key={r.value}>
									<span className="text-kumo-default">{t(r.label)}</span>: {t(r.means)}
								</li>
							))}
						</ul>
						{error && (
							<p role="alert" className="text-sm text-kumo-danger mt-3">
								{error}
							</p>
						)}
					</section>

					{canManage && (
						<section className="rounded-xl border border-kumo-line bg-kumo-base p-5">
							<h2 className="text-base font-semibold text-kumo-default">{t("Add a person")}</h2>
							<p className="text-sm text-kumo-subtle mt-1">
								{t(
									"They need an account on this instance first; an owner or administrator invites them.",
								)}
							</p>
							<form onSubmit={add} className="mt-4 flex flex-wrap items-end gap-2">
								<div className="flex-1 min-w-48">
									<Input
										label={t("Their email")}
										className="w-full"
										id="member-email"
										type="email"
										size="sm"
										value={email}
										onChange={(e) => setEmail(e.target.value)}
										required
									/>
								</div>
								<div>
									<RoleSelect label={t("Role")} shown value={role} onChange={setRole} />
								</div>
								<Button type="submit" variant="secondary" size="sm" loading={busy === "add"}>
									{t("Add")}
								</Button>
							</form>
						</section>
					)}

					{canManage && (
						<section className="rounded-xl border border-kumo-line bg-kumo-base p-5">
							<h2 className="text-base font-semibold text-kumo-default">
								{t("Record of changes")}
							</h2>
							<p className="text-sm text-kumo-subtle mt-1">
								{t("Every change to who has access, newest first. It cannot be edited.")}
							</p>
							{(history.data ?? []).length === 0 ? (
								<p className="text-sm text-kumo-subtle mt-3">{t("Nothing has changed yet.")}</p>
							) : (
								<ul className="mt-3 rounded-lg border border-kumo-line divide-y divide-kumo-line">
									{(history.data ?? []).map((entry) => (
										<li
											key={`${entry.at}-${entry.change}-${entry.person}`}
											className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2"
										>
											<span className="min-w-0 flex-1 text-sm text-kumo-default break-words">
												{changeText(entry)}
											</span>
											{entry.asManager && (
												<Badge variant="secondary">{t("As instance manager")}</Badge>
											)}
											<span className="text-xs text-kumo-subtle">{day(entry.at)}</span>
										</li>
									))}
								</ul>
							)}
						</section>
					)}
				</>
			)}
		</div>
	);
}
