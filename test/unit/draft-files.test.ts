// @vitest-environment jsdom
// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * A file taken away while it is attached (#140, attempt 2). The upload's loop and the person's
 * click each act on what they saw: the loop looks, once its bytes are stored, whether the file
 * was taken away; the click acts on the file as the screen drew it. A file removed between the
 * upload's answer and the next draw was seen as "uploading" by the click and as "kept" by the
 * loop, and nobody took it out: Send waited for that removal for ever. A removal that is opened
 * is always finished, whichever side saw the other first.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type DraftFile, useDraftFiles } from "~/hooks/useDraftFiles";
import api from "~/services/api";

vi.mock("~/services/api", () => ({
	default: {
		declareDraftFile: vi.fn(),
		uploadDraftFile: vi.fn(),
		removeDraftFile: vi.fn(),
		copyDraftFiles: vi.fn(),
	},
}));

const MAILBOX = "box@example.com";
let hook: ReturnType<typeof useDraftFiles>;
const said = vi.fn<(message: string | null) => void>();
function Harness() {
	hook = useDraftFiles(MAILBOX, async () => "draft-1", said);
	return null;
}

/** Settles, or says it is still waiting after half a second. */
const settledWithin = () =>
	Promise.race([
		hook.settled().then(() => "settled"),
		new Promise((resolve) => setTimeout(() => resolve("still waiting"), 500)),
	]);

let root: Root;
let answerUpload: () => void;
let failUpload: () => void;
beforeEach(async () => {
	vi.mocked(api.declareDraftFile).mockResolvedValue({ id: "f1", filename: "notes.txt" } as never);
	vi.mocked(api.uploadDraftFile).mockImplementation(
		() =>
			new Promise<void>((resolve, reject) => {
				answerUpload = resolve;
				failUpload = () => reject(new Error("the upload failed"));
			}) as never,
	);
	vi.mocked(api.removeDraftFile).mockResolvedValue(undefined as never);
	root = createRoot(document.createElement("div"));
	await act(async () => root.render(createElement(Harness)));
});
afterEach(async () => {
	await act(async () => root.unmount());
	vi.clearAllMocks();
});

/** Attaches a file and gives back the file as the screen drew it while its bytes travelled. */
async function attachAndTakeTheDrawnFile(): Promise<DraftFile> {
	await act(async () => {
		void hook.addFiles([new File(["notes"], "notes.txt", { type: "text/plain" })]);
	});
	await vi.waitFor(() => expect(api.uploadDraftFile).toHaveBeenCalled());
	const drawn = hook.files[0];
	if (!drawn) throw new Error("the file was not drawn");
	expect(drawn.uploading).not.toBeNull();
	return drawn;
}

describe("a file taken away while it is attached", () => {
	it("is taken out of the draft when the click acts on the drawing from before the upload's answer", async () => {
		const drawn = await attachAndTakeTheDrawnFile();
		// The upload is answered, and the loop has looked and found the file kept.
		await act(async () => answerUpload());
		await vi.waitFor(() => expect(hook.files[0]?.uploading).toBeNull());
		// The person's click still holds the file as the screen drew it: uploading.
		await act(async () => hook.removeFile(drawn));
		expect(await settledWithin()).toBe("settled");
		expect(api.removeDraftFile).toHaveBeenCalledWith(MAILBOX, "draft-1", "f1");
		expect(hook.files).toEqual([]);
	});

	it("is taken out by the loop when the click comes while the bytes still travel", async () => {
		const drawn = await attachAndTakeTheDrawnFile();
		await act(async () => hook.removeFile(drawn));
		await act(async () => answerUpload());
		expect(await settledWithin()).toBe("settled");
		expect(api.removeDraftFile).toHaveBeenCalledTimes(1);
		expect(api.removeDraftFile).toHaveBeenCalledWith(MAILBOX, "draft-1", "f1");
	});

	it("is taken out when its upload failed and the click acts on the drawing from before", async () => {
		const drawn = await attachAndTakeTheDrawnFile();
		await act(async () => failUpload());
		await vi.waitFor(() => expect(hook.files).toEqual([]));
		await act(async () => hook.removeFile(drawn));
		expect(await settledWithin()).toBe("settled");
		// It was declared: what the draft holds of it is taken out.
		expect(api.removeDraftFile).toHaveBeenCalledWith(MAILBOX, "draft-1", "f1");
	});

	it("opens no removal when it was never declared and the click acts on the drawing from before", async () => {
		let refuse = () => {};
		vi.mocked(api.declareDraftFile).mockImplementation(
			() =>
				new Promise((_, reject) => {
					refuse = () => reject(new Error("refused"));
				}) as never,
		);
		await act(async () => {
			void hook.addFiles([new File(["notes"], "notes.txt", { type: "text/plain" })]);
		});
		const drawn = hook.files[0];
		if (!drawn) throw new Error("the file was not drawn");
		await act(async () => refuse());
		await vi.waitFor(() => expect(hook.files).toEqual([]));
		await act(async () => hook.removeFile(drawn));
		expect(await settledWithin()).toBe("settled");
		expect(api.removeDraftFile).not.toHaveBeenCalled();
	});

	it("is one removal however often it is clicked, and says nothing when the second is refused", async () => {
		await attachAndTakeTheDrawnFile();
		await act(async () => answerUpload());
		await vi.waitFor(() => expect(hook.files[0]?.uploading).toBeNull());
		const now = hook.files[0];
		if (!now) throw new Error("the file is gone");
		// A second DELETE of a file that already left is refused by the Worker.
		vi.mocked(api.removeDraftFile)
			.mockResolvedValueOnce(undefined as never)
			.mockRejectedValueOnce(new Error("not found"));
		said.mockClear();
		await act(async () => {
			void hook.removeFile(now);
			void hook.removeFile(now);
		});
		expect(await settledWithin()).toBe("settled");
		expect(api.removeDraftFile).toHaveBeenCalledTimes(1);
		expect(hook.files).toEqual([]);
		expect(said.mock.calls.filter(([message]) => message !== null)).toEqual([]);
	});

	it("is taken out once when the click comes after the drawing caught up", async () => {
		await attachAndTakeTheDrawnFile();
		await act(async () => answerUpload());
		await vi.waitFor(() => expect(hook.files[0]?.uploading).toBeNull());
		const now = hook.files[0];
		if (!now) throw new Error("the file is gone");
		await act(async () => hook.removeFile(now));
		expect(await settledWithin()).toBe("settled");
		expect(api.removeDraftFile).toHaveBeenCalledTimes(1);
	});
});
