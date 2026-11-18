// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { Input, LayerDialog } from "@cloudflare/kumo";
import { type FormEvent, useEffect, useState } from "react";
import {
	RULE_LIMITS,
	type Rule,
	type RuleActions,
	type RuleConditions,
	type RuleMatch,
	type RulePlace,
} from "shared/rules";
import { t } from "~/i18n";
import { labelDot } from "~/lib/labels";
import { useLabels } from "~/queries/labels";
import { type RuleDraft, useSaveRules } from "~/queries/rules";

const NATIVE_FIELD =
	"h-9 rounded-lg border border-kumo-line bg-kumo-control px-2 text-sm text-kumo-default";

interface Form {
	fromMatch: RuleMatch;
	from: string;
	toMatch: RuleMatch;
	to: string;
	subject: string;
	words: string;
	hasAttachment: boolean;
	place: "inbox" | RulePlace;
	read: boolean;
	star: boolean;
	labels: string[];
}

function formOf(conditions: RuleConditions = {}, actions: RuleActions = {}): Form {
	return {
		fromMatch: conditions.from?.match ?? "contains",
		from: conditions.from?.value ?? "",
		toMatch: conditions.to?.match ?? "contains",
		to: conditions.to?.value ?? "",
		subject: conditions.subject ?? "",
		words: conditions.words ?? "",
		hasAttachment: conditions.hasAttachment === true,
		place: actions.place ?? "inbox",
		read: actions.read === true,
		star: actions.star === true,
		labels: actions.labels ?? [],
	};
}

/** The rule a filled form is. A field left empty is no condition. */
function ruleOf(form: Form): { conditions: RuleConditions; actions: RuleActions } {
	const conditions: RuleConditions = {};
	if (form.from.trim() !== "") conditions.from = { match: form.fromMatch, value: form.from.trim() };
	if (form.to.trim() !== "") conditions.to = { match: form.toMatch, value: form.to.trim() };
	if (form.subject.trim() !== "") conditions.subject = form.subject.trim();
	if (form.words.trim() !== "") conditions.words = form.words.trim();
	if (form.hasAttachment) conditions.hasAttachment = true;
	const actions: RuleActions = {};
	if (form.place !== "inbox") actions.place = form.place;
	if (form.read) actions.read = true;
	if (form.star) actions.star = true;
	if (form.labels.length > 0) actions.labels = form.labels;
	return { conditions, actions };
}

function Match({
	name,
	value,
	onChange,
}: {
	name: string;
	value: RuleMatch;
	onChange: (value: RuleMatch) => void;
}) {
	return (
		<select
			aria-label={name}
			className={NATIVE_FIELD}
			value={value}
			onChange={(event) => onChange(event.target.value === "is" ? "is" : "contains")}
		>
			<option value="contains">{t("contains")}</option>
			<option value="is">{t("is exactly")}</option>
		</select>
	);
}

/**
 * Make a filter, or change one (ADR-0008). A filter is what the form says and nothing else:
 * its conditions are plain words, compared without regard to case, and all of them must hold.
 * It acts on mail that arrives from now on, never on mail that is already here.
 */
export default function FilterDialog({
	open,
	onOpenChange,
	mailboxId,
	rules,
	rule,
	like,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	mailboxId: string;
	/** The filters the mailbox has now: the one that is saved joins or replaces one of them. */
	rules: readonly Rule[];
	/** The filter to change; leave out to make a new one. */
	rule?: Rule;
	/** What a new filter starts with: "Filter messages like this". */
	like?: RuleConditions;
}) {
	const { data: labels = [] } = useLabels(mailboxId);
	const saveRules = useSaveRules();
	const [form, setForm] = useState<Form>(formOf());
	const [error, setError] = useState<string | null>(null);
	const set = (change: Partial<Form>) => setForm((held) => ({ ...held, ...change }));

	// biome-ignore lint/correctness/useExhaustiveDependencies: filled once, when the dialog opens
	useEffect(() => {
		if (!open) return;
		setForm(rule ? formOf(rule.conditions, rule.actions) : formOf(like));
		setError(null);
	}, [open]);

	const made = ruleOf(form);
	const noCondition = Object.keys(made.conditions).length === 0;
	const noAction = Object.keys(made.actions).length === 0;
	const full = rule === undefined && rules.length >= RULE_LIMITS.rules;

	async function submit(event: FormEvent) {
		event.preventDefault();
		event.stopPropagation();
		if (noCondition || noAction || full) return;
		setError(null);
		const next: RuleDraft[] = rule
			? rules.map((one) => (one.id === rule.id ? { id: rule.id, ...made } : one))
			: [...rules, made];
		try {
			await saveRules.mutateAsync({ mailboxId, rules: next });
			onOpenChange(false);
		} catch {
			setError(t("The filter could not be saved."));
		}
	}

	const toggleLabel = (id: string, give: boolean) =>
		set({ labels: give ? [...form.labels, id] : form.labels.filter((one) => one !== id) });

	return (
		<LayerDialog.Root open={open} onOpenChange={onOpenChange}>
			<LayerDialog.Content size="base">
				<LayerDialog.Title>{rule ? t("Edit filter") : t("New filter")}</LayerDialog.Title>
				<LayerDialog.Description>
					{t(
						"A filter acts on mail when it arrives, not on mail that is already here. Words are compared as they are written, without regard to capitals.",
					)}
				</LayerDialog.Description>
				<LayerDialog.Body>
					<form id="filter-form" onSubmit={submit} className="flex flex-col gap-6">
						<fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
							<legend className="mb-3 text-sm font-semibold text-kumo-default">
								{t("When a message arrives and all of this is true")}
							</legend>
							<div className="flex items-end gap-2">
								<Match
									name={t("How the sender is compared")}
									value={form.fromMatch}
									onChange={(fromMatch) => set({ fromMatch })}
								/>
								<div className="min-w-0 flex-1">
									<Input
										label={t("The sender")}
										size="sm"
										value={form.from}
										maxLength={RULE_LIMITS.condition}
										onChange={(event) => set({ from: event.target.value })}
									/>
								</div>
							</div>
							<div className="flex items-end gap-2">
								<Match
									name={t("How a recipient is compared")}
									value={form.toMatch}
									onChange={(toMatch) => set({ toMatch })}
								/>
								<div className="min-w-0 flex-1">
									<Input
										label={t("A recipient")}
										size="sm"
										value={form.to}
										maxLength={RULE_LIMITS.condition}
										onChange={(event) => set({ to: event.target.value })}
									/>
								</div>
							</div>
							<Input
								label={t("The subject contains")}
								size="sm"
								value={form.subject}
								maxLength={RULE_LIMITS.condition}
								onChange={(event) => set({ subject: event.target.value })}
							/>
							<Input
								label={t("The message has the words")}
								size="sm"
								value={form.words}
								maxLength={RULE_LIMITS.condition}
								onChange={(event) => set({ words: event.target.value })}
							/>
							<label className="flex cursor-pointer items-center gap-2 text-sm text-kumo-default">
								<input
									type="checkbox"
									className="h-4 w-4"
									checked={form.hasAttachment}
									onChange={(event) => set({ hasAttachment: event.target.checked })}
								/>
								{t("It has an attachment")}
							</label>
						</fieldset>

						<fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
							<legend className="mb-3 text-sm font-semibold text-kumo-default">
								{t("Do this")}
							</legend>
							<div>
								<label
									htmlFor="filter-place"
									className="mb-1.5 block text-sm font-medium text-kumo-default"
								>
									{t("Where it goes")}
								</label>
								<select
									id="filter-place"
									className={`${NATIVE_FIELD} w-full`}
									value={form.place}
									onChange={(event) => set({ place: event.target.value as Form["place"] })}
								>
									<option value="inbox">{t("Leave it in the Inbox")}</option>
									<option value="archive">{t("Skip the Inbox")}</option>
									<option value="trash">{t("Move to Trash")}</option>
									<option value="spam">{t("Move to Spam")}</option>
								</select>
							</div>
							<label className="flex cursor-pointer items-center gap-2 text-sm text-kumo-default">
								<input
									type="checkbox"
									className="h-4 w-4"
									checked={form.read}
									onChange={(event) => set({ read: event.target.checked })}
								/>
								{t("Mark as read")}
							</label>
							<label className="flex cursor-pointer items-center gap-2 text-sm text-kumo-default">
								<input
									type="checkbox"
									className="h-4 w-4"
									checked={form.star}
									onChange={(event) => set({ star: event.target.checked })}
								/>
								{t("Star it")}
							</label>
							{labels.length > 0 && (
								<fieldset className="m-0 border-0 p-0">
									<legend className="mb-1.5 text-sm font-medium text-kumo-default">
										{t("Give it these labels")}
									</legend>
									<div className="flex max-h-32 flex-col gap-1.5 overflow-y-auto">
										{labels.map((label) => {
											const given = form.labels.includes(label.id);
											return (
												<label
													key={label.id}
													className="flex cursor-pointer items-center gap-2 text-sm text-kumo-default"
												>
													<input
														type="checkbox"
														className="h-4 w-4"
														checked={given}
														disabled={!given && form.labels.length >= RULE_LIMITS.labels}
														onChange={(event) => toggleLabel(label.id, event.target.checked)}
													/>
													<span
														className={`h-2 w-2 rounded-full ${labelDot(label.color)}`}
														aria-hidden="true"
													/>
													{label.name}
												</label>
											);
										})}
									</div>
								</fieldset>
							)}
						</fieldset>

						{(noCondition || noAction) && (
							<p className="m-0 text-xs text-kumo-subtle">
								{noCondition
									? t("Say at least one thing the filter looks for.")
									: t("Say at least one thing the filter does.")}
							</p>
						)}
						{full && (
							<p role="alert" className="m-0 text-sm text-kumo-danger">
								{t("This mailbox has as many filters as it can hold.")}
							</p>
						)}
						{error && (
							<p role="alert" className="m-0 text-sm text-kumo-danger">
								{error}
							</p>
						)}
					</form>
				</LayerDialog.Body>
				<LayerDialog.Actions dismissLabel={t("Cancel")}>
					<LayerDialog.Action
						type="submit"
						form="filter-form"
						loading={saveRules.isPending}
						disabled={noCondition || noAction || full}
					>
						{rule ? t("Save") : t("Create filter")}
					</LayerDialog.Action>
				</LayerDialog.Actions>
			</LayerDialog.Content>
		</LayerDialog.Root>
	);
}
