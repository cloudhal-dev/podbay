// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { useKumoToastManager } from "@cloudflare/kumo";
import { SEND_CODES, SENDING, type SendAnswer } from "@podbay/mail/shared";
import { useDisplay } from "~/hooks/useDisplay";
import { type ComposeOptions, useUIStore } from "~/hooks/useUIStore";
import { t } from "~/i18n";
import { reasonWords, timeWords } from "~/lib/sending-words";
import { useInvalidateEmailData } from "~/queries/emails";
import api, { ApiError } from "~/services/api";

/** How a message is sent: as a new one, or as an answer to or a forward of another. */
export type SendRoute =
	| { kind: "new" }
	| { kind: "reply"; emailId: string }
	| { kind: "forward"; emailId: string };

export interface SendRequest {
	route: SendRoute;
	/** The message as the send routes take it: who, what, and the draft it is sent from. */
	email: Record<string, unknown>;
	/** A time the person chose, as an instant in UTC. Without one it is an ordinary send. */
	sendAt?: string;
	/** How the message was being written, so that Undo opens it the same way again. */
	compose?: Pick<ComposeOptions, "mode" | "originalEmail">;
	/** What the note says once the message has left, when it is more than "Message sent". */
	said?: string;
}

/** How often the app looks for the mailbox's word after the window, a second apart. */
const LOOKS = 20;
const wait = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const codeOf = (error: unknown) => (error instanceof ApiError ? error.body.code : undefined);

/**
 * Sending, as a person sees it (ADR-0016). The mailbox takes a message and lets it leave
 * later, so the app never says "sent" at the press: it offers Undo for the window the person
 * chose, and says "sent" when the mailbox does. A message sent later is said to be scheduled,
 * with its time. A message that could not leave is said so, with the reason.
 */
export function useSending(mailboxId: string | undefined) {
	const toasts = useKumoToastManager();
	const invalidate = useInvalidateEmailData();
	const undoSeconds = useDisplay((state) => state.undoSeconds);

	/** Opens a message that is a draft again in the compose window, as it was being written. */
	async function openDraft(box: string, id: string, compose?: SendRequest["compose"]) {
		const draft = await api.getEmail(box, id);
		const mode = compose?.mode ?? (draft.in_reply_to ? "reply" : "new");
		useUIStore
			.getState()
			.startCompose({ mode, originalEmail: compose?.originalEmail ?? null, draftEmail: draft });
	}

	/**
	 * Takes a waiting message back: it is a draft again, with the same files. With `open` the
	 * compose window opens on it. Says so when it is too late. Resolves to whether it was.
	 */
	async function takeBack(
		id: string,
		options: { open?: boolean; compose?: SendRequest["compose"] } = {},
	): Promise<boolean> {
		if (!mailboxId) return false;
		try {
			await api.unsend(mailboxId, id);
		} catch (error) {
			toasts.add({
				title:
					codeOf(error) === SEND_CODES.started
						? t("The message has already gone.")
						: t("The message could not be taken back."),
				variant: "error",
			});
			invalidate(mailboxId);
			return false;
		}
		invalidate(mailboxId);
		if (options.open !== false) {
			await openDraft(mailboxId, id, options.compose).catch(() => undefined);
		}
		return true;
	}

	/** Looks for what the mailbox says of a message until it has left or failed, and says it. */
	async function sayWhenGone(box: string, id: string, said?: string): Promise<void> {
		for (let look = 0; look < LOOKS; look++) {
			// The mailbox holds a message two seconds longer than the window; the first look
			// comes a moment after that.
			await wait(look === 0 ? SENDING.marginMs + 500 : 1000);
			const email = await api.getEmail(box, id).catch(() => null);
			const submission = email?.submission;
			// Gone, or taken back somewhere else: there is nothing to say.
			if (email === null || submission === undefined) return;
			if (submission.state === "sent") {
				invalidate(box);
				toasts.add({ title: said ?? t("Message sent") });
				return;
			}
			if (submission.state === "failed") {
				invalidate(box);
				toasts.add({
					title: t("Message not sent. It is in Drafts again."),
					description: reasonWords(submission.error),
					variant: "error",
					timeout: 0,
				});
				return;
			}
		}
		toasts.add({
			title: t("The message has not left yet"),
			description: t("It waits in Scheduled and leaves as soon as it can."),
		});
	}

	/** After an ordinary send: Undo for the window, then the mailbox's own word. */
	function offerUndo(box: string, answer: SendAnswer, request: SendRequest): void {
		let over = false;
		const undo = () => {
			if (over) return;
			over = true;
			toasts.close(note);
			void takeBack(answer.id, { compose: request.compose }).then((back) => {
				if (back) toasts.add({ title: t("Sending undone. The message is a draft again.") });
			});
		};
		const note: string = toasts.add({
			title: t("Sending…"),
			description: t("You can still take it back."),
			timeout: 0,
			actions: [{ children: t("Undo"), variant: "ghost", onClick: undo }],
		});
		// Undo is offered only while it can still work: for the window, and not a moment more.
		setTimeout(() => {
			if (over) return;
			over = true;
			toasts.close(note);
			void sayWhenGone(box, answer.id, request.said);
		}, undoSeconds * 1000);
	}

	/**
	 * Hands a message to the mailbox. It throws what the Worker refused, for the screen that
	 * asked to show; when the mailbox took it, the notes that follow are this hook's.
	 */
	async function send(request: SendRequest): Promise<SendAnswer> {
		if (!mailboxId) throw new Error(t("No mailbox selected."));
		const box = mailboxId;
		const email = {
			...request.email,
			undo_seconds: undoSeconds,
			...(request.sendAt === undefined ? {} : { send_at: request.sendAt }),
		};
		const { route } = request;
		const answer =
			route.kind === "reply"
				? await api.replyToEmail(box, route.emailId, email)
				: route.kind === "forward"
					? await api.forwardEmail(box, route.emailId, email)
					: await api.sendEmail(box, email);
		invalidate(box);
		// The mailbox says when it leaves. A time nearer than the window is an ordinary send.
		const later =
			request.sendAt !== undefined && Date.parse(answer.send_at) === Date.parse(request.sendAt);
		if (!later) {
			offerUndo(box, answer, request);
			return answer;
		}
		const note: string = toasts.add({
			title: t("Send scheduled for {time}", { time: timeWords(answer.send_at) }),
			actions: [
				{
					children: t("Undo"),
					variant: "ghost",
					onClick: () => {
						toasts.close(note);
						void takeBack(answer.id, { compose: request.compose });
					},
				},
			],
		});
		return answer;
	}

	/** Gives a waiting message a new time, or without one sends it now. */
	async function giveTime(id: string, sendAt?: string): Promise<boolean> {
		if (!mailboxId) return false;
		const box = mailboxId;
		try {
			const answer = await api.reschedule(box, id, sendAt);
			invalidate(box);
			if (sendAt === undefined) {
				toasts.add({ title: t("Sending…") });
				void sayWhenGone(box, id);
			} else {
				toasts.add({ title: t("Send scheduled for {time}", { time: timeWords(answer.send_at) }) });
			}
			return true;
		} catch (error) {
			invalidate(box);
			toasts.add({
				title:
					codeOf(error) === SEND_CODES.started
						? t("The message has already gone.")
						: t("The time could not be changed."),
				variant: "error",
			});
			return false;
		}
	}

	return { send, takeBack, giveTime };
}

export type Sending = ReturnType<typeof useSending>;
