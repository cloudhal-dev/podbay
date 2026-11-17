// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified by the Podbay contributors.

import type {
	BulkChange,
	BulkCountAnswer,
	BulkFilter,
	BulkStepAnswer,
	BulkUndoAnswer,
	BulkUnit,
} from "shared/bulk";
import type { OriginalAnswer } from "shared/original";
import { t } from "~/i18n";
import type {
	AccessKey,
	CreatedAccessKey,
	Email,
	Folder,
	Label,
	Mailbox,
	MailboxRole,
	Member,
	MemberChange,
	RegistryMailbox,
} from "~/types";

const REQUEST_TIMEOUT_MS = 30_000;

export class ApiError extends Error {
	status: number;
	body: Record<string, unknown>;

	constructor(status: number, body: Record<string, unknown>) {
		super((body.error as string) || t("Request failed: {status}", { status }));
		this.name = "ApiError";
		this.status = status;
		this.body = body;
	}
}

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

	// Combine caller signal (e.g. TanStack Query abort) with our timeout signal
	const signal = options.signal
		? AbortSignal.any([options.signal, controller.signal])
		: controller.signal;

	try {
		const res = await fetch(url, {
			...options,
			signal,
			headers: {
				"Content-Type": "application/json",
				...(options.headers as Record<string, string>),
			},
		});

		if (!res.ok) {
			const body = await res.json().catch(() => ({}));
			throw new ApiError(res.status, body as Record<string, unknown>);
		}

		if (res.status === 204) return undefined as T;

		const contentType = res.headers.get("content-type") ?? "";
		if (contentType.includes("application/json")) {
			return res.json() as Promise<T>;
		}
		return res.blob() as unknown as T;
	} finally {
		clearTimeout(timeout);
	}
}

function get<T>(
	url: string,
	opts?: { params?: Record<string, string>; responseType?: string; signal?: AbortSignal },
) {
	const query = opts?.params ? `?${new URLSearchParams(opts.params)}` : "";
	return request<T>(`${url}${query}`, {
		method: "GET",
		signal: opts?.signal,
		...(opts?.responseType === "blob" ? { headers: { Accept: "*/*" } } : {}),
	});
}

function post<T>(url: string, body?: unknown, opts?: { signal?: AbortSignal }) {
	return request<T>(url, {
		method: "POST",
		signal: opts?.signal,
		body: body != null ? JSON.stringify(body) : undefined,
	});
}

function put<T>(url: string, body?: unknown) {
	return request<T>(url, {
		method: "PUT",
		body: body != null ? JSON.stringify(body) : undefined,
	});
}

function del<T>(url: string) {
	return request<T>(url, { method: "DELETE" });
}

/**
 * Sends the bytes of a declared file. Not `fetch`: a person waits for megabytes here, and only
 * this way says how far it is.
 */
function uploadDraftFile(
	mailboxId: string,
	draftId: string,
	fileId: string,
	file: File,
	onProgress: (part: number) => void,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const upload = new XMLHttpRequest();
		upload.open("PUT", `/api/v1/mailboxes/${mailboxId}/drafts/${draftId}/attachments/${fileId}`);
		upload.setRequestHeader("Content-Type", "application/octet-stream");
		upload.upload.onprogress = (event) => {
			if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total);
		};
		upload.onerror = () => reject(new ApiError(0, {}));
		upload.onload = () => {
			if (upload.status >= 200 && upload.status < 300) return resolve();
			let body: Record<string, unknown> = {};
			try {
				body = JSON.parse(upload.responseText) as Record<string, unknown>;
			} catch {
				// An answer that is not JSON says nothing more than its status.
			}
			reject(new ApiError(upload.status, body));
		};
		upload.send(file);
	});
}

// ---------- Typed response shapes ----------

/** What a save of a draft carries. */
export interface DraftToSave {
	to?: string;
	cc?: string;
	bcc?: string;
	subject?: string;
	body: string;
	in_reply_to?: string;
	thread_id?: string;
}

/** A file of a draft, as the Worker shows it once it is declared or copied. */
export interface DraftFileShown {
	id: string;
	filename: string;
	type: string;
	size: number;
}

/** Why a file of a forwarded message was not copied into the draft. */
export type DraftFileLeft = "risk" | "size" | "count" | "missing";

interface EmailListResponse {
	emails: Email[];
	totalCount: number;
}

// ---------- API client ----------

const api = {
	// Config
	getConfig: () =>
		get<{
			domains: string[];
			emailAddresses: string[];
			features: { agent: boolean; mcp: boolean };
		}>("/api/v1/config"),

	// Keys for programs
	listKeys: () => get<AccessKey[]>("/api/v1/keys"),
	createKey: (key: {
		name: string;
		access: "read" | "write";
		mailboxes: string[];
		expiresInDays?: number;
	}) => post<CreatedAccessKey>("/api/v1/keys", key),
	revokeKey: (keyId: string) => del<void>(`/api/v1/keys/${encodeURIComponent(keyId)}`),

	// Members of a mailbox
	listMembers: (mailboxId: string) =>
		get<Member[]>(`/api/v1/mailboxes/${encodeURIComponent(mailboxId)}/members`),
	memberHistory: (mailboxId: string) =>
		get<MemberChange[]>(`/api/v1/mailboxes/${encodeURIComponent(mailboxId)}/members/history`),
	addMember: (mailboxId: string, email: string, role: MailboxRole) =>
		post<Member[]>(`/api/v1/mailboxes/${encodeURIComponent(mailboxId)}/members`, { email, role }),
	setMemberRole: (mailboxId: string, userId: string, role: MailboxRole) =>
		put<Member[]>(
			`/api/v1/mailboxes/${encodeURIComponent(mailboxId)}/members/${encodeURIComponent(userId)}`,
			{ role },
		),
	removeMember: (mailboxId: string, userId: string) =>
		del<void>(
			`/api/v1/mailboxes/${encodeURIComponent(mailboxId)}/members/${encodeURIComponent(userId)}`,
		),
	/** Every mailbox on the instance. For owners and administrators. */
	listRegistry: () => get<RegistryMailbox[]>("/api/v1/registry/mailboxes"),

	// Mailboxes
	listMailboxes: () => get<Mailbox[]>("/api/v1/mailboxes"),
	createMailbox: (email: string, name: string, settings?: unknown) =>
		post<Mailbox>("/api/v1/mailboxes", { email, name, settings }),
	getMailbox: (mailboxId: string) => get<Mailbox>(`/api/v1/mailboxes/${mailboxId}`),
	updateMailbox: (mailboxId: string, settings: unknown) =>
		put<Mailbox>(`/api/v1/mailboxes/${mailboxId}`, { settings }),
	deleteMailbox: (mailboxId: string) => del<void>(`/api/v1/mailboxes/${mailboxId}`),

	// Emails
	listEmails: (
		mailboxId: string,
		params: Record<string, string>,
		opts?: { signal?: AbortSignal },
	) =>
		get<EmailListResponse | Email[]>(`/api/v1/mailboxes/${mailboxId}/emails`, {
			params,
			signal: opts?.signal,
		}),
	sendEmail: (mailboxId: string, email: unknown) =>
		post<void>(`/api/v1/mailboxes/${mailboxId}/emails`, email),
	getEmail: (mailboxId: string, id: string, opts?: { signal?: AbortSignal }) =>
		get<Email>(`/api/v1/mailboxes/${mailboxId}/emails/${id}`, { signal: opts?.signal }),
	/** The first part of a received message's original, as text (ADR-0015). */
	getOriginal: (mailboxId: string, id: string, opts?: { signal?: AbortSignal }) =>
		get<OriginalAnswer>(`/api/v1/mailboxes/${mailboxId}/emails/${id}/original`, {
			signal: opts?.signal,
		}),
	updateEmail: (mailboxId: string, id: string, data: unknown) =>
		put<Email>(`/api/v1/mailboxes/${mailboxId}/emails/${id}`, data),
	deleteEmail: (mailboxId: string, id: string) =>
		del<void>(`/api/v1/mailboxes/${mailboxId}/emails/${id}`),
	/** Deletes one batch of what Trash or Spam held at `before`; call again while `more`. */
	emptyPlace: (mailboxId: string, place: string, before?: string) =>
		post<{ deleted: number; more: boolean; before: string }>(
			`/api/v1/mailboxes/${mailboxId}/folders/${place}/empty`,
			before === undefined ? {} : { before },
		),
	/** One request for the ticked lines: it acts at once and says what it changed (ADR-0014). */
	actOnLines: (mailboxId: string, body: { ids: string[]; unit: BulkUnit; change: BulkChange }) =>
		post<BulkStepAnswer>(`/api/v1/mailboxes/${mailboxId}/bulk`, body),
	/** Counts what a filter finds and changes nothing; `runDeed` then acts on what was counted. */
	askDeed: (mailboxId: string, body: { filter: BulkFilter; unit: BulkUnit; change: BulkChange }) =>
		post<BulkCountAnswer>(`/api/v1/mailboxes/${mailboxId}/bulk`, body),
	/** One step of a counted deed; call again while `more`. */
	runDeed: (mailboxId: string, deed: string) =>
		post<BulkStepAnswer>(`/api/v1/mailboxes/${mailboxId}/bulk/${deed}/run`),
	/** One step of taking a deed back, from the mailbox's record; call again while `more`. */
	undoDeed: (mailboxId: string, deed: string) =>
		post<BulkUndoAnswer>(`/api/v1/mailboxes/${mailboxId}/bulk/${deed}/undo`),
	moveEmail: (mailboxId: string, id: string, folderId: string) =>
		post<void>(`/api/v1/mailboxes/${mailboxId}/emails/${id}/move`, { folderId }),
	getThread: (mailboxId: string, threadId: string, opts?: { signal?: AbortSignal }) =>
		get<Email[]>(`/api/v1/mailboxes/${mailboxId}/threads/${threadId}`, { signal: opts?.signal }),
	markThreadRead: (mailboxId: string, threadId: string) =>
		post<void>(`/api/v1/mailboxes/${mailboxId}/threads/${threadId}/read`),
	getAttachment: (mailboxId: string, emailId: string, attachmentId: string) =>
		get<Blob>(`/api/v1/mailboxes/${mailboxId}/emails/${emailId}/attachments/${attachmentId}`, {
			responseType: "blob",
		}),
	/** Makes a draft, or with `id` saves over the draft that has it (ADR-0011). */
	saveDraft: (mailboxId: string, draft: DraftToSave, id?: string) =>
		id === undefined
			? post<{ id: string }>(`/api/v1/mailboxes/${mailboxId}/drafts`, draft)
			: put<{ id: string }>(`/api/v1/mailboxes/${mailboxId}/drafts/${id}`, draft),
	/** Declares a file of a draft; its bytes follow with `uploadDraftFile`. */
	declareDraftFile: (mailboxId: string, draftId: string, file: File) =>
		post<DraftFileShown>(`/api/v1/mailboxes/${mailboxId}/drafts/${draftId}/attachments`, {
			filename: file.name,
			type: file.type || "application/octet-stream",
			size: file.size,
		}),
	uploadDraftFile,
	removeDraftFile: (mailboxId: string, draftId: string, fileId: string) =>
		del<void>(`/api/v1/mailboxes/${mailboxId}/drafts/${draftId}/attachments/${fileId}`),
	/** Copies files of another message of the mailbox into a draft, inside the account. */
	copyDraftFiles: (
		mailboxId: string,
		draftId: string,
		body: { emailId: string; attachmentIds: string[]; acknowledged?: boolean },
	) =>
		post<{ copied: DraftFileShown[]; left: { id: string; reason: DraftFileLeft }[] }>(
			`/api/v1/mailboxes/${mailboxId}/drafts/${draftId}/attachments/copy`,
			body,
		),
	replyToEmail: (mailboxId: string, emailId: string, email: unknown) =>
		post<void>(`/api/v1/mailboxes/${mailboxId}/emails/${emailId}/reply`, email),
	forwardEmail: (mailboxId: string, emailId: string, email: unknown) =>
		post<void>(`/api/v1/mailboxes/${mailboxId}/emails/${emailId}/forward`, email),

	// Folders
	listFolders: (mailboxId: string) => get<Folder[]>(`/api/v1/mailboxes/${mailboxId}/folders`),

	// Labels (ADR-0007)
	listLabels: (mailboxId: string) => get<Label[]>(`/api/v1/mailboxes/${mailboxId}/labels`),
	createLabel: (mailboxId: string, label: { name: string; color: number }) =>
		post<Label>(`/api/v1/mailboxes/${mailboxId}/labels`, label),
	updateLabel: (mailboxId: string, id: string, change: { name?: string; color?: number }) =>
		put<Label>(`/api/v1/mailboxes/${mailboxId}/labels/${id}`, change),
	deleteLabel: (mailboxId: string, id: string) =>
		del<void>(`/api/v1/mailboxes/${mailboxId}/labels/${id}`),

	// Search
	searchEmails: (mailboxId: string, params: Record<string, string>) =>
		get<EmailListResponse | Email[]>(`/api/v1/mailboxes/${mailboxId}/search`, { params }),
};

export default api;
