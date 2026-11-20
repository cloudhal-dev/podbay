// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

/**
 * How a catalog reaches the message runtime (ADR-0018, decision 8): each owner hands in its
 * own. The same owner again replaces what it gave, so words edited while the app runs show at
 * once; different owners are put together. The runtime here is fresh: no catalog of the app.
 */
import { afterEach, describe, expect, it } from "vitest";
import { addCatalog, setLanguage, t } from "../../packages/i18n/index.ts";

afterEach(() => setLanguage("en"));

describe("a catalog handed in", () => {
	it("is what t answers with, and the same owner again replaces it", () => {
		setLanguage("tr");
		expect(t("Archive")).toBe("Archive");

		addCatalog("first", "tr", { Archive: "Arşivle", Inbox: "Gelen Kutusu" });
		expect([t("Archive"), t("Inbox")]).toEqual(["Arşivle", "Gelen Kutusu"]);

		// As when a word is changed in the catalog while the app runs.
		addCatalog("first", "tr", { Archive: "Arşive kaldır" });
		expect(t("Archive")).toBe("Arşive kaldır");
		// What the owner no longer gives is gone: its catalog is replaced, not added to.
		expect(t("Inbox")).toBe("Inbox");
	});

	it("is put together with another owner's for the same language", () => {
		setLanguage("tr");
		addCatalog("mail", "tr", { Sent: "Gönderilenler" });
		addCatalog("shell", "tr", { Settings: "Ayarlar" });
		expect([t("Sent"), t("Settings")]).toEqual(["Gönderilenler", "Ayarlar"]);

		addCatalog("mail", "tr", { Sent: "Gönderilen" });
		expect([t("Sent"), t("Settings")]).toEqual(["Gönderilen", "Ayarlar"]);
	});

	it("leaves English as the English it is named by", () => {
		addCatalog("mail", "tr", { Spam: "İstenmeyen" });
		setLanguage("en");
		expect(t("Spam")).toBe("Spam");
	});
});
