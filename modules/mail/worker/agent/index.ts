// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified by the Podbay contributors.

import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import { errorFields, log } from "@podbay/platform/log";
import { createAI } from "agents/models/ai-sdk";
import {
	convertToModelMessages,
	type GenerateTextOnFinishCallback,
	stepCountIs,
	streamText,
	type ToolSet,
	type UIMessage,
} from "ai";
import { z } from "zod";
import { mailboxSettings } from "../auth/store";
import { MODELS } from "../lib/models";
import type { Env } from "../types";
import { autoTriggerLine, type NewEmailEvent, runAutoDraft } from "./auto-draft";
import { withFixedRules } from "./prompt";
import { createAgentTools } from "./tools";

/**
 * The assistant: a chat about one mailbox, and the automatic draft of a reply to new mail.
 *
 * It never sends (rule S9). Its tools are in `./tools`: they read, save drafts and file mail,
 * and they run with a send binding that refuses. The automatic draft is in `./auto-draft`.
 * This class never reads the send binding.
 */

/**
 * Default system prompt used when no custom prompt is configured for a mailbox.
 * Users can override this on a per-mailbox basis via the Settings UI.
 */
const DEFAULT_SYSTEM_PROMPT = `You are an email assistant that helps manage this inbox. You read emails, draft replies, and help organize conversations.

## Writing Style
Write like a real person. Short, direct, flowing prose. Get to the point. Plain text only - no HTML tags in your replies.

**Formatting rules:**
- Write in natural paragraphs. NO bullet points, NO numbered lists, NO dashes, NO markdown formatting in email drafts.
- NO bold (**), NO italic (*), NO headers (#), NO horizontal rules (---), NO code blocks. Plain text only.
- Links go inline in the text, not on separate lines.
- Don't structure replies like a template or form letter. Just talk normally.

**Agent Behavior Rules (CRITICAL):**
- NEVER output meta-commentary about what you are doing (e.g. do not say "I am drafting a reply to Alex", "I checked the thread", etc).
- When a new email arrives, your ONLY job is to call the \`draft_reply\` tool.
- DO NOT summarize the email. DO NOT explain your actions.
- Output NOTHING except the tool call. If you must output text, it should ONLY be the literal draft text itself if tools fail.
- Before drafting ANY reply, carefully read the full thread history.
- NEVER repeat information that was already shared in a prior message in the thread.
- Your reply should only contain NEW information or directly respond to what the person just said. Move the conversation forward, don't rehash it.

## Who Are You Replying To?
Use the name the person gives in their email body / signature. That's their name - use it. The "from" address is where you send the reply, but the name in the email is how you greet them.

## CRITICAL: Draft Only - Never Send
You can ONLY draft emails. You do NOT have the ability to send emails directly.

- Use draft_reply to draft replies to existing emails
- Use draft_email to draft new outbound emails
- The operator will review and send drafts from the UI - you cannot send them

**CRITICAL: The draft body must contain ONLY the email text.** Never include agent commentary, status messages, meta-notes, markdown formatting, or anything that isn't part of the actual email in the draft body. No "Draft created.", no "---", no "**bold**", no "Here's the draft:", no separators. The body field is the literal email the recipient will read. Everything else goes in your chat message, not in the draft body.

**Don't paste draft contents into the chat.** The drafts are saved via tools - the operator can see them in the Drafts folder. In your chat message, just briefly say what you drafted (e.g. "Drafted a reply to Tim"). Don't duplicate the full email body in the chat.

## Draft Management
Use discard_draft to delete drafts that the operator rejects or that are no longer needed.`;

/**
 * The system prompt for a mailbox: its own prompt from its settings, or the default, always
 * followed by the fixed rules.
 */
async function getSystemPrompt(env: Env, mailboxId: string): Promise<string> {
	try {
		const settings = await mailboxSettings(env.DB, mailboxId);
		if (
			settings &&
			typeof settings.agentSystemPrompt === "string" &&
			settings.agentSystemPrompt.trim()
		) {
			return withFixedRules(settings.agentSystemPrompt);
		}
	} catch {
		// Fall through to default
	}
	return withFixedRules(DEFAULT_SYSTEM_PROMPT);
}

/** The body of the internal `/onNewEmail` request, sent by the `email` handler. */
const newEmailEvent = z.object({
	mailboxId: z.string().min(1),
	emailId: z.string().min(1),
	sender: z.string(),
	subject: z.string(),
	threadId: z.string().min(1),
});

function textMessage(role: "user" | "assistant", text: string): UIMessage {
	return { id: crypto.randomUUID(), role, parts: [{ type: "text", text }] };
}

export class EmailAgent extends AIChatAgent<Env> {
	async onChatMessage(
		onFinish: GenerateTextOnFinishCallback<ToolSet>,
		options?: OnChatMessageOptions,
	) {
		const mailboxId = this.name;
		const workersai = createAI({ binding: this.env.AI });

		const result = streamText({
			model: workersai(MODELS.agentChat),
			system: await getSystemPrompt(this.env, mailboxId),
			messages: await convertToModelMessages(this.messages),
			tools: createAgentTools(this.env, mailboxId),
			stopWhen: stepCountIs(5),
			abortSignal: options?.abortSignal,
			onFinish,
		});

		return result.toUIMessageStreamResponse();
	}

	/**
	 * Handle HTTP requests to the agent DO. Intercepts /onNewEmail
	 * before passing to the default AIChatAgent handler.
	 */
	async onRequest(request: Request): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname === "/onNewEmail" && request.method === "POST") {
			const event = newEmailEvent.safeParse(await request.json().catch(() => null));
			if (!event.success) return Response.json({ error: "Invalid request" }, { status: 400 });
			try {
				return Response.json(await this.handleNewEmail(event.data));
			} catch (e) {
				log.error("agent.on_new_email_failed", errorFields(e));
				return Response.json({ error: "Auto-draft failed" }, { status: 500 });
			}
		}
		return super.onRequest(request);
	}

	/**
	 * Called when a new email arrives: runs the automatic draft and records the outcome in the
	 * chat history, so the person sees the draft, or why there is none. Nothing is sent.
	 */
	async handleNewEmail(event: NewEmailEvent) {
		const outcome = await runAutoDraft(
			{
				env: this.env,
				model: createAI({ binding: this.env.AI })(MODELS.agentChat),
				systemPrompt: await getSystemPrompt(this.env, event.mailboxId),
			},
			event,
		);
		if (outcome.chatText !== null) {
			await this.persistMessages([
				...this.messages,
				textMessage("user", autoTriggerLine(event)),
				textMessage("assistant", outcome.chatText),
			]);
		}
		return { status: outcome.status };
	}
}
