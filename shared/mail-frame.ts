// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * The one script that runs inside the mail frame: it tells the page how tall the message is,
 * because the frame is cross-origin and its height cannot be read from outside.
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
setTimeout(reportHeight, 50);
setTimeout(reportHeight, 150);
setTimeout(reportHeight, 400);
`;

/** `sha256-` and the base64 SHA-256 digest of `MAIL_FRAME_SCRIPT`, as a content policy names it. */
export const MAIL_FRAME_SCRIPT_HASH = "sha256-TqViNdPjitTrwP0rHe9I4wm2ERtodCsHvLHB0da+hsc=";
