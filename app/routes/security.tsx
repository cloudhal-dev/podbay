// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { Badge, Button, Input } from "@cloudflare/kumo";
import { ArrowLeftIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import CopyButton from "~/components/CopyButton";
import { useFreshProof } from "~/components/FreshProof";
import QrCode from "~/components/QrCode";
import Password from "~/components/security/Password";
import { message, Problem, Section } from "~/components/security/parts";
import Sessions from "~/components/security/Sessions";
import { dateLanguage, t } from "~/i18n";
import { authClient, passkeysSupported, unwrap } from "~/lib/auth-client";
import { sessionChanged, sessionKeys, useMe } from "~/lib/session";

const PASSKEYS = ["security", "passkeys"] as const;

interface PasskeyRow {
	id: string;
	name?: string | null;
	createdAt?: string | Date | null;
}

function Passkeys() {
	const queryClient = useQueryClient();
	const withFreshProof = useFreshProof();
	const { data: passkeys = [] } = useQuery({
		queryKey: PASSKEYS,
		queryFn: async () => unwrap(await authClient.passkey.listUserPasskeys()) as PasskeyRow[],
	});
	const [name, setName] = useState("");
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	async function change(what: string, fallback: string, action: () => Promise<unknown>) {
		setBusy(what);
		setError(null);
		try {
			await withFreshProof(action);
			await queryClient.invalidateQueries({ queryKey: PASSKEYS });
			await sessionChanged(queryClient, sessionKeys.me);
		} catch (caught) {
			setError(message(caught, fallback));
		} finally {
			setBusy(null);
		}
	}

	function add(event: FormEvent) {
		event.preventDefault();
		void change("add", t("The passkey could not be added."), async () => {
			unwrap(await authClient.passkey.addPasskey({ name: name.trim() || t("Passkey") }));
			setName("");
		});
	}

	return (
		<Section
			title={t("Passkeys")}
			about={t(
				"A passkey signs you in with your device's fingerprint, face or PIN. It works only on this site, so it cannot be given away to a look-alike page, and it needs no code afterwards.",
			)}
		>
			{passkeys.length === 0 ? (
				<p className="text-sm text-kumo-subtle">{t("You have no passkeys yet.")}</p>
			) : (
				<ul className="rounded-lg border border-kumo-line divide-y divide-kumo-line">
					{passkeys.map((passkey) => (
						<li key={passkey.id} className="flex items-center gap-3 px-3 py-2">
							<span className="min-w-0 flex-1 truncate text-sm text-kumo-default">
								{passkey.name || t("Passkey")}
							</span>
							{passkey.createdAt && (
								<span className="text-xs text-kumo-subtle">
									{t("Added {date}", {
										date: new Date(passkey.createdAt).toLocaleDateString(dateLanguage(), {
											dateStyle: "medium",
										}),
									})}
								</span>
							)}
							<Button
								variant="ghost"
								size="sm"
								loading={busy === passkey.id}
								onClick={() =>
									change(passkey.id, t("The passkey could not be removed."), async () => {
										unwrap(await authClient.passkey.deletePasskey({ id: passkey.id }));
									})
								}
							>
								{t("Remove")}
							</Button>
						</li>
					))}
				</ul>
			)}
			{passkeysSupported() ? (
				<form onSubmit={add} className="flex flex-wrap items-end gap-2">
					<div className="flex-1 min-w-48">
						<Input
							label={t("Name for a new passkey")}
							className="w-full"
							id="passkey-name"
							size="sm"
							placeholder={t("For example: laptop")}
							maxLength={60}
							value={name}
							onChange={(e) => setName(e.target.value)}
						/>
					</div>
					<Button type="submit" variant="secondary" size="sm" loading={busy === "add"}>
						{t("Add a passkey")}
					</Button>
				</form>
			) : (
				<p className="text-sm text-kumo-subtle">{t("This browser cannot use passkeys.")}</p>
			)}
			<Problem text={error} />
		</Section>
	);
}

/** Recovery codes, shown once. They exist only in this component's state. */
function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
	return (
		<div className="rounded-lg border border-kumo-line bg-kumo-tint p-3 space-y-2">
			<p className="text-sm font-medium text-kumo-default">
				{t(
					"Save these recovery codes somewhere safe. Each one signs you in once if you lose your authenticator app. They are shown only now.",
				)}
			</p>
			<div className="flex items-start gap-1">
				<code className="flex-1 grid grid-cols-2 gap-x-4 gap-y-1 rounded-md bg-kumo-base px-3 py-2 text-xs text-kumo-default">
					{codes.map((code) => (
						<span key={code}>{code}</span>
					))}
				</code>
				<CopyButton text={codes.join("\n")} label={t("Copy the recovery codes")} />
			</div>
			<Button variant="secondary" size="sm" onClick={onDone}>
				{t("I have saved them")}
			</Button>
		</div>
	);
}

function PasswordForm({
	label,
	busy,
	onSubmit,
	variant = "secondary",
}: {
	label: string;
	busy: boolean;
	onSubmit: (password: string) => void;
	variant?: "secondary" | "destructive";
}) {
	const [password, setPassword] = useState("");
	return (
		<form
			className="flex flex-wrap items-end gap-2"
			onSubmit={(event) => {
				event.preventDefault();
				onSubmit(password);
				setPassword("");
			}}
		>
			<div className="flex-1 min-w-48">
				<Input
					label={t("Your password")}
					className="w-full"
					type="password"
					size="sm"
					autoComplete="current-password"
					value={password}
					onChange={(e) => setPassword(e.target.value)}
					required
				/>
			</div>
			<Button type="submit" variant={variant} size="sm" loading={busy}>
				{label}
			</Button>
		</form>
	);
}

function AuthenticatorApp({ enabled }: { enabled: boolean }) {
	const queryClient = useQueryClient();
	const withFreshProof = useFreshProof();
	const [setup, setSetup] = useState<{ uri: string; codes: string[] } | null>(null);
	const [codes, setCodes] = useState<string[] | null>(null);
	const [mode, setMode] = useState<"idle" | "off" | "codes">("idle");
	const [code, setCode] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function change(fallback: string, action: () => Promise<void>) {
		setBusy(true);
		setError(null);
		try {
			await withFreshProof(action);
		} catch (caught) {
			setError(message(caught, fallback));
		} finally {
			setBusy(false);
		}
	}
	const refresh = () => sessionChanged(queryClient, sessionKeys.me);

	if (codes) {
		return (
			<RecoveryCodes
				codes={codes}
				onDone={() => {
					setCodes(null);
					setMode("idle");
				}}
			/>
		);
	}

	if (setup) {
		const secret = new URL(setup.uri).searchParams.get("secret") ?? "";
		return (
			<div className="space-y-3">
				<p className="text-sm text-kumo-default">
					{t("Scan this with your authenticator app, then enter the code it shows.")}
				</p>
				<QrCode text={setup.uri} label={t("QR code for your authenticator app")} />
				<p className="text-xs text-kumo-subtle break-all">
					{t("Or enter this key by hand:")} <code className="text-kumo-default">{secret}</code>
				</p>
				<form
					className="flex flex-wrap items-end gap-2"
					onSubmit={(event) => {
						event.preventDefault();
						void change(t("That code is not right. Try the next one."), async () => {
							unwrap(await authClient.twoFactor.verifyTotp({ code: code.replace(/\s/g, "") }));
							setCodes(setup.codes);
							setSetup(null);
							setCode("");
							await refresh();
						});
					}}
				>
					<div className="flex-1 min-w-40">
						<Input
							label={t("Code from the app")}
							className="w-full"
							size="sm"
							inputMode="numeric"
							autoComplete="one-time-code"
							value={code}
							onChange={(e) => setCode(e.target.value)}
							required
						/>
					</div>
					<Button type="submit" variant="primary" size="sm" loading={busy}>
						{t("Turn on")}
					</Button>
					<Button type="button" variant="ghost" size="sm" onClick={() => setSetup(null)}>
						{t("Cancel")}
					</Button>
				</form>
				<Problem text={error} />
			</div>
		);
	}

	if (!enabled) {
		return (
			<>
				<PasswordForm
					label={t("Set up an authenticator app")}
					busy={busy}
					onSubmit={(password) =>
						change(t("The authenticator app could not be set up."), async () => {
							const answer = unwrap(await authClient.twoFactor.enable({ password })) as {
								totpURI: string;
								backupCodes: string[];
							};
							setSetup({ uri: answer.totpURI, codes: answer.backupCodes });
						})
					}
				/>
				<Problem text={error} />
			</>
		);
	}

	return (
		<>
			<div className="flex flex-wrap items-center gap-2">
				<Badge variant="secondary">{t("On")}</Badge>
				<Button
					variant="ghost"
					size="sm"
					onClick={() => setMode(mode === "codes" ? "idle" : "codes")}
				>
					{t("New recovery codes")}
				</Button>
				<Button variant="ghost" size="sm" onClick={() => setMode(mode === "off" ? "idle" : "off")}>
					{t("Turn off")}
				</Button>
			</div>
			{mode === "codes" && (
				<PasswordForm
					label={t("Replace my recovery codes")}
					busy={busy}
					onSubmit={(password) =>
						change(t("New recovery codes could not be made."), async () => {
							const answer = unwrap(
								await authClient.twoFactor.generateBackupCodes({ password }),
							) as { backupCodes: string[] };
							setCodes(answer.backupCodes);
						})
					}
				/>
			)}
			{mode === "off" && (
				<PasswordForm
					label={t("Turn off the second step")}
					variant="destructive"
					busy={busy}
					onSubmit={(password) =>
						change(t("The second step could not be turned off."), async () => {
							unwrap(await authClient.twoFactor.disable({ password }));
							setMode("idle");
							await refresh();
						})
					}
				/>
			)}
			<Problem text={error} />
		</>
	);
}

export default function SecurityRoute() {
	const { data: me } = useMe();
	return (
		<div className="min-h-screen bg-kumo-recessed">
			<div className="max-w-2xl mx-auto px-4 py-10 space-y-5">
				<div>
					<Link
						to="/"
						className="inline-flex items-center gap-1 text-sm text-kumo-subtle underline"
					>
						<ArrowLeftIcon size={14} /> {t("Mailboxes")}
					</Link>
					<h1 className="text-2xl font-bold text-kumo-default mt-2">{t("Sign-in and security")}</h1>
					{me && <p className="text-sm text-kumo-subtle mt-1">{me.user.email}</p>}
				</div>
				<Passkeys />
				<Section
					title={t("Authenticator app")}
					about={t(
						"After your password, Podbay asks for a six-digit code from an app on your phone. Recovery codes are the way back in if you lose the phone.",
					)}
				>
					<AuthenticatorApp enabled={me?.security.authenticatorApp === true} />
				</Section>
				<Password />
				<Sessions />
			</div>
		</div>
	);
}
