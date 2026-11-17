// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { Button, Input } from "@cloudflare/kumo";
import { type FormEvent, useState } from "react";
import { t } from "~/i18n";
import { type CreatedInvitation, invite } from "~/lib/session";
import { ApiError } from "~/services/api";
import { useFreshProof } from "./FreshProof";

/**
 * Invite a person. The result is a link to pass on by any channel: Podbay does not have to be
 * able to send mail for this. The link is shown once and is not stored.
 */
export default function InvitePerson({ canInviteAdmin }: { canInviteAdmin: boolean }) {
	const [email, setEmail] = useState("");
	const [role, setRole] = useState<"member" | "admin">("member");
	const [created, setCreated] = useState<CreatedInvitation | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const withFreshProof = useFreshProof();

	async function submit(event: FormEvent) {
		event.preventDefault();
		setBusy(true);
		setError(null);
		setCreated(null);
		try {
			setCreated(await withFreshProof(() => invite(email.trim(), role)));
			setEmail("");
		} catch (caught) {
			setError(
				caught instanceof ApiError ? caught.message : t("The invitation could not be created."),
			);
		} finally {
			setBusy(false);
		}
	}

	return (
		<section className="mt-8 rounded-xl border border-kumo-line bg-kumo-base p-5">
			<h2 className="text-base font-semibold text-kumo-default">{t("Invite a person")}</h2>
			<p className="text-sm text-kumo-subtle mt-1">
				{t(
					"They get an account on this instance. They see no mailbox until a mailbox owner adds them.",
				)}
			</p>
			<form onSubmit={submit} className="mt-4 flex flex-wrap items-end gap-2">
				<div className="flex-1 min-w-48">
					<Input
						label={t("Email")}
						className="w-full"
						id="invite-email"
						type="email"
						size="sm"
						value={email}
						onChange={(e) => setEmail(e.target.value)}
						required
					/>
				</div>
				{canInviteAdmin && (
					<div>
						<label
							htmlFor="invite-role"
							className="text-sm font-medium text-kumo-default mb-1.5 block"
						>
							{t("Role")}
						</label>
						<select
							id="invite-role"
							value={role}
							onChange={(e) => setRole(e.target.value === "admin" ? "admin" : "member")}
							className="h-8 rounded-md border border-kumo-line bg-kumo-base px-2 text-sm text-kumo-default"
						>
							<option value="member">{t("Member")}</option>
							<option value="admin">{t("Administrator")}</option>
						</select>
					</div>
				)}
				<Button type="submit" variant="secondary" size="sm" loading={busy}>
					{t("Create invitation")}
				</Button>
			</form>
			{error && (
				<p role="alert" className="text-sm text-kumo-danger mt-3">
					{error}
				</p>
			)}
			{created && (
				<div className="mt-4 rounded-md bg-kumo-tint px-3 py-2">
					<p className="text-sm text-kumo-strong">
						{t("Send this link to {email}. It works once and is shown only now.", {
							email: created.email,
						})}
					</p>
					<code className="mt-1 block break-all text-xs text-kumo-default">{created.link}</code>
				</div>
			)}
		</section>
	);
}
