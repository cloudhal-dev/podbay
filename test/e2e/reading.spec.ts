// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * Tier 6: an open message as a phone shows it. The header of a message is drawn from what a
 * stranger wrote, and a long sender must not push into the date and the buttons beside it (#82).
 */
import { expect, test } from "./fixtures.ts";

const LONG_SENDER =
	"a-sender-with-a-very-long-address-for-the-header@a-long-domain-name.sender.test";

test("on a phone a long sender is cut short, keeps its line above Unsubscribe and keeps clear of the date", async ({
	page,
	app,
}) => {
	await page.setViewportSize({ width: 375, height: 812 });
	await app.signIn();
	await app.deliver(
		[
			`From: ${LONG_SENDER}`,
			`To: ${app.account.mailbox}`,
			"Subject: Reading: a long sender",
			// A mailing list's message, so "Unsubscribe" stands beside the name as well.
			"List-Unsubscribe: <mailto:leave@a-long-domain-name.sender.test>",
			`Message-ID: <reading-${Date.now()}@sender.test>`,
			"MIME-Version: 1.0",
			"Content-Type: text/plain; charset=utf-8",
			"",
			"A message from someone with a long address.",
			"",
		].join("\r\n"),
	);
	await app.openMessage("Reading: a long sender");

	const name = page.getByRole("button", { name: `About the sender ${LONG_SENDER}` });
	await expect(name).toBeVisible();
	const layout = await name.evaluate((button) => {
		const header = button.closest("div.flex.items-start");
		const date = header?.lastElementChild?.firstElementChild;
		// The name is the element that cuts its text: the button itself, or a span inside it.
		const text = [button, ...button.querySelectorAll("span")].find(
			(element) => getComputedStyle(element).textOverflow === "ellipsis",
		);
		return {
			nameRight: button.getBoundingClientRect().right,
			dateLeft: date?.getBoundingClientRect().left ?? 0,
			cut: text !== undefined && text.scrollWidth > text.clientWidth,
			shown: text?.getBoundingClientRect().width ?? 0,
			pageWidth: document.documentElement.scrollWidth,
		};
	});
	expect(layout.cut, "the name is cut with an ellipsis").toBe(true);
	expect(layout.shown, "some of the name is shown").toBeGreaterThan(0);
	// The cut name keeps its line: Unsubscribe moves under it instead of taking all its room.
	const unsubscribe = await page.getByRole("button", { name: "Unsubscribe" }).boundingBox();
	const nameBox = await name.boundingBox();
	expect(unsubscribe?.y ?? 0, "Unsubscribe stands under the name").toBeGreaterThanOrEqual(
		(nameBox?.y ?? 0) + (nameBox?.height ?? 0) - 2,
	);
	expect(layout.nameRight, "the name ends before the date begins").toBeLessThan(layout.dateLeft);
	expect(layout.pageWidth, "nothing scrolls sideways").toBeLessThanOrEqual(375);
});
