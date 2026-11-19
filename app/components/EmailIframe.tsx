// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified by the Podbay contributors.

import { Button } from "@cloudflare/kumo";
import DOMPurify from "dompurify";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type FrameReports, MAIL_FRAME_SANDBOX, nextFrameHeight } from "shared/mail-frame";
import { t } from "~/i18n";
import { freshNonce, mailDocument, type Purifier, sanitizeMailHtml } from "~/lib/mail-html";

interface EmailIframeProps {
	body: string;
	/** When true, iframe auto-sizes to content height instead of filling parent */
	autoSize?: boolean;
}

/**
 * Shows a message body. All the safety is in `~/lib/mail-html` (rule S4): the body is
 * sanitised, wrapped in a document with a strict content policy, and shown here in a sandboxed
 * frame without same-origin access. Remote content stays out until the reader asks for it.
 *
 * The frame is cross-origin, so its height cannot be read; the one script the policy allows
 * posts it to this component.
 */
export default function EmailIframe({ body, autoSize }: EmailIframeProps) {
	const iframeRef = useRef<HTMLIFrameElement>(null);
	const [height, setHeight] = useState(autoSize ? 100 : 0);
	/**
	 * The document whose frame stands at its size (#43): it said its height, or it loaded and said
	 * nothing in the time the sizing script takes, as a message with no height of its own does. It
	 * is kept for that document only, as `allowedFor` is for a body: a new document is unmarked.
	 */
	const [sizedFor, setSizedFor] = useState<string | null>(null);
	/** The document of the frame on the page now, for the height message to mark. */
	const shown = useRef("");
	/**
	 * What the page has taken from the frame's document. The page holds the frame's limits itself
	 * (`nextFrameHeight`): it follows a bounded number of reports, up to a bounded height.
	 */
	const reports = useRef<{ document: string } & FrameReports>({ document: "", counts: new Map() });
	// Asked for per message: a new body starts with remote content hidden again.
	const [allowedFor, setAllowedFor] = useState<string | null>(null);
	const allowRemote = allowedFor === body;

	const handleMessage = useCallback(
		(event: MessageEvent) => {
			if (!autoSize) return;
			// Only accept messages from our own iframe
			if (event.source !== iframeRef.current?.contentWindow) return;
			if (event.data && typeof event.data === "object" && event.data.__emailIframeHeight) {
				if (reports.current.document !== shown.current)
					reports.current = { document: shown.current, counts: new Map() };
				const next = nextFrameHeight(
					reports.current,
					event.data.height,
					iframeRef.current?.clientWidth ?? 0,
				);
				if (next === null) return;
				setHeight(next);
				// The message came from the frame on the page now: its document stands at its size.
				setSizedFor(shown.current);
			}
		},
		[autoSize],
	);

	useEffect(() => {
		window.addEventListener("message", handleMessage);
		return () => window.removeEventListener("message", handleMessage);
	}, [handleMessage]);

	const sanitized = useMemo(
		() => sanitizeMailHtml(body, { allowRemote, purify: DOMPurify as unknown as Purifier }),
		[body, allowRemote],
	);

	// One document per body. It is given to the frame once, as an attribute, and every document
	// gets its own frame element: assigning a second document to a frame that is still loading
	// the first leaves the frame blank.
	const frameDocument = useMemo(
		() =>
			body
				? mailDocument({
						sanitizedBody: sanitized.html,
						autoSize: autoSize === true,
						allowRemote,
						nonce: freshNonce(),
					})
				: "",
		[body, autoSize, allowRemote, sanitized],
	);

	shown.current = frameDocument;

	return (
		<>
			{sanitized.blockedRemote > 0 && (
				<div className="flex items-center justify-between gap-3 px-3 py-2 mb-2 rounded-md bg-kumo-tint text-xs text-kumo-strong">
					<span>{t("Remote images are hidden to protect your privacy.")}</span>
					<Button variant="secondary" size="sm" onClick={() => setAllowedFor(body)}>
						{t("Show images")}
					</Button>
				</div>
			)}
			<iframe
				key={frameDocument}
				ref={iframeRef}
				srcDoc={frameDocument}
				className="block w-full border-0"
				style={autoSize ? { height: `${height}px` } : { height: "100%" }}
				sandbox={MAIL_FRAME_SANDBOX}
				title={t("Email content")}
				data-sized={autoSize && sizedFor === frameDocument ? "true" : undefined}
				onLoad={() => {
					// The sizing script keeps no time: it reports when the body's size changes, first at
					// the document's first layout, which comes before or just after load. A document
					// that reports nothing (one with no height of its own) is marked half a second after
					// load, a margin of many frames; a later report (a late picture) still moves the frame
					// after the mark. The timer marks this frame's own document, and no other.
					const loaded = frameDocument;
					setTimeout(() => {
						if (shown.current === loaded) setSizedFor(loaded);
					}, 500);
				}}
			/>
		</>
	);
}
