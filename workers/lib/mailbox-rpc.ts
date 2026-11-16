// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import type { MailboxDO } from "../durableObject";
import type { SearchFilterOptions } from "./list-options";

/**
 * The mailbox calls whose inferred RPC return types are too deep for the compiler
 * ("type instantiation is excessively deep"). Their results go straight into a JSON response,
 * so they are typed here by what the Worker needs: the arguments exactly, the rows as unknown.
 *
 * `mailboxQueries` is the one place that narrows the stub. Do not cast a stub anywhere else.
 */
export interface MailboxQueries {
	getThreadedEmails(options: {
		folder?: string;
		page?: number;
		limit?: number;
	}): Promise<unknown[]>;
	countThreadedEmails(folder: string): Promise<number>;
	getThreadEmails(threadId: string): Promise<unknown[]>;
	searchEmails(
		options: SearchFilterOptions & { page?: number; limit?: number },
	): Promise<unknown[]>;
	countSearchResults(options: SearchFilterOptions): Promise<number>;
	findThreadBySubject(subject: string, senderAddress?: string): Promise<string | null>;
	checkSendRateLimit(): Promise<string | null>;
}

export function mailboxQueries(stub: DurableObjectStub<MailboxDO>): MailboxQueries {
	return stub as unknown as MailboxQueries;
}
