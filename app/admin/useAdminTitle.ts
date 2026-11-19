// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { useEffect } from "react";
import { t } from "~/i18n";

/**
 * The tab's title for a page of the administration area, narrowest first: "People -
 * Administration - Podbay". The history and the tab say which page it is.
 */
export function useAdminTitle(...parts: string[]): void {
	const title = [...parts, t("Administration"), "Podbay"].join(" - ");
	useEffect(() => {
		document.title = title;
		return () => {
			document.title = "Podbay";
		};
	}, [title]);
}
