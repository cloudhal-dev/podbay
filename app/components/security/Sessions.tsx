// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { Badge, Button } from "@cloudflare/kumo";
import { useRef, useState } from "react";
import { useFreshProof } from "~/components/FreshProof";
import { dateLanguage, t } from "~/i18n";
import { authClient, unwrap } from "~/lib/auth-client";
import { deviceOf } from "~/lib/user-agent";
import { message, Problem, Section } from "./parts";

/** A session as the page shows it. What ends it is kept apart, outside what is drawn. */
interface Shown {
	id: string;
	userAgent: string | null;
	address: string | null;
	since: string;
	current: boolean;
}

interface Stored {
	id: string;
	token: string;
	userAgent?: string | null;
	ipAddress?: string | null;
	createdAt: string | Date;
}

function deviceName(userAgent: string | null): string {
	const { browser, system } = deviceOf(userAgent);
	if (browser && system) return t("{browser} on {system}", { browser, system });
	return browser ?? system ?? t("A browser or a program");
}

/**
 * Where the person is signed in. The list is shown when they ask for it, because it needs
 * fresh proof; ending a session signs that browser out, and nothing here ends this one (that
 * is what Sign out is for).
 */
export default function Sessions() {
	const withFreshProof = useFreshProof();
	const [sessions, setSessions] = useState<Shown[] | null>(null);
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	/** What ends each session. It is a secret of the account: used, never drawn or stored. */
	const tokens = useRef(new Map<string, string>());

	async function load() {
		const [stored, mine] = await Promise.all([
			authClient.listSessions().then((answer) => unwrap(answer) as Stored[]),
			authClient.getSession().then((answer) => unwrap(answer)),
		]);
		tokens.current = new Map(stored.map((session) => [session.id, session.token]));
		const here = mine?.session.id;
		setSessions(
			stored
				.map((session) => ({
					id: session.id,
					userAgent: session.userAgent ?? null,
					address: session.ipAddress ?? null,
					since: new Date(session.createdAt).toISOString(),
					current: session.id === here,
				}))
				// This browser first, then the newest.
				.sort((a, b) => Number(b.current) - Number(a.current) || b.since.localeCompare(a.since)),
		);
	}

	async function act(what: string, fallback: string, action: () => Promise<void>) {
		setBusy(what);
		setError(null);
		try {
			await withFreshProof(async () => {
				await action();
				await load();
			});
		} catch (caught) {
			setError(message(caught, fallback));
		} finally {
			setBusy(null);
		}
	}

	const others = sessions?.filter((session) => !session.current).length ?? 0;
	return (
		<Section
			title={t("Where you are signed in")}
			about={t(
				"Every browser that is signed in to your account. End one you do not recognise, then change your password.",
			)}
		>
			{sessions === null ? (
				<Button
					variant="secondary"
					size="sm"
					loading={busy === "show"}
					onClick={() => act("show", t("Your sessions could not be loaded."), async () => {})}
				>
					{t("Show my sessions")}
				</Button>
			) : (
				<>
					<ul className="m-0 list-none divide-y divide-kumo-line p-0">
						{sessions.map((session) => (
							<li key={session.id} className="flex items-center gap-3 py-2">
								<div className="min-w-0 flex-1">
									<p className="m-0 flex items-center gap-2 text-sm text-kumo-default">
										<span className="truncate">{deviceName(session.userAgent)}</span>
										{session.current && <Badge variant="outline">{t("This browser")}</Badge>}
									</p>
									<p className="m-0 truncate text-xs text-kumo-subtle">
										{t("Signed in {date}", {
											date: new Date(session.since).toLocaleString(dateLanguage(), {
												dateStyle: "medium",
												timeStyle: "short",
											}),
										})}
										{session.address ? ` · ${session.address}` : ""}
									</p>
								</div>
								{!session.current && (
									<Button
										variant="secondary"
										size="sm"
										loading={busy === session.id}
										aria-label={t("End the session of {device}", {
											device: deviceName(session.userAgent),
										})}
										onClick={() =>
											act(session.id, t("The session could not be ended."), async () => {
												unwrap(
													await authClient.revokeSession({
														token: tokens.current.get(session.id) ?? "",
													}),
												);
											})
										}
									>
										{t("End")}
									</Button>
								)}
							</li>
						))}
					</ul>
					{others > 0 && (
						<Button
							variant="secondary"
							size="sm"
							loading={busy === "others"}
							onClick={() =>
								act("others", t("The sessions could not be ended."), async () => {
									unwrap(await authClient.revokeOtherSessions());
								})
							}
						>
							{t("End all other sessions")}
						</Button>
					)}
					{others === 0 && (
						<p className="m-0 text-sm text-kumo-subtle">{t("You are signed in nowhere else.")}</p>
					)}
				</>
			)}
			<Problem text={error} />
		</Section>
	);
}
