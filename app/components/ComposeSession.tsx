// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { useParams } from "@tanstack/react-router";
import { createContext, type ReactNode, useContext } from "react";
import { type ComposeForm, useComposeForm } from "~/hooks/useComposeForm";

const ComposeContext = createContext<ComposeForm | null>(null);

/**
 * The message being written, held above the places it can be shown in: the floating window and
 * the reply under a conversation. Moving from one to the other keeps every word. It lives beside
 * the signed-in pages (`SessionGate` in `app/router.tsx`), so a page outside any mailbox keeps it
 * too; it is shown only inside its own mailbox (#113).
 */
export function ComposeSession({ children }: { children: ReactNode }) {
	const { mailboxId, folder } = useParams({ strict: false });
	const form = useComposeForm(mailboxId, folder);
	return <ComposeContext.Provider value={form}>{children}</ComposeContext.Provider>;
}

/** The message being written. Only on a signed-in page, where `ComposeSession` is. */
export function useCompose(): ComposeForm {
	const form = useContext(ComposeContext);
	if (form === null) throw new Error("useCompose: no ComposeSession above this component");
	return form;
}
