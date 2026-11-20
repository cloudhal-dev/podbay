// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { log } from "@podbay/platform/log";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	answerText,
	isPromptInjection,
	MIN_SCAN_CHARS,
	verifyDraft,
} from "../../workers/lib/ai.ts";
import { MODELS } from "../../workers/lib/models.ts";
import { FakeAi, messageOf } from "../helpers/fake-ai.ts";

const BODY = "<p>Hello, could you send me the invoice for March? Thanks, Dana</p>";
const BODY_TEXT = "Hello, could you send me the invoice for March? Thanks, Dana";

/** Every line the log module was asked to write, as one string. */
function logged(): string {
	const spies = [vi.mocked(log.info), vi.mocked(log.warn), vi.mocked(log.error)];
	return JSON.stringify(spies.flatMap((spy) => spy.mock.calls));
}

beforeEach(() => {
	vi.spyOn(log, "info").mockImplementation(() => {});
	vi.spyOn(log, "warn").mockImplementation(() => {});
	vi.spyOn(log, "error").mockImplementation(() => {});
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("answerText", () => {
	it("reads the response field of the older text models", () => {
		expect(answerText({ response: "NO" })).toBe("NO");
	});

	it("reads the first choice of the chat-completion shape", () => {
		expect(answerText({ choices: [{ message: { role: "assistant", content: "YES" } }] })).toBe(
			"YES",
		);
	});

	it("returns null for anything else", () => {
		for (const output of [null, undefined, "NO", 7, {}, { response: 7 }, { choices: [] }]) {
			expect(answerText(output)).toBeNull();
		}
		expect(answerText({ choices: [{ message: { content: null } }] })).toBeNull();
		expect(answerText({ choices: [{}] })).toBeNull();
	});
});

describe("isPromptInjection", () => {
	it("blocks when the model says YES", async () => {
		const ai = new FakeAi(["YES"]);
		expect(await isPromptInjection(ai, BODY)).toBe(true);
		expect(ai.calls).toHaveLength(1);
	});

	it("allows when the model says NO", async () => {
		const ai = new FakeAi(["NO"]);
		expect(await isPromptInjection(ai, BODY)).toBe(false);
		expect(ai.calls).toHaveLength(1);
	});

	it("reads the answer whatever its case, punctuation or shape", async () => {
		expect(await isPromptInjection(new FakeAi([" no.\n"]), BODY)).toBe(false);
		expect(await isPromptInjection(new FakeAi(["**Yes**"]), BODY)).toBe(true);
		const choices = { choices: [{ message: { content: "NO" } }] };
		expect(await isPromptInjection(new FakeAi([choices]), BODY)).toBe(false);
	});

	it("blocks when YES appears anywhere, even after a NO", async () => {
		expect(await isPromptInjection(new FakeAi(["NO. Actually YES"]), BODY)).toBe(true);
	});

	it("does not take a word that only contains NO or YES for an answer", async () => {
		expect(await isPromptInjection(new FakeAi(["NOTHING to report"]), BODY)).toBe(true);
		expect(await isPromptInjection(new FakeAi(["NO, yesterday's mail is fine"]), BODY)).toBe(false);
	});

	it("fails closed when the model throws", async () => {
		const ai = new FakeAi([new Error("3040: Capacity temporarily exceeded")]);
		expect(await isPromptInjection(ai, BODY)).toBe(true);
		expect(log.error).toHaveBeenCalledWith("agent.injection_scan_failed", expect.anything());
	});

	it("fails closed when the answer is empty, unclear or malformed", async () => {
		for (const answer of ["", "Maybe", "I cannot help with that", {}, null, { response: 1 }]) {
			expect(await isPromptInjection(new FakeAi([answer]), BODY)).toBe(true);
		}
		expect(log.warn).toHaveBeenCalledWith("agent.injection_scan_unclear", expect.anything());
	});

	it("does not call the model for an empty or very short body", async () => {
		const ai = new FakeAi();
		expect(await isPromptInjection(ai, null)).toBe(false);
		expect(await isPromptInjection(ai, undefined)).toBe(false);
		expect(await isPromptInjection(ai, "")).toBe(false);
		expect(await isPromptInjection(ai, "<p>Thanks!</p>")).toBe(false);
		expect(await isPromptInjection(ai, `<div><br> ${"x".repeat(MIN_SCAN_CHARS - 1)} </div>`)).toBe(
			false,
		);
		expect(ai.calls).toHaveLength(0);
	});

	it("scans a body that reaches the minimum length", async () => {
		const ai = new FakeAi(["NO"]);
		expect(await isPromptInjection(ai, "x".repeat(MIN_SCAN_CHARS))).toBe(false);
		expect(ai.calls).toHaveLength(1);
	});

	it("sends the scan model the text of the body as the user message, not as instructions", async () => {
		const ai = new FakeAi(["NO"]);
		await isPromptInjection(ai, `<style>p{color:red}</style>${BODY}<script>alert(1)</script>`);
		const call = ai.call(0);
		expect(call.model).toBe(MODELS.injectionScan);
		expect(messageOf(call, "user")).toBe(BODY_TEXT);
		expect(messageOf(call, "system")).toContain("YES or NO");
		expect(call.input).toMatchObject({ max_tokens: 10, temperature: 0 });
	});

	it("never logs the body", async () => {
		await isPromptInjection(new FakeAi(["YES"]), BODY);
		await isPromptInjection(new FakeAi(["Maybe"]), BODY);
		await isPromptInjection(new FakeAi([new Error("boom")]), BODY);
		expect(logged()).not.toContain("invoice");
		expect(logged()).not.toContain("Dana");
	});
});

describe("verifyDraft", () => {
	const DRAFT = "Hi Dana,\n\nThe invoice for March is attached.\n\nBest,\nSam";
	const WITH_ARTIFACT = `${DRAFT}\n\nDraft saved.`;

	it("uses the cleaned text when the verifier removed an artifact", async () => {
		const ai = new FakeAi([DRAFT]);
		expect(await verifyDraft(ai, WITH_ARTIFACT)).toBe(DRAFT);
		expect(ai.call(0).model).toBe(MODELS.draftVerifier);
		expect(messageOf(ai.call(0), "user")).toBe(WITH_ARTIFACT);
	});

	it("returns the original when the verifier changed nothing but whitespace", async () => {
		const ai = new FakeAi([`  ${DRAFT.replace(/\n\n/g, "\n")}  `]);
		expect(await verifyDraft(ai, DRAFT)).toBe(DRAFT);
	});

	it("falls back to the original when the verifier removes more than half", async () => {
		const ai = new FakeAi(["Hi Dana,"]);
		expect(await verifyDraft(ai, WITH_ARTIFACT)).toBe(WITH_ARTIFACT);
		expect(log.warn).toHaveBeenCalledWith("agent.draft_verifier_fallback", {
			originalChars: WITH_ARTIFACT.length,
			cleanedChars: 8,
		});
	});

	it("keeps a cleaned text that is exactly half as long", async () => {
		const original = "a".repeat(40);
		const half = "a".repeat(20);
		expect(await verifyDraft(new FakeAi([half]), original)).toBe(half);
		expect(await verifyDraft(new FakeAi(["a".repeat(19)]), original)).toBe(original);
	});

	it("falls back to the original when the verifier answers with nothing", async () => {
		for (const answer of ["", "   ", {}, null]) {
			expect(await verifyDraft(new FakeAi([answer]), WITH_ARTIFACT)).toBe(WITH_ARTIFACT);
		}
	});

	it("returns the empty string, meaning not verified, when the verifier throws", async () => {
		const ai = new FakeAi([new Error("5028: model deprecated")]);
		expect(await verifyDraft(ai, WITH_ARTIFACT)).toBe("");
		expect(log.error).toHaveBeenCalledWith("agent.draft_verifier_failed", expect.anything());
	});

	it("does not call the model for an empty or very short draft", async () => {
		const ai = new FakeAi();
		expect(await verifyDraft(ai, "")).toBe("");
		expect(await verifyDraft(ai, "   ")).toBe("   ");
		expect(await verifyDraft(ai, "Thanks, Sam")).toBe("Thanks, Sam");
		expect(ai.calls).toHaveLength(0);
	});

	it("shows the verifier only the reply of an HTML draft and puts the quote back", async () => {
		const reply = "<div>Hi Dana, the invoice for March is attached. Draft saved.</div>";
		const quoted = "<br><blockquote>On Monday Dana wrote: where is the invoice?</blockquote>";
		const ai = new FakeAi(["Hi Dana, the invoice for March is attached."]);

		const result = await verifyDraft(ai, reply + quoted);

		expect(messageOf(ai.call(0), "user")).toBe(
			"Hi Dana, the invoice for March is attached. Draft saved.",
		);
		expect(result).toBe(
			`<div style="white-space:pre-wrap">Hi Dana, the invoice for March is attached.</div>${quoted}`,
		);
	});

	it("escapes markup in the verifier's answer for an HTML draft", async () => {
		const reply = "<div>Hi Dana, the invoice for March is attached. Draft saved.</div>";
		const ai = new FakeAi(['Hi Dana, <img src=x onerror="alert(1)"> invoice attached.']);
		const result = await verifyDraft(ai, reply);
		expect(result).not.toContain("<img");
		expect(result).toContain("&lt;img");
	});

	it("never logs the draft", async () => {
		await verifyDraft(new FakeAi(["Hi Dana,"]), WITH_ARTIFACT);
		await verifyDraft(new FakeAi([new Error("boom")]), WITH_ARTIFACT);
		expect(logged()).not.toContain("invoice");
		expect(logged()).not.toContain("Dana");
	});
});
