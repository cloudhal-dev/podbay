// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { Button, Dialog } from "@cloudflare/kumo";
import { SHORTCUT_HELP } from "~/hooks/useShortcuts";
import { useUIStore } from "~/hooks/useUIStore";

/** The list of keyboard shortcuts, opened with `?`. */
export default function ShortcutHelp() {
	const { isShortcutHelpOpen, setShortcutHelpOpen } = useUIStore();
	return (
		<Dialog.Root open={isShortcutHelpOpen} onOpenChange={setShortcutHelpOpen}>
			<Dialog size="sm" className="p-6">
				<Dialog.Title className="text-base font-semibold mb-3">Keyboard shortcuts</Dialog.Title>
				<dl className="divide-y divide-kumo-line">
					{SHORTCUT_HELP.map((shortcut) => (
						<div key={shortcut.keys} className="flex items-center justify-between gap-4 py-1.5">
							<dt className="text-sm text-kumo-default">{shortcut.does}</dt>
							<dd className="shrink-0 font-mono text-xs text-kumo-subtle">{shortcut.keys}</dd>
						</div>
					))}
				</dl>
				<div className="flex justify-end pt-4">
					<Dialog.Close
						render={(props) => (
							<Button {...props} variant="secondary" size="sm">
								Close
							</Button>
						)}
					/>
				</div>
			</Dialog>
		</Dialog.Root>
	);
}
