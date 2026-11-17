// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { Button, Input } from "@cloudflare/kumo";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { t } from "~/i18n";
import { rich } from "~/i18n/rich";
import { acceptInvitation, invitationFor, signIn } from "~/lib/session";
import { ApiError } from "~/services/api";

const MIN_PASSWORD_LENGTH = 12;

/** Where an invitation link lands: the invited person chooses a name and a password. */
export default function AcceptRoute() {
	const { token = "" } = useParams({ strict: false });
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { data: invitation, isPending } = useQuery({
		queryKey: ["invitation", token],
		queryFn: () => invitationFor(token),
		retry: false,
	});
	const [name, setName] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	async function submit(event: FormEvent) {
		event.preventDefault();
		if (!invitation) return;
		setBusy(true);
		setError(null);
		try {
			await acceptInvitation(token, name.trim(), password);
			await signIn(invitation.email, password);
			await queryClient.invalidateQueries();
			await navigate({ to: "/" });
		} catch (caught) {
			setError(
				caught instanceof ApiError ? caught.message : t("The account could not be created."),
			);
		} finally {
			setBusy(false);
		}
	}

	const card = "w-full max-w-sm rounded-xl border border-kumo-line bg-kumo-base p-6 space-y-4";
	if (isPending) return null;
	if (!invitation) {
		return (
			<div className="min-h-screen bg-kumo-recessed flex items-center justify-center p-4">
				<div className={card}>
					<h1 className="text-xl font-bold text-kumo-default">
						{t("This link is not valid any more")}
					</h1>
					<p className="text-sm text-kumo-subtle">
						{t(
							"An invitation works once and for a limited time. Ask the person who invited you for a new one.",
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
		<div className="min-h-screen bg-kumo-recessed flex items-center justify-center p-4">
			<form onSubmit={submit} className={card}>
				<div>
					<h1 className="text-xl font-bold text-kumo-default">{t("Join Podbay")}</h1>
					<p className="text-sm text-kumo-subtle mt-1">
						{rich("You were invited as {email}.", {
							email: <strong className="text-kumo-default">{invitation.email}</strong>,
						})}
					</p>
				</div>
				<div>
					<Input
						label={t("Your name")}
						className="w-full"
						id="accept-name"
						autoComplete="name"
						value={name}
						onChange={(e) => setName(e.target.value)}
						required
					/>
				</div>
				<div>
					<Input
						label={t("Password")}
						className="w-full"
						id="accept-password"
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
				{error && (
					<p role="alert" className="text-sm text-kumo-danger">
						{error}
					</p>
				)}
				<Button type="submit" variant="primary" loading={busy} className="w-full justify-center">
					{t("Create account")}
				</Button>
			</form>
		</div>
	);
}
