// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { LayerDialog, useKumoToastManager } from "@cloudflare/kumo";
import { createContext, type ReactNode, useCallback, useContext, useRef, useState } from "react";
import { t } from "~/i18n";

export interface Question {
	title: string;
	/** What will happen, in a sentence. Say so when it cannot be undone. */
	body: ReactNode;
	/** The words on the button that goes ahead. */
	action: string;
	/** The change cannot be taken back: the button says so with its colour. */
	destructive?: boolean;
}

type Ask = (question: Question) => Promise<boolean>;

const ConfirmContext = createContext<Ask>(async () => false);

/**
 * One confirmation dialog for the whole app. `useConfirm()` asks a question and resolves to the
 * answer; closing the dialog any other way is a no. The browser's own `confirm()` is never used:
 * it blocks the page, cannot be styled or read well, and looks like a warning from the browser.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
	const [question, setQuestion] = useState<Question | null>(null);
	const [open, setOpen] = useState(false);
	const answer = useRef<((yes: boolean) => void) | null>(null);
	const toasts = useKumoToastManager();

	const ask = useCallback<Ask>(
		(next) =>
			new Promise<boolean>((resolve) => {
				// A second question while one is open answers the first with a no.
				answer.current?.(false);
				answer.current = resolve;
				// A note about the last thing done must not lie over the question and its buttons.
				toasts.close();
				setQuestion(next);
				setOpen(true);
			}),
		[toasts],
	);

	function finish(yes: boolean) {
		setOpen(false);
		answer.current?.(yes);
		answer.current = null;
	}

	return (
		<ConfirmContext.Provider value={ask}>
			{children}
			<LayerDialog.Alert
				open={open}
				onOpenChange={(next) => {
					if (!next) finish(false);
				}}
			>
				<LayerDialog.Content size="sm">
					<LayerDialog.Title>{question?.title ?? ""}</LayerDialog.Title>
					<LayerDialog.Body>
						<div className="text-sm text-kumo-strong">{question?.body}</div>
					</LayerDialog.Body>
					<LayerDialog.Actions dismissLabel={t("Cancel")}>
						<LayerDialog.Action
							variant={question?.destructive ? "destructive" : "primary"}
							onClick={() => finish(true)}
						>
							{question?.action ?? t("Continue")}
						</LayerDialog.Action>
					</LayerDialog.Actions>
				</LayerDialog.Content>
			</LayerDialog.Alert>
		</ConfirmContext.Provider>
	);
}

/** Ask the person before a change that cannot be undone. Resolves to whether they went ahead. */
export function useConfirm(): Ask {
	return useContext(ConfirmContext);
}
