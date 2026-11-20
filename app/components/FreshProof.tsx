// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { LayerDialog } from "@cloudflare/kumo";
import { useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useCallback, useContext, useRef, useState } from "react";
import { t } from "~/i18n";
import { needsFreshProof } from "~/lib/auth-client";
import { sessionChanged, sessionKeys, useMe } from "~/lib/session";
import SignInSteps from "./SignInSteps";

type Run = <T>(action: () => Promise<T>) => Promise<T>;

const FreshProofContext = createContext<Run>((action) => action());

/**
 * Sensitive changes need a person who signed in a few minutes ago; the Worker decides that, not
 * the app. `useFreshProof()` runs a change, and when the Worker asks for fresh proof it opens the
 * sign-in steps for the signed-in person and runs the change once more.
 */
export function FreshProofProvider({ children }: { children: ReactNode }) {
	const queryClient = useQueryClient();
	const { data: me } = useMe();
	const [open, setOpen] = useState(false);
	const waiting = useRef<((confirmed: boolean) => void) | null>(null);

	const run = useCallback<Run>(async (action) => {
		try {
			return await action();
		} catch (error) {
			if (!needsFreshProof(error)) throw error;
			const confirmed = await new Promise<boolean>((resolve) => {
				waiting.current = resolve;
				setOpen(true);
			});
			if (!confirmed) throw error;
			return action();
		}
	}, []);

	function finish(confirmed: boolean) {
		setOpen(false);
		waiting.current?.(confirmed);
		waiting.current = null;
	}

	return (
		<FreshProofContext.Provider value={run}>
			{children}
			<LayerDialog.Root
				open={open}
				onOpenChange={(next) => {
					if (!next) finish(false);
				}}
			>
				<LayerDialog.Content size="sm">
					<LayerDialog.Title>{t("Confirm it is you")}</LayerDialog.Title>
					<LayerDialog.Description>
						{t("This change needs you to sign in again. It is asked once every few minutes.")}
					</LayerDialog.Description>
					<LayerDialog.Body>
						{open && (
							<SignInSteps
								fixedEmail={me?.user.email ?? ""}
								onDone={async () => {
									await sessionChanged(queryClient, sessionKeys.me);
									finish(true);
								}}
							/>
						)}
					</LayerDialog.Body>
				</LayerDialog.Content>
			</LayerDialog.Root>
		</FreshProofContext.Provider>
	);
}

/** Run a sensitive change; asks the person to confirm who they are when the Worker requires it. */
export function useFreshProof(): Run {
	return useContext(FreshProofContext);
}
