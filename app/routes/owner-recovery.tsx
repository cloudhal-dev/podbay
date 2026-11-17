// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { Button, Input } from "@cloudflare/kumo";
import { Link } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import CopyButton from "~/components/CopyButton";
import { t } from "~/i18n";
import { rich } from "~/i18n/rich";
import { issueOwnerRecovery, type RecoveryLink } from "~/lib/session";
import { ApiError } from "~/services/api";

/**
 * The operator path: a recovery link for an owner who cannot sign in, for the person who holds
 * the instance's setup token (whoever can set a secret on the deployment). Everyone else is
 * recovered by an owner or an administrator, inside the app.
 */
export default function OwnerRecoveryRoute() {
	const [token, setToken] = useState("");
	const [email, setEmail] = useState("");
	const [issued, setIssued] = useState<RecoveryLink | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	async function submit(event: FormEvent) {
		event.preventDefault();
		setBusy(true);
		setError(null);
		setIssued(null);
		try {
			setIssued(await issueOwnerRecovery(token, email.trim()));
			setToken("");
		} catch (caught) {
			setError(
				caught instanceof ApiError ? caught.message : t("The recovery link could not be created."),
			);
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className="min-h-screen bg-kumo-recessed flex items-center justify-center p-4">
			<form
				onSubmit={submit}
				className="w-full max-w-sm rounded-xl border border-kumo-line bg-kumo-base p-6 space-y-4"
			>
				<div>
					<h1 className="text-xl font-bold text-kumo-default">{t("Recover an owner")}</h1>
					<p className="text-sm text-kumo-subtle mt-1">
						{rich(
							"For the person who deployed this instance. It needs the setup token, the secret named {secret} on the deployment, and makes a one-time link that lets an owner choose a new password.",
							{ secret: <code>SETUP_TOKEN</code> },
						)}
					</p>
				</div>
				<Input
					label={t("Setup token")}
					className="w-full"
					id="owner-recovery-token"
					type="password"
					autoComplete="off"
					value={token}
					onChange={(e) => setToken(e.target.value)}
					required
				/>
				<Input
					label={t("The owner's email")}
					className="w-full"
					id="owner-recovery-email"
					type="email"
					autoComplete="off"
					value={email}
					onChange={(e) => setEmail(e.target.value)}
					required
				/>
				{error && (
					<p role="alert" className="text-sm text-kumo-danger">
						{error}
					</p>
				)}
				<Button type="submit" variant="primary" loading={busy} className="w-full justify-center">
					{t("Create a recovery link")}
				</Button>
				{issued && (
					<div className="rounded-md bg-kumo-tint px-3 py-2 space-y-1">
						<p className="text-sm text-kumo-strong">
							{t("Open this link, or give it to {email}. It works once and is shown only now.", {
								email: issued.email,
							})}
						</p>
						<div className="flex items-start gap-1">
							<code className="flex-1 break-all text-xs text-kumo-default">{issued.link}</code>
							<CopyButton text={issued.link} label={t("Copy the recovery link")} />
						</div>
					</div>
				)}
				<Link to="/sign-in" className="block text-sm underline text-kumo-subtle">
					{t("Back to sign in")}
				</Link>
			</form>
		</div>
	);
}
