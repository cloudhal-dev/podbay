// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { useEffect, useRef } from "react";
import { useUIStore } from "./useUIStore";

/**
 * The answer under a conversation goes on in the floating window when the conversation is left,
 * so nothing that was written is lost (#104).
 *
 * A clean-up of an effect is not proof that the component is gone: in development React runs
 * every effect, its clean-up and the effect again right after the first mount, and may do so at
 * other times too. So the clean-up only marks the answer as left, and the move waits for the
 * microtask after it: an effect set up again in the meantime marks it as here, and nothing moves.
 */
export function useAnswerFollowsToWindow(): void {
	const here = useRef(false);
	useEffect(() => {
		here.current = true;
		return () => {
			here.current = false;
			queueMicrotask(() => {
				if (here.current) return;
				const { isComposing, composePlacement } = useUIStore.getState();
				if (isComposing && composePlacement === "inline") {
					useUIStore.setState({ composePlacement: "window" });
				}
			});
		};
	}, []);
}
