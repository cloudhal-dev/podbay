// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { Badge, Button, Input } from "@cloudflare/kumo";
import { type FormEvent, useState } from "react";
import { useAccessKeys, useCreateAccessKey, useRevokeAccessKey } from "~/queries/access-keys";
import { useMailboxes } from "~/queries/mailboxes";
import { ApiError } from "~/services/api";
import type { AccessKey, CreatedAccessKey } from "~/types";
import CopyButton from "./CopyButton";

const LIFETIMES = [
	{ days: 30, label: "30 days" },
	{ days: 90, label: "90 days" },
	{ days: 365, label: "1 year" },
	{ days: 0, label: "No end date" },
];
const SELECT_CLASS =
	"h-8 w-full rounded-md border border-kumo-line bg-kumo-base px-2 text-sm text-kumo-default";
const LABEL_CLASS = "text-xs font-medium text-kumo-strong mb-1 block";

function day(value: string): string {
	return new Date(value).toLocaleDateString(undefined, { dateStyle: "medium" });
}

/** The token of a key that was just made. It exists only in this component's state. */
function NewKey({ created, onDone }: { created: CreatedAccessKey; onDone: () => void }) {
	return (
		<div className="rounded-lg border border-kumo-line bg-kumo-tint p-3 space-y-2">
			<p className="text-xs font-medium text-kumo-default">
				Copy this key now. It is shown only once and cannot be recovered.
			</p>
			<div className="flex items-start gap-1">
				<code className="flex-1 break-all rounded-md bg-kumo-base px-2 py-1.5 text-[11px] text-kumo-default">
					{created.token}
				</code>
				<CopyButton text={created.token} label="Copy the key" />
			</div>
			<p className="text-xs text-kumo-subtle leading-relaxed">
				In your AI client, add a remote MCP server with the URL above and the header{" "}
				<code className="text-kumo-default">Authorization: Bearer</code> followed by this key.
			</p>
			<Button variant="secondary" size="sm" onClick={onDone}>
				I have copied it
			</Button>
		</div>
	);
}

function CreateKey({ currentMailbox }: { currentMailbox: string | undefined }) {
	const { data: mailboxes = [] } = useMailboxes();
	const create = useCreateAccessKey();
	const [name, setName] = useState("");
	const [access, setAccess] = useState<"read" | "write">("read");
	const [lifetime, setLifetime] = useState(90);
	const [chosen, setChosen] = useState<string[] | null>(null);
	const [created, setCreated] = useState<CreatedAccessKey | null>(null);
	const [error, setError] = useState<string | null>(null);

	// Until the person chooses, the key covers the mailbox they are looking at and nothing else.
	const selected = chosen ?? (currentMailbox ? [currentMailbox] : []);
	const readerOnly = mailboxes.filter((m) => selected.includes(m.id) && m.role === "reader");

	function toggle(id: string) {
		setChosen(selected.includes(id) ? selected.filter((m) => m !== id) : [...selected, id]);
	}

	async function submit(event: FormEvent) {
		event.preventDefault();
		setError(null);
		setCreated(null);
		try {
			setCreated(
				await create.mutateAsync({
					name: name.trim(),
					access,
					mailboxes: selected,
					...(lifetime > 0 ? { expiresInDays: lifetime } : {}),
				}),
			);
			setName("");
		} catch (caught) {
			setError(caught instanceof ApiError ? caught.message : "The key could not be created.");
		}
	}

	if (created) return <NewKey created={created} onDone={() => setCreated(null)} />;

	return (
		<form onSubmit={submit} className="space-y-3">
			<Input
				label="Name"
				className="w-full"
				id="key-name"
				size="sm"
				placeholder="Where this key will be used"
				value={name}
				maxLength={80}
				onChange={(e) => setName(e.target.value)}
				required
			/>
			<fieldset>
				<legend className={LABEL_CLASS}>Mailboxes</legend>
				<div className="rounded-md border border-kumo-line divide-y divide-kumo-line">
					{mailboxes.map((mailbox) => (
						<label
							key={mailbox.id}
							className="flex items-center gap-2 px-2.5 py-1.5 text-xs text-kumo-default cursor-pointer"
						>
							<input
								type="checkbox"
								checked={selected.includes(mailbox.id)}
								onChange={() => toggle(mailbox.id)}
							/>
							<span className="truncate">{mailbox.email}</span>
						</label>
					))}
				</div>
			</fieldset>
			<div className="grid grid-cols-2 gap-2">
				<div>
					<label htmlFor="key-access" className={LABEL_CLASS}>
						Access
					</label>
					<select
						id="key-access"
						value={access}
						onChange={(e) => setAccess(e.target.value === "write" ? "write" : "read")}
						className={SELECT_CLASS}
					>
						<option value="read">Read only</option>
						<option value="write">Read, organise, draft</option>
					</select>
				</div>
				<div>
					<label htmlFor="key-lifetime" className={LABEL_CLASS}>
						Valid for
					</label>
					<select
						id="key-lifetime"
						value={lifetime}
						onChange={(e) => setLifetime(Number(e.target.value))}
						className={SELECT_CLASS}
					>
						{LIFETIMES.map((option) => (
							<option key={option.days} value={option.days}>
								{option.label}
							</option>
						))}
					</select>
				</div>
			</div>
			{access === "write" && readerOnly.length > 0 && (
				<p className="text-xs text-kumo-subtle">
					You can only read {readerOnly.map((m) => m.email).join(", ")}, so this key will only read
					there too.
				</p>
			)}
			{error && (
				<p role="alert" className="text-xs text-kumo-danger">
					{error}
				</p>
			)}
			<Button
				type="submit"
				variant="primary"
				size="sm"
				loading={create.isPending}
				disabled={selected.length === 0}
			>
				Create key
			</Button>
		</form>
	);
}

function KeyRow({ accessKey }: { accessKey: AccessKey }) {
	const revoke = useRevokeAccessKey();
	const [confirming, setConfirming] = useState(false);
	const active = accessKey.state === "active";

	return (
		<li className={`px-3 py-2.5 space-y-1 ${active ? "" : "opacity-60"}`}>
			<div className="flex items-center gap-2">
				<span className="min-w-0 flex-1 truncate text-xs font-medium text-kumo-default">
					{accessKey.name}
				</span>
				<Badge variant={active ? "secondary" : "outline"}>
					{active
						? accessKey.access === "write"
							? "Read and draft"
							: "Read only"
						: accessKey.state}
				</Badge>
			</div>
			<p className="text-[11px] text-kumo-subtle break-all">
				<span className="font-mono">…{accessKey.hint}</span> · {accessKey.mailboxes.join(", ")}
			</p>
			<p className="text-[11px] text-kumo-subtle">
				{accessKey.lastUsedAt ? `Last used ${day(accessKey.lastUsedAt)}` : "Never used"}
				{accessKey.expiresAt ? ` · ends ${day(accessKey.expiresAt)}` : " · no end date"}
			</p>
			{active &&
				(confirming ? (
					<div className="flex items-center gap-2 pt-1">
						<span className="text-[11px] text-kumo-default">Stop this key working?</span>
						<Button
							variant="destructive"
							size="xs"
							loading={revoke.isPending}
							onClick={() => revoke.mutate(accessKey.id)}
						>
							Revoke
						</Button>
						<Button variant="ghost" size="xs" onClick={() => setConfirming(false)}>
							Cancel
						</Button>
					</div>
				) : (
					<Button variant="ghost" size="xs" onClick={() => setConfirming(true)}>
						Revoke
					</Button>
				))}
			{revoke.isError && (
				<p role="alert" className="text-[11px] text-kumo-danger">
					The key could not be revoked.
				</p>
			)}
		</li>
	);
}

/** The signed-in person's keys for AI clients: make one, see them, revoke one. */
export default function AccessKeys({ currentMailbox }: { currentMailbox: string | undefined }) {
	const { data: keys = [], isError } = useAccessKeys();
	const active = keys.filter((k) => k.state === "active");
	// Keys that no longer work stay visible for a while, so a refused client can be explained.
	const ended = keys.filter((k) => k.state !== "active").slice(0, 3);

	return (
		<div className="space-y-4">
			<section className="space-y-2">
				<h4 className="text-xs uppercase tracking-wider font-semibold text-kumo-subtle">New key</h4>
				<CreateKey currentMailbox={currentMailbox} />
			</section>
			<section className="space-y-2">
				<h4 className="text-xs uppercase tracking-wider font-semibold text-kumo-subtle">
					Your keys
				</h4>
				{isError ? (
					<p role="alert" className="text-xs text-kumo-danger">
						Your keys could not be loaded.
					</p>
				) : active.length + ended.length === 0 ? (
					<p className="text-xs text-kumo-subtle">You have no keys yet.</p>
				) : (
					<ul className="border border-kumo-line rounded-lg divide-y divide-kumo-line">
						{[...active, ...ended].map((accessKey) => (
							<KeyRow key={accessKey.id} accessKey={accessKey} />
						))}
					</ul>
				)}
			</section>
		</div>
	);
}
