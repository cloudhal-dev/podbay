// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import SignInSteps from "~/components/SignInSteps";
import { t } from "~/i18n";
import { rich } from "~/i18n/rich";
import { sessionChanged, useSetupStatus } from "~/lib/session";

export default function SignInRoute() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { data: setup } = useSetupStatus();

	return (
		<div className="min-h-screen bg-kumo-recessed flex items-center justify-center p-4">
			<div className="w-full max-w-sm rounded-xl border border-kumo-line bg-kumo-base p-6 space-y-4">
				<div>
					<h1 className="text-xl font-bold text-kumo-default">{t("Sign in")}</h1>
					<p className="text-sm text-kumo-subtle mt-1">Podbay</p>
				</div>
				{setup?.needsSetup && (
					<p className="text-sm text-kumo-strong rounded-md bg-kumo-tint px-3 py-2">
						{rich("This instance has no owner yet. {link}.", {
							link: (
								<Link to="/setup" className="underline">
									{t("Set it up")}
								</Link>
							),
						})}
					</p>
				)}
				<SignInSteps
					onDone={async () => {
						await sessionChanged(queryClient);
						await navigate({ to: "/" });
					}}
				/>
				<p className="text-xs text-kumo-subtle">
					{rich(
						"Cannot sign in? Ask an owner or an administrator of this instance for a recovery link. If you are the only owner, the person who deployed it can {link}.",
						{
							link: (
								<Link to="/setup/recovery" className="underline">
									{t("make one with the setup token")}
								</Link>
							),
						},
					)}
				</p>
			</div>
		</div>
	);
}
