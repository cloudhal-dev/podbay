// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * The code the Worker answers with (status 403) when a sensitive change needs a person to sign
 * in again first. The app shows its "confirm it is you" dialog on it and retries.
 */
export const NOT_FRESH_CODE = "SESSION_NOT_FRESH";
