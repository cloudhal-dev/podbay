// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * The highest the frame stands. A message taller than this scrolls inside the frame.
 * It is far above an ordinary message: a long newsletter on a phone is about half of it.
 */
export const FRAME_MAX_HEIGHT = 20_000;

/**
 * How many heights one document may report at one width of the frame. An ordinary message reports
 * once, and once more for each picture that arrives at a moment of its own; a newsletter with more
 * pictures than this that each arrive alone stops growing and scrolls inside the frame. Each width
 * keeps its own count, and a width seen before goes on with its count: the reader resizing the
 * window brings new widths, while a message can only make the page's scrollbar come and go, which
 * flips the frame between two widths and so stops at twice this.
 */
export const FRAME_MAX_REPORTS = 200;

/**
 * How many times in a row the message may change its height right after the frame took the
 * height it reported. A message whose heights are its own stands still then; one that moves has
 * a height that follows the frame's own (written in `vh`, or in `%` of one), and every report
 * would move it again.
 */
export const FRAME_MAX_FOLLOWS = 3;

/**
 * The one script that runs inside the mail frame: it tells the page how tall the message is,
 * because the frame is cross-origin and its height cannot be read from outside. It reports the
 * body's height whenever it changes (a picture that arrives, a folded quote opened); the body is
 * a block of its own (`display: flow-root`), so its first and last margins are inside it. The
 * document element is not measured: its height is never less than the frame's, so a message that
 * grew shorter (a quote folded again) could never make the frame shorter.
 *
 * The stranger writes every height in the message, and a height can follow the frame's own:
 * then each report makes the frame taller and the message with it. The script stops reporting
 * when the message moves after the frame took its height `FRAME_MAX_FOLLOWS` times in a row,
 * after `FRAME_MAX_REPORTS` reports at any one width, or at `FRAME_MAX_HEIGHT`; from then on the
 * frame keeps its height and the message scrolls inside it. The page holds the same limits
 * itself (`nextFrameHeight`), whatever the frame says.
 *
 * The frame is a `srcdoc` document and inherits the page's content policy, so the page must
 * allow this script, and only this script, to run inline. It does that by the script's hash,
 * which is a constant here because the page's policy is a static header on static assets. A
 * test fails when the hash and the script no longer match.
 */
export const MAIL_FRAME_SCRIPT = `
var body = document.body, last = 0, told = {}, follows = 0, width = innerWidth, done = false;
function height() {
	return Math.max(body.scrollHeight, Math.ceil(body.getBoundingClientRect().height));
}
function stop() {
	done = true;
	watcher.disconnect();
	document.documentElement.style.overflow = "hidden auto";
}
function report() {
	if (done) return;
	var h = height();
	if (h <= 0 || h === last) return;
	if (h >= ${FRAME_MAX_HEIGHT}) h = ${FRAME_MAX_HEIGHT};
	last = h;
	told[innerWidth] = (told[innerWidth] || 0) + 1;
	parent.postMessage({ __emailIframeHeight: true, height: h }, "*");
	if (h === ${FRAME_MAX_HEIGHT} || told[innerWidth] >= ${FRAME_MAX_REPORTS}) stop();
}
var watcher = new ResizeObserver(report);
watcher.observe(body);
addEventListener("resize", function () {
	if (done) return;
	if (innerWidth !== width) {
		width = innerWidth;
		return;
	}
	if (innerHeight !== last) return;
	if (height() === last) follows = 0;
	else if (++follows >= ${FRAME_MAX_FOLLOWS}) stop();
});
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
export const MAIL_FRAME_SCRIPT_HASH = "sha256-7m4OTqgAH2qS6cvkcFOlSft2dk03Qbs/aKQcfBzxK2A=";

/** What the page has accepted from one frame document: how many reports at each width. */
export interface FrameReports {
	counts: Map<number, number>;
}

/**
 * The height the page gives the frame for a height it reported, or null when the page does not
 * follow it: not a positive number, or past `FRAME_MAX_REPORTS` at the frame's width now. The
 * height is never above `FRAME_MAX_HEIGHT`. `seen` is the record of the document, kept by the
 * page, and is updated here.
 */
export function nextFrameHeight(
	seen: FrameReports,
	reported: unknown,
	width: number,
): number | null {
	if (typeof reported !== "number" || !Number.isFinite(reported) || reported <= 0) return null;
	const count = seen.counts.get(width) ?? 0;
	if (count >= FRAME_MAX_REPORTS) return null;
	seen.counts.set(width, count + 1);
	return Math.min(Math.ceil(reported), FRAME_MAX_HEIGHT);
}
