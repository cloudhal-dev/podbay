// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { Input, LayerDialog } from "@cloudflare/kumo";
import { type FormEvent, useEffect, useState } from "react";
import { LABEL_LIMITS } from "shared/labels";
import { LABEL_PALETTE } from "~/lib/labels";
import { useCreateLabel, useUpdateLabel } from "~/queries/labels";
import type { Label } from "~/types";

/** Make a label, or change the name and colour of one. */
export default function LabelDialog({
	open,
	onOpenChange,
	mailboxId,
	label,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	mailboxId: string;
	/** The label to change; leave out to make a new one. */
	label?: Label;
}) {
	const createLabel = useCreateLabel();
	const updateLabel = useUpdateLabel();
	const [name, setName] = useState("");
	const [color, setColor] = useState(0);
	const [error, setError] = useState<string | null>(null);
	const busy = createLabel.isPending || updateLabel.isPending;

	// biome-ignore lint/correctness/useExhaustiveDependencies: filled once, when the dialog opens
	useEffect(() => {
		if (!open) return;
		setName(label?.name ?? "");
		setColor(label?.color ?? 0);
		setError(null);
	}, [open]);

	async function submit(event: FormEvent) {
		event.preventDefault();
		setError(null);
		try {
			if (label) await updateLabel.mutateAsync({ mailboxId, id: label.id, name, color });
			else await createLabel.mutateAsync({ mailboxId, name, color });
			onOpenChange(false);
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : "The label could not be saved.");
		}
	}

	return (
		<LayerDialog.Root open={open} onOpenChange={onOpenChange}>
			<LayerDialog.Content size="sm">
				<LayerDialog.Title>{label ? "Edit label" : "New label"}</LayerDialog.Title>
				<LayerDialog.Description>
					A conversation can carry several labels. A slash in the name nests it, as in Clients/Acme.
				</LayerDialog.Description>
				<LayerDialog.Body>
					<form id="label-form" onSubmit={submit} className="space-y-4">
						<Input
							label="Name"
							value={name}
							maxLength={LABEL_LIMITS.nameLength}
							onChange={(event) => setName(event.target.value)}
							required
						/>
						<fieldset className="m-0 border-0 p-0">
							<legend className="mb-1.5 text-sm font-medium text-kumo-default">Colour</legend>
							<div className="flex flex-wrap gap-2">
								{LABEL_PALETTE.map((tone, index) => (
									<label key={tone.name} className="cursor-pointer">
										<input
											type="radio"
											name="label-colour"
											className="peer sr-only"
											checked={color === index}
											onChange={() => setColor(index)}
										/>
										<span
											className={`block h-6 w-6 rounded-full ring-offset-2 ring-offset-kumo-base peer-checked:ring-2 peer-checked:ring-kumo-brand peer-focus-visible:ring-2 peer-focus-visible:ring-kumo-ring ${tone.dot}`}
										/>
										<span className="sr-only">{tone.name}</span>
									</label>
								))}
							</div>
						</fieldset>
						{error && (
							<p role="alert" className="text-sm text-kumo-danger">
								{error}
							</p>
						)}
					</form>
				</LayerDialog.Body>
				<LayerDialog.Actions dismissLabel="Cancel">
					<LayerDialog.Action
						type="submit"
						form="label-form"
						loading={busy}
						disabled={name.trim() === ""}
					>
						{label ? "Save" : "Create"}
					</LayerDialog.Action>
				</LayerDialog.Actions>
			</LayerDialog.Content>
		</LayerDialog.Root>
	);
}
