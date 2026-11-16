// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified by the Podbay contributors.

export interface Env extends Cloudflare.Env {
	/** Cloudflare Access audience and team domain. Unset in local development. */
	POLICY_AUD?: string;
	TEAM_DOMAIN?: string;
}
