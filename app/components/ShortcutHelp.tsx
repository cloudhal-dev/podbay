// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { LayerDialog } from "@cloudflare/kumo";
import { SHORTCUT_HELP } from "~/hooks/useShortcuts";
import { useUIStore } from "~/hooks/useUIStore";
import { t } from "~/i18n";

/** The list of keyboard shortcuts, opened with `?`. */
export default function ShortcutHelp() {
	const { isShortcutHelpOpen, setShortcutHelpOpen } = useUIStore();
	return (
		<LayerDialog.Root open={isShortcutHelpOpen} onOpenChange={setShortcutHelpOpen}>
			<LayerDialog.Content size="sm">
				<LayerDialog.Title>{t("Keyboard shortcuts")}</LayerDialog.Title>
				<LayerDialog.Body>
					<dl className="divide-y divide-kumo-line">
						{SHORTCUT_HELP.map((shortcut) => (
							<div key={shortcut.keys} className="flex items-center justify-between gap-4 py-1.5">
								<dt className="text-sm text-kumo-default">{t(shortcut.does)}</dt>
								<dd className="shrink-0 font-mono text-xs text-kumo-subtle">{t(shortcut.keys)}</dd>
							</div>
						))}
					</dl>
				</LayerDialog.Body>
			</LayerDialog.Content>
		</LayerDialog.Root>
	);
}
