// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { Dialog } from "@cloudflare/kumo";
import { useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useCallback, useContext, useRef, useState } from "react";
import { needsFreshProof } from "~/lib/auth-client";
import { sessionKeys, useMe } from "~/lib/session";
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
			<Dialog.Root
				open={open}
				onOpenChange={(next) => {
					if (!next) finish(false);
				}}
			>
				<Dialog size="sm" className="p-6">
					<Dialog.Title className="text-base font-semibold mb-1">Confirm it is you</Dialog.Title>
					<Dialog.Description className="text-sm text-kumo-subtle mb-4">
						This change needs you to sign in again. It is asked once every few minutes.
					</Dialog.Description>
					{open && (
						<SignInSteps
							fixedEmail={me?.user.email ?? ""}
							onDone={async () => {
								await queryClient.invalidateQueries({ queryKey: sessionKeys.me });
								finish(true);
							}}
						/>
					)}
				</Dialog>
			</Dialog.Root>
		</FreshProofContext.Provider>
	);
}

/** Run a sensitive change; asks the person to confirm who they are when the Worker requires it. */
export function useFreshProof(): Run {
	return useContext(FreshProofContext);
}
