// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { Button, Input } from "@cloudflare/kumo";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { t } from "~/i18n";
import { createFirstOwner, signIn, useSetupStatus } from "~/lib/session";
import { ApiError } from "~/services/api";

const MIN_PASSWORD_LENGTH = 12;

/**
 * Creates the first owner. The form is not what protects a new instance: the Worker accepts the
 * call only with the setup token the deployer set, and only once.
 */
export default function SetupRoute() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { data: setup } = useSetupStatus();
	const [token, setToken] = useState("");
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	async function submit(event: FormEvent) {
		event.preventDefault();
		setBusy(true);
		setError(null);
		try {
			await createFirstOwner({
				token: token.trim(),
				name: name.trim(),
				email: email.trim(),
				password,
			});
			await signIn(email.trim(), password);
			await queryClient.invalidateQueries();
			await navigate({ to: "/" });
		} catch (caught) {
			setError(
				caught instanceof ApiError ? caught.message : t("The owner account could not be created."),
			);
		} finally {
			setBusy(false);
		}
	}

	if (setup && !setup.needsSetup) {
		return (
			<div className="min-h-screen bg-kumo-recessed flex items-center justify-center p-4">
				<div className="w-full max-w-sm rounded-xl border border-kumo-line bg-kumo-base p-6 space-y-3">
					<h1 className="text-xl font-bold text-kumo-default">{t("Already set up")}</h1>
					<p className="text-sm text-kumo-subtle">{t("This instance has an owner.")}</p>
					<Link to="/sign-in" className="text-sm underline text-kumo-default">
						{t("Go to sign in")}
					</Link>
				</div>
			</div>
		);
	}

	return (
		<div className="min-h-screen bg-kumo-recessed flex items-center justify-center p-4">
			<form
				onSubmit={submit}
				className="w-full max-w-sm rounded-xl border border-kumo-line bg-kumo-base p-6 space-y-4"
			>
				<div>
					<h1 className="text-xl font-bold text-kumo-default">{t("Set up Podbay")}</h1>
					<p className="text-sm text-kumo-subtle mt-1">
						{t(
							"Create the first owner. You need the setup token that was set when this instance was deployed.",
						)}
					</p>
				</div>
				<div>
					<Input
						label={t("Setup token")}
						className="w-full"
						id="setup-token"
						type="password"
						autoComplete="off"
						value={token}
						onChange={(e) => setToken(e.target.value)}
						required
					/>
				</div>
				<div>
					<Input
						label={t("Your name")}
						className="w-full"
						id="setup-name"
						autoComplete="name"
						value={name}
						onChange={(e) => setName(e.target.value)}
						required
					/>
				</div>
				<div>
					<Input
						label={t("Email")}
						className="w-full"
						id="setup-email"
						type="email"
						autoComplete="username"
						value={email}
						onChange={(e) => setEmail(e.target.value)}
						required
					/>
					<p className="text-xs text-kumo-subtle mt-1">
						{t(
							"Use an address outside this instance, so you can still be reached if mail here stops.",
						)}
					</p>
				</div>
				<div>
					<Input
						label={t("Password")}
						className="w-full"
						id="setup-password"
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
					{t("Create owner")}
				</Button>
			</form>
		</div>
	);
}
