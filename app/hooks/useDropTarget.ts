// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { type DragEvent, useState } from "react";
import { useUIStore } from "~/hooks/useUIStore";
import type { Email } from "~/types";

/** Marks a drag as conversations of this app, so nothing else dropped on the rail is taken. */
export const DRAG_TYPE = "application/x-podbay-conversations";

/**
 * A place in the rail that conversations can be dropped on. The conversations themselves are
 * held by the app while they are dragged; the drag carries only its mark. It is a shortcut for
 * the pointer: everything it does is also in the "Move to" menus.
 */
export function useDropTarget(onDrop: (conversations: Email[]) => void) {
	const [over, setOver] = useState(false);
	const ours = (event: DragEvent) => event.dataTransfer.types.includes(DRAG_TYPE);
	return {
		over,
		handlers: {
			onDragOver: (event: DragEvent) => {
				if (!ours(event)) return;
				event.preventDefault();
				event.dataTransfer.dropEffect = "move";
				setOver(true);
			},
			onDragLeave: () => setOver(false),
			onDrop: (event: DragEvent) => {
				setOver(false);
				if (!ours(event)) return;
				event.preventDefault();
				const dragged = useUIStore.getState().dragged;
				useUIStore.setState({ dragged: [] });
				if (dragged.length > 0) onDrop(dragged);
			},
		},
	};
}
