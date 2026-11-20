// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { Button, Input } from "@cloudflare/kumo";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { t } from "~/i18n";
import { rich } from "~/i18n/rich";
import { recoveryFor, redeemRecovery, sessionChanged } from "~/lib/session";
import { ApiError } from "~/services/api";

const MIN_PASSWORD_LENGTH = 12;
const PAGE = "min-h-screen bg-kumo-recessed flex items-center justify-center p-4";
const CARD = "w-full max-w-sm rounded-xl border border-kumo-line bg-kumo-base p-6 space-y-4";

/** Where a recovery link lands: the person chooses a new password and signs in again. */
export default function RecoverRoute() {
	const { token = "" } = useParams({ strict: false });
	const { data: recovery, isPending } = useQuery({
		queryKey: ["recovery", token],
		queryFn: () => recoveryFor(token),
		retry: false,
	});
	const queryClient = useQueryClient();
	const [password, setPassword] = useState("");
	const [again, setAgain] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [done, setDone] = useState(false);

	async function submit(event: FormEvent) {
		event.preventDefault();
		if (password !== again) {
			setError(t("The two passwords are not the same."));
			return;
		}
		setBusy(true);
		setError(null);
		try {
			await redeemRecovery(token, password);
			// Every session of the account ended, this browser's too if it had one.
			await sessionChanged(queryClient);
			setPassword("");
			setAgain("");
			setDone(true);
		} catch (caught) {
			setError(caught instanceof ApiError ? caught.message : t("The password could not be set."));
		} finally {
			setBusy(false);
		}
	}

	if (isPending) return null;
	if (done) {
		return (
			<div className={PAGE}>
				<div className={CARD}>
					<h1 className="text-xl font-bold text-kumo-default">{t("Your password is set")}</h1>
					<p className="text-sm text-kumo-subtle">
						{t(
							"Sign in with it. Your authenticator app, passkeys and keys were removed; set them up again on the sign-in and security page.",
						)}
					</p>
					<Link to="/sign-in" className="text-sm underline text-kumo-default">
						{t("Go to sign in")}
					</Link>
				</div>
			</div>
		);
	}
	if (!recovery) {
		return (
			<div className={PAGE}>
				<div className={CARD}>
					<h1 className="text-xl font-bold text-kumo-default">
						{t("This link is not valid any more")}
					</h1>
					<p className="text-sm text-kumo-subtle">
						{t(
							"A recovery link works once and for a limited time. Ask the person who gave it to you for a new one.",
						)}
					</p>
					<Link to="/sign-in" className="text-sm underline text-kumo-default">
						{t("Go to sign in")}
					</Link>
				</div>
			</div>
		);
	}
	return (
		<div className={PAGE}>
			<form onSubmit={submit} className={CARD}>
				<div>
					<h1 className="text-xl font-bold text-kumo-default">{t("Choose a new password")}</h1>
					<p className="text-sm text-kumo-subtle mt-1">
						{rich(
							"For {email}. This signs you out everywhere and removes your authenticator app, passkeys and keys, so only the new password opens the account.",
							{ email: <strong className="text-kumo-default">{recovery.email}</strong> },
						)}
					</p>
				</div>
				<div>
					<Input
						label={t("New password")}
						className="w-full"
						id="recover-password"
						type="password"
						autoComplete="new-password"
						minLength={MIN_PASSWORD_LENGTH}
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						required
					/>
					<p className="text-xs text-kumo-subtle mt-1">
						{t("At least {count} characters.", { count: MIN_PASSWORD_LENGTH })}
					</p>
				</div>
				<Input
					label={t("The same password again")}
					className="w-full"
					id="recover-password-again"
					type="password"
					autoComplete="new-password"
					value={again}
					onChange={(e) => setAgain(e.target.value)}
					required
				/>
				{error && (
					<p role="alert" className="text-sm text-kumo-danger">
						{error}
					</p>
				)}
				<Button type="submit" variant="primary" loading={busy} className="w-full justify-center">
					{t("Set the password")}
				</Button>
			</form>
		</div>
	);
}
