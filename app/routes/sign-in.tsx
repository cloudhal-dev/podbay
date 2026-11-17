// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { Button, Input } from "@cloudflare/kumo";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { signIn, useSetupStatus } from "~/lib/session";

export default function SignInRoute() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { data: setup } = useSetupStatus();
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	async function submit(event: FormEvent) {
		event.preventDefault();
		setBusy(true);
		setError(null);
		try {
			await signIn(email.trim(), password);
			await queryClient.invalidateQueries();
			await navigate({ to: "/" });
		} catch {
			// The same words for a wrong password and an unknown address.
			setError("That email and password do not match an account here.");
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
					<h1 className="text-xl font-bold text-kumo-default">Sign in</h1>
					<p className="text-sm text-kumo-subtle mt-1">Podbay</p>
				</div>
				{setup?.needsSetup && (
					<p className="text-sm text-kumo-strong rounded-md bg-kumo-tint px-3 py-2">
						This instance has no owner yet.{" "}
						<Link to="/setup" className="underline">
							Set it up
						</Link>
						.
					</p>
				)}
				<div>
					<Input
						label="Email"
						className="w-full"
						id="sign-in-email"
						type="email"
						autoComplete="username"
						value={email}
						onChange={(e) => setEmail(e.target.value)}
						required
					/>
				</div>
				<div>
					<Input
						label="Password"
						className="w-full"
						id="sign-in-password"
						type="password"
						autoComplete="current-password"
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						required
					/>
				</div>
				{error && (
					<p role="alert" className="text-sm text-kumo-danger">
						{error}
					</p>
				)}
				<Button type="submit" variant="primary" loading={busy} className="w-full justify-center">
					Sign in
				</Button>
			</form>
		</div>
	);
}
