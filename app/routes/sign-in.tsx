// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import SignInSteps from "~/components/SignInSteps";
import { useSetupStatus } from "~/lib/session";

export default function SignInRoute() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { data: setup } = useSetupStatus();

	return (
		<div className="min-h-screen bg-kumo-recessed flex items-center justify-center p-4">
			<div className="w-full max-w-sm rounded-xl border border-kumo-line bg-kumo-base p-6 space-y-4">
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
				<SignInSteps
					onDone={async () => {
						await queryClient.invalidateQueries();
						await navigate({ to: "/" });
					}}
				/>
			</div>
		</div>
	);
}
