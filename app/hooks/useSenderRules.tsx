// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { useKumoToastManager } from "@cloudflare/kumo";
import { type ReactNode, useState } from "react";
import { isAddress, type RuleConditions } from "shared/rules";
import { useConfirm } from "~/components/Confirm";
import FilterDialog from "~/components/rules/FilterDialog";
import { t } from "~/i18n";
import { useBlockSender, useRules, useUnblockSender } from "~/queries/rules";
import type { Email, Mailbox } from "~/types";

/** What a message's menu offers about its sender (ADR-0008). Each is left out where it does not apply. */
export interface SenderRuleActions {
	onBlockSender?: () => void;
	onUnblockSender?: () => void;
	onFilterLikeThis?: () => void;
}

/**
 * "Block the sender" and "Filter messages like this" for a message that is being read. Both
 * change the mailbox's rules, which is the owner's: anyone else is offered neither, and the
 * Worker would refuse them. A block is asked about first, in the app's own dialog, because it
 * acts on mail nobody has seen yet.
 */
export function useSenderRules(
	mailboxId: string | undefined,
	mailbox: Mailbox | undefined,
): { actionsFor: (message: Email) => SenderRuleActions; dialog: ReactNode } {
	const isOwner = mailbox?.role === "owner";
	const { data } = useRules(mailboxId, isOwner);
	const blockSender = useBlockSender();
	const unblockSender = useUnblockSender();
	const confirm = useConfirm();
	const toasts = useKumoToastManager();
	const [like, setLike] = useState<RuleConditions | null>(null);
	const blocked = data?.blocked ?? [];

	async function block(address: string) {
		if (!mailboxId) return;
		const sure = await confirm({
			title: t("Block {address}?", { address }),
			body: t(
				"Mail from this address will go to Spam when it arrives, for everyone who uses this mailbox. Mail that is already here stays where it is, and the sender is not told.",
			),
			action: t("Block"),
		});
		if (!sure) return;
		try {
			// This address and nothing more: the Worker refuses anything that is not one.
			await blockSender.mutateAsync({ mailboxId, sender: address, kind: "address" });
			toasts.add({ title: t("{address} is blocked", { address }) });
		} catch {
			toasts.add({ title: t("The sender could not be blocked."), variant: "error" });
		}
	}

	async function unblock(address: string) {
		if (!mailboxId) return;
		try {
			await unblockSender.mutateAsync({ mailboxId, sender: address });
			toasts.add({ title: t("{address} is no longer blocked", { address }) });
		} catch {
			toasts.add({ title: t("The sender could not be unblocked"), variant: "error" });
		}
	}

	function actionsFor(message: Email): SenderRuleActions {
		const address = (message.sender ?? "").trim().toLowerCase();
		const own = address === mailbox?.email?.toLowerCase();
		if (!isOwner || !mailboxId || address === "" || own || data === undefined) return {};
		const byAddress = blocked.some((one) => one.sender === address);
		const byDomain = blocked.some((one) => one.sender === address.slice(address.lastIndexOf("@")));
		return {
			// A sender whose whole domain is blocked is unblocked in the settings, where the
			// domain is listed: unblocking one address would change nothing. A sender that is not
			// one whole address is offered no block: the dialog says "this address".
			...(byAddress
				? { onUnblockSender: () => void unblock(address) }
				: byDomain || !isAddress(address)
					? {}
					: { onBlockSender: () => void block(address) }),
			onFilterLikeThis: () => setLike({ from: { match: "is", value: address } }),
		};
	}

	const dialog =
		isOwner && mailboxId ? (
			<FilterDialog
				open={like !== null}
				onOpenChange={(open) => {
					if (!open) setLike(null);
				}}
				mailboxId={mailboxId}
				rules={data?.rules ?? []}
				like={like ?? undefined}
			/>
		) : null;

	return { actionsFor, dialog };
}
