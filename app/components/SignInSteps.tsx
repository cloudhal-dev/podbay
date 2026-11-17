// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { Button, Input } from "@cloudflare/kumo";
import { KeyIcon } from "@phosphor-icons/react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { t } from "~/i18n";
import { authClient, passkeysSupported, unwrap } from "~/lib/auth-client";

/**
 * The steps of signing in: a passkey, or the password followed by a code when the person has an
 * authenticator app. The sign-in page and the "confirm it is you" dialog are the same steps, so
 * confirming is never weaker than signing in.
 */
export default function SignInSteps({
	fixedEmail,
	onDone,
}: {
	/** Set when a signed-in person confirms who they are: the address is theirs and cannot change. */
	fixedEmail?: string;
	onDone: () => void | Promise<void>;
}) {
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [code, setCode] = useState("");
	const [step, setStep] = useState<"password" | "code">("password");
	const [recovery, setRecovery] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState<"password" | "passkey" | "code" | null>(null);

	const codeForm = useRef<HTMLFormElement>(null);

	// The code field takes the focus when it appears, and again when its kind changes.
	// biome-ignore lint/correctness/useExhaustiveDependencies: `recovery` is a trigger, not an input
	useEffect(() => {
		// Found through the form, not by id: the field library sets the id after the first paint.
		if (step === "code") codeForm.current?.querySelector("input")?.focus();
	}, [step, recovery]);

	async function attempt(
		kind: "password" | "passkey" | "code",
		failure: string,
		run: () => Promise<void>,
	) {
		setBusy(kind);
		setError(null);
		try {
			await run();
		} catch {
			// One sentence for every reason, so the answer does not say which part was wrong.
			setError(failure);
		} finally {
			setBusy(null);
		}
	}

	function submitPassword(event: FormEvent) {
		event.preventDefault();
		void attempt(
			"password",
			t("That email and password do not match an account here."),
			async () => {
				const answer = unwrap(
					await authClient.signIn.email({ email: (fixedEmail ?? email).trim(), password }),
				) as { twoFactorRedirect?: boolean };
				setPassword("");
				if (answer.twoFactorRedirect) setStep("code");
				else await onDone();
			},
		);
	}

	function signInWithPasskey() {
		void attempt("passkey", t("That passkey could not be used here."), async () => {
			unwrap(await authClient.signIn.passkey());
			await onDone();
		});
	}

	function submitCode(event: FormEvent) {
		event.preventDefault();
		void attempt("code", t("That code is not right, or it has run out. Try again."), async () => {
			const value = code.trim();
			unwrap(
				recovery
					? await authClient.twoFactor.verifyBackupCode({ code: value })
					: await authClient.twoFactor.verifyTotp({ code: value.replace(/\s/g, "") }),
			);
			await onDone();
		});
	}

	if (step === "code") {
		return (
			<form ref={codeForm} onSubmit={submitCode} className="space-y-4">
				<Input
					label={recovery ? t("Recovery code") : t("Code from your authenticator app")}
					className="w-full"
					id="sign-in-code"
					autoComplete="one-time-code"
					inputMode={recovery ? "text" : "numeric"}
					value={code}
					onChange={(e) => setCode(e.target.value)}
					required
				/>
				{error && (
					<p role="alert" className="text-sm text-kumo-danger">
						{error}
					</p>
				)}
				<Button
					type="submit"
					variant="primary"
					loading={busy === "code"}
					className="w-full justify-center"
				>
					{t("Continue")}
				</Button>
				<button
					type="button"
					className="text-sm underline cursor-pointer bg-transparent border-0 p-0 text-kumo-subtle"
					onClick={() => {
						setRecovery(!recovery);
						setCode("");
						setError(null);
					}}
				>
					{recovery ? t("Use a code from the app instead") : t("Use a recovery code instead")}
				</button>
			</form>
		);
	}

	return (
		<form onSubmit={submitPassword} className="space-y-4">
			{fixedEmail === undefined ? (
				<Input
					label={t("Email")}
					className="w-full"
					id="sign-in-email"
					type="email"
					autoComplete="username"
					value={email}
					onChange={(e) => setEmail(e.target.value)}
					required
				/>
			) : (
				<p className="text-sm text-kumo-strong break-all">{fixedEmail}</p>
			)}
			<Input
				label={t("Password")}
				className="w-full"
				id="sign-in-password"
				type="password"
				autoComplete="current-password"
				value={password}
				onChange={(e) => setPassword(e.target.value)}
				required
			/>
			{error && (
				<p role="alert" className="text-sm text-kumo-danger">
					{error}
				</p>
			)}
			<Button
				type="submit"
				variant="primary"
				loading={busy === "password"}
				className="w-full justify-center"
			>
				{fixedEmail === undefined ? t("Sign in") : t("Continue")}
			</Button>
			{passkeysSupported() && (
				<Button
					type="button"
					variant="secondary"
					icon={<KeyIcon size={16} />}
					loading={busy === "passkey"}
					className="w-full justify-center"
					onClick={signInWithPasskey}
				>
					{t("Use a passkey")}
				</Button>
			)}
		</form>
	);
}
