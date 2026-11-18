// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { Button, Input, useKumoToastManager } from "@cloudflare/kumo";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon } from "@phosphor-icons/react";
import { type FormEvent, useState } from "react";
import { blockedSenderOf, RULE_LIMITS, type Rule } from "shared/rules";
import { useConfirm } from "~/components/Confirm";
import IconButton from "~/components/IconButton";
import FilterDialog from "~/components/rules/FilterDialog";
import { t } from "~/i18n";
import { actionWords, blockedWords, conditionWords } from "~/lib/rule-words";
import { useLabels } from "~/queries/labels";
import { useBlockSender, useRules, useSaveRules, useUnblockSender } from "~/queries/rules";

/** A domain that is nobody's, to show what the field takes. It is not a word of any language. */
const EXAMPLE_DOMAIN = "example.com";

/**
 * The rules of the mailbox for its incoming mail (ADR-0008): its filters, in the order they
 * run, and its blocked senders. Everyone who reads the mailbox sees them; an owner changes
 * them, because in a shared mailbox a rule decides where everyone's mail goes.
 */
export default function FilterSettings({
	mailboxId,
	canChange,
}: {
	mailboxId: string;
	/** Only an owner of the mailbox changes its rules. */
	canChange: boolean;
}) {
	const { data, isError } = useRules(mailboxId);
	const { data: labels = [] } = useLabels(mailboxId);
	const saveRules = useSaveRules();
	const blockSender = useBlockSender();
	const unblockSender = useUnblockSender();
	const confirm = useConfirm();
	const toasts = useKumoToastManager();
	const [editing, setEditing] = useState<Rule | "new" | null>(null);
	const [sender, setSender] = useState("");
	const [senderError, setSenderError] = useState<string | null>(null);
	const rules = data?.rules ?? [];
	const blocked = data?.blocked ?? [];
	const labelName = (id: string) => labels.find((label) => label.id === id)?.name;

	async function save(next: Rule[]) {
		try {
			await saveRules.mutateAsync({ mailboxId, rules: next });
		} catch {
			toasts.add({ title: t("The filters could not be saved"), variant: "error" });
		}
	}

	function move(index: number, by: -1 | 1) {
		const next = [...rules];
		const [rule] = next.splice(index, 1);
		if (rule === undefined) return;
		next.splice(index + by, 0, rule);
		void save(next);
	}

	async function remove(rule: Rule) {
		const sure = await confirm({
			title: t("Delete this filter?"),
			body: t(
				"Mail that arrives from now on is no longer filed by it. No mail is deleted or moved.",
			),
			action: t("Delete filter"),
			destructive: true,
		});
		if (sure) await save(rules.filter((one) => one.id !== rule.id));
	}

	async function block(event: FormEvent) {
		event.preventDefault();
		setSenderError(null);
		const wanted = blockedSenderOf(sender);
		if (wanted === null) {
			setSenderError(t("Give an address, or a domain such as example.com."));
			return;
		}
		try {
			await blockSender.mutateAsync({ mailboxId, sender: wanted });
			setSender("");
		} catch {
			setSenderError(t("The sender could not be blocked."));
		}
	}

	async function unblock(one: string) {
		try {
			await unblockSender.mutateAsync({ mailboxId, sender: one });
		} catch {
			toasts.add({ title: t("The sender could not be unblocked"), variant: "error" });
		}
	}

	if (isError) {
		return (
			<p role="alert" className="py-10 text-center text-sm text-kumo-danger">
				{t("The filters could not be loaded.")}
			</p>
		);
	}

	return (
		<div className="space-y-10">
			<section aria-labelledby="filters-heading">
				<div className="flex items-center justify-between gap-4 border-b border-kumo-line pb-4">
					<div>
						<h3 id="filters-heading" className="m-0 text-sm font-semibold text-kumo-default">
							{t("Filters")}
						</h3>
						<p className="m-0 mt-1 text-xs text-kumo-subtle">
							{t(
								"A filter files mail when it arrives, for everyone who uses this mailbox. Filters run from the top; when two disagree about the place, Trash wins over Spam, and Spam over Archive. {count} of {limit}.",
								{ count: rules.length, limit: RULE_LIMITS.rules },
							)}
						</p>
					</div>
					{canChange && (
						<Button
							variant="secondary"
							size="sm"
							icon={<PlusIcon size={14} />}
							disabled={rules.length >= RULE_LIMITS.rules}
							onClick={() => setEditing("new")}
						>
							{t("New filter")}
						</Button>
					)}
				</div>
				{rules.length === 0 ? (
					<p className="py-8 text-center text-sm text-kumo-subtle">
						{t("This mailbox has no filters yet.")}
					</p>
				) : (
					<ol className="m-0 list-none p-0">
						{rules.map((rule, index) => (
							<li
								key={rule.id}
								className="flex items-start gap-3 border-b border-kumo-line py-3 text-sm"
							>
								<div className="min-w-0 flex-1">
									<ul className="m-0 list-none p-0 text-kumo-default">
										{conditionWords(rule.conditions).map((words) => (
											<li key={words} className="break-words">
												{words}
											</li>
										))}
									</ul>
									<ul className="m-0 mt-1 list-none p-0 text-xs text-kumo-subtle">
										{actionWords(rule.actions, labelName).map((words) => (
											<li key={words} className="break-words">
												{words}
											</li>
										))}
									</ul>
								</div>
								{canChange && (
									<div className="flex shrink-0 items-center gap-0.5">
										<IconButton
											label={t("Move this filter up")}
											icon={<ArrowUpIcon size={14} />}
											disabled={index === 0 || saveRules.isPending}
											onClick={() => move(index, -1)}
										/>
										<IconButton
											label={t("Move this filter down")}
											icon={<ArrowDownIcon size={14} />}
											disabled={index === rules.length - 1 || saveRules.isPending}
											onClick={() => move(index, 1)}
										/>
										<Button variant="ghost" size="sm" onClick={() => setEditing(rule)}>
											{t("Edit")}
										</Button>
										<Button variant="ghost" size="sm" onClick={() => void remove(rule)}>
											{t("Delete")}
										</Button>
									</div>
								)}
							</li>
						))}
					</ol>
				)}
			</section>

			<section aria-labelledby="blocked-heading">
				<div className="border-b border-kumo-line pb-4">
					<h3 id="blocked-heading" className="m-0 text-sm font-semibold text-kumo-default">
						{t("Blocked senders")}
					</h3>
					<p className="m-0 mt-1 text-xs text-kumo-subtle">
						{t(
							"Mail from a blocked sender goes to Spam when it arrives. Nobody is told that they are blocked. {count} of {limit}.",
							{ count: blocked.length, limit: RULE_LIMITS.blocked },
						)}
					</p>
				</div>
				{canChange && (
					<form onSubmit={block} className="flex max-w-md items-end gap-2 py-4">
						<div className="min-w-0 flex-1">
							<Input
								label={t("An address or a domain")}
								size="sm"
								value={sender}
								placeholder={EXAMPLE_DOMAIN}
								onChange={(event) => setSender(event.target.value)}
							/>
						</div>
						<Button
							type="submit"
							variant="secondary"
							size="sm"
							loading={blockSender.isPending}
							disabled={sender.trim() === "" || blocked.length >= RULE_LIMITS.blocked}
						>
							{t("Block")}
						</Button>
					</form>
				)}
				{senderError && (
					<p role="alert" className="m-0 pb-3 text-sm text-kumo-danger">
						{senderError}
					</p>
				)}
				{blocked.length === 0 ? (
					<p className="py-8 text-center text-sm text-kumo-subtle">
						{t("This mailbox blocks no sender.")}
					</p>
				) : (
					<ul className="m-0 list-none p-0">
						{blocked.map((one) => (
							<li
								key={one.sender}
								className="flex items-center justify-between gap-3 border-b border-kumo-line py-2 text-sm"
							>
								<span className="min-w-0 break-all text-kumo-default">
									{blockedWords(one.sender)}
								</span>
								{canChange && (
									<Button variant="ghost" size="sm" onClick={() => void unblock(one.sender)}>
										{t("Unblock")}
									</Button>
								)}
							</li>
						))}
					</ul>
				)}
				{!canChange && (
					<p className="m-0 pt-4 text-xs text-kumo-subtle">
						{t("An owner of this mailbox can change its filters and blocked senders.")}
					</p>
				)}
			</section>

			<FilterDialog
				open={editing !== null}
				onOpenChange={(open) => {
					if (!open) setEditing(null);
				}}
				mailboxId={mailboxId}
				rules={rules}
				rule={editing === "new" || editing === null ? undefined : editing}
			/>
		</div>
	);
}
