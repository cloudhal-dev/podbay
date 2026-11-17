// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { Button, Input } from "@cloudflare/kumo";
import { type FormEvent, useState } from "react";
import { useFreshProof } from "~/components/FreshProof";
import { t } from "~/i18n";
import { authClient, unwrap } from "~/lib/auth-client";
import { message, Problem, Section } from "./parts";

/** The shortest password the Worker takes; it decides, this only says so beforehand. */
const MIN_PASSWORD_LENGTH = 12;

/**
 * Changing the password. It needs the current one and fresh proof, and it ends every other
 * session: whoever was signed in elsewhere with the old password is signed out.
 */
export default function Password() {
	const withFreshProof = useFreshProof();
	const [current, setCurrent] = useState("");
	const [next, setNext] = useState("");
	const [again, setAgain] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [done, setDone] = useState(false);

	async function submit(event: FormEvent) {
		event.preventDefault();
		setDone(false);
		if (next !== again) {
			setError(t("The two passwords are not the same."));
			return;
		}
		setBusy(true);
		setError(null);
		try {
			await withFreshProof(async () => {
				unwrap(
					await authClient.changePassword({
						currentPassword: current,
						newPassword: next,
						revokeOtherSessions: true,
					}),
				);
			});
			// A password is kept nowhere once it has been used.
			setCurrent("");
			setNext("");
			setAgain("");
			setDone(true);
		} catch (caught) {
			setError(message(caught, t("The password could not be changed.")));
		} finally {
			setBusy(false);
		}
	}

	return (
		<Section
			title={t("Password")}
			about={t(
				"Changing it signs you out of every other browser. Keys for programs, your authenticator app and your passkeys stay as they are.",
			)}
		>
			<form className="space-y-3" onSubmit={submit}>
				<Input
					label={t("Current password")}
					type="password"
					size="sm"
					autoComplete="current-password"
					value={current}
					onChange={(event) => setCurrent(event.target.value)}
					required
				/>
				<div>
					<Input
						label={t("New password")}
						type="password"
						size="sm"
						autoComplete="new-password"
						minLength={MIN_PASSWORD_LENGTH}
						value={next}
						onChange={(event) => setNext(event.target.value)}
						required
					/>
					<p className="text-xs text-kumo-subtle mt-1">
						{t("At least {count} characters.", { count: MIN_PASSWORD_LENGTH })}
					</p>
				</div>
				<Input
					label={t("The same password again")}
					type="password"
					size="sm"
					autoComplete="new-password"
					minLength={MIN_PASSWORD_LENGTH}
					value={again}
					onChange={(event) => setAgain(event.target.value)}
					required
				/>
				<Problem text={error} />
				{done && (
					<p role="status" className="text-sm text-kumo-default">
						{t("Your password is changed. Every other browser was signed out.")}
					</p>
				)}
				<Button type="submit" variant="secondary" size="sm" loading={busy}>
					{t("Change password")}
				</Button>
			</form>
		</Section>
	);
}
