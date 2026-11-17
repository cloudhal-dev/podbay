// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Turkish. Each message is named by its English text; `pnpm static messages` holds this list to
 * the messages the app names (rule D8). A word before a bar, as in `place|Archive`, says what
 * the message is about and is not part of the English.
 *
 * The messages are kept in two files, by the first character of the English, so that neither
 * grows past the size a file may have (rule D4): `./tr/a-to-m.ts` holds those that begin, in
 * upper case, before "N", and `./tr/n-to-z.ts` the rest. A new message goes into the one its
 * English belongs to, in order.
 */
import { trAtoM } from "./tr/a-to-m.ts";
import { trNtoZ } from "./tr/n-to-z.ts";

export const tr: Readonly<Record<string, string>> = { ...trAtoM, ...trNtoZ };
