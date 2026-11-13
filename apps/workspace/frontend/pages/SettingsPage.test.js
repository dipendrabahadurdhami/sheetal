// Tests for the Settings page on the kit (P2-W6): it loads and saves through the business API itself (never the panel store's settings copy),
// the settings model keeps saved values over the defaults, and the old path is a shim passing in the Business-only parts.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { defaultTenantSettings, mergeSettings, SERVER_SECTIONS } from "../settingsModel.js";

const src = readFileSync(new URL("./SettingsPage.jsx", import.meta.url), "utf8");
const shim = readFileSync(new URL("../../../../business/frontend/src/pages/BusinessSettings.jsx", import.meta.url), "utf8");

describe("Settings page on the kit", () => {
  it("loads and saves on the server", () => {
    expect(src).toContain('useApiGet("/workspace/settings")');
    expect(src).toContain('bizApi("PATCH", "/workspace/profile"');
    expect(src).toMatch(/bizApi\("PUT", `\/workspace\/settings\/\$\{sec\}`, s\[sec\]\)/);
    expect(src).not.toMatch(/db\.tenantSettings|update\(\(d\)/);
    expect(src).toContain('from "@sheetal/ui/primitives"');
    expect(src).not.toContain("@sheetal/shared/core/ui");
  });
  it("lays saved values over the defaults, object by object", () => {
    const base = defaultTenantSettings({ name: "Test Realty", city: "Kathmandu", owner: "Ram" });
    const m = mergeSettings(base, { payments: { advancePct: 50 } });
    expect(m.payments.advancePct).toBe(50);
    expect(m.payments.autoReceipt).toBe(true);
    expect(SERVER_SECTIONS).toEqual(["branding", "payments", "notifications", "listings", "documents"]);
  });
  it("the old path is a shim", () => {
    expect(shim).toContain("<SettingsPage {...props} Branding={BrandFromLogo} CodePrefix={CodePrefix}");
  });
});
