// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * The app's words: the message runtime of `@podbay/i18n`, with the app's catalogs handed to it.
 * Every screen imports `~/i18n`, so the catalogs are in place before a word is asked for.
 */
import { addCatalog } from "@podbay/i18n";
import { tr } from "./tr";

addCatalog("app", "tr", tr);

export * from "@podbay/i18n";
