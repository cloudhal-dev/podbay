// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * The one script that runs inside the mail frame: it tells the page how tall the message is,
 * because the frame is cross-origin and its height cannot be read from outside. It says so when
 * the message loads and again when folded quoted text is opened or closed.
 *
 * The frame is a `srcdoc` document and inherits the page's content policy, so the page must
 * allow this script, and only this script, to run inline. It does that by the script's hash,
 * which is a constant here because the page's policy is a static header on static assets. A
 * test fails when the hash and the script no longer match.
 */
export const MAIL_FRAME_SCRIPT = `
function reportHeight() {
	var h = document.body.scrollHeight;
	if (h > 0) parent.postMessage({ __emailIframeHeight: true, height: h }, "*");
}
reportHeight();
document.addEventListener("toggle", reportHeight, true);
setTimeout(reportHeight, 50);
setTimeout(reportHeight, 150);
setTimeout(reportHeight, 400);
`;

/**
 * What the mail frame's sandbox allows, and with that everything it forbids:
 *
 * - `allow-scripts`: the sizing script. Scripts in the frame still have no origin: without
 *   `allow-same-origin` the frame cannot read the app, its cookies or its storage.
 * - `allow-popups`: a link opens in a new window.
 * - `allow-popups-to-escape-sandbox`: that window is an ordinary one, so the site the reader
 *   chose to visit works there; it gets no handle on the app (`noopener`).
 *
 * Not allowed: moving the app's own window (a message cannot replace Podbay with a look-alike),
 * forms, downloads, dialogs, pointer lock and everything else.
 */
export const MAIL_FRAME_SANDBOX = "allow-scripts allow-popups allow-popups-to-escape-sandbox";

/** `sha256-` and the base64 SHA-256 digest of `MAIL_FRAME_SCRIPT`, as a content policy names it. */
export const MAIL_FRAME_SCRIPT_HASH = "sha256-h72a/YZlWhcx4YZgZYn0wGGHqh18JNnbtUyxhl4oyU0=";
