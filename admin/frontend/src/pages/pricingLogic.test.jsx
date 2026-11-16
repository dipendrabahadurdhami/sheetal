// Tests for the admin Pricing, Coupons, Approvals and business Subscriptions screens (P3-FE-3): rupees typed with 2 decimals become paisa as
// text (never through floating point), catalog edits leave the original alone, every body the pages send passes the API's own .strict()
// rules (admin/backend/src/modules/billing-bodies.ts: "the form only sends what BE-7 accepts"), a price rise shows "Needs approval", and the
// admin menu and routes.
// Where it fits: the root front-end test run (npx vitest run admin/frontend).
import { describe, expect, it } from "vitest";
import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { AiCredits, CouponCreate, CouponPatch, Decide, ExtendTrial, Grant, PricingPreview, PricingSave, Revoke } from "../../../../admin/backend/src/modules/billing-bodies.ts";
import {
  aiCreditsBody, couponBody, couponPatchBody, decideBody, extendTrialBody, grantBody, isDirty, paisaToRupees, previewBody, reasonOk, revokeBody,
  rsPaisa, rupeesToPaisa, saveBody, setAddon, setApp, setEdition, setLimit, toggleFeature,
} from "./pricingLogic.js";
import { ImpactView, changeText } from "./Pricing.jsx";

const src = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
const CAT = {
  version: 7, periods: [1, 12], business: { freeSeats: 3, seatAddon: { priceMonthPaisa: 10_000, priceYearPaisa: 100_000 }, storageAddon: { unitMb: 1024, priceMonthPaisa: 5000, priceYearPaisa: 50_000 }, paidFeatures: [] },
  apps: { hotel: { name: { en: "Hotel" }, availability: "live", visible: true, freeEditionEnabled: true, trialDays: 14, editions: {
    free: { name: { en: "Free" }, free: true, priceMonthPaisa: 0, priceYearPaisa: 0, limits: { rooms: { value: 5, behaviour: "hard" } }, features: [], sort: 0 },
    full: { name: { en: "Full" }, free: false, priceMonthPaisa: 70_000, priceYearPaisa: 700_000, limits: { rooms: { value: null, behaviour: "hard" } }, features: ["channel_manager"], sort: 1 },
  } } },
  addons: [{ key: "rooms_10", appId: "hotel", name: { en: "10 more rooms" }, limitKey: "rooms", step: 10, priceMonthPaisa: 20_000, priceYearPaisa: 200_000, needsPaidEdition: false, active: true }],
};

describe("rupees and paisa, as text", () => {
  it("2 decimals at most, commas allowed, nothing else", () => {
    expect([rupeesToPaisa("700"), rupeesToPaisa("700.5"), rupeesToPaisa("700.50"), rupeesToPaisa("1,234.05"), rupeesToPaisa("0.10")]).toEqual([70_000, 70_050, 70_050, 123_405, 10]);
    for (const bad of ["", "abc", "1.234", "-5", "1e3", "12.", ".5"]) expect(rupeesToPaisa(bad), bad).toBeNull();
    // 0.1 + 0.2 never happens: 0.29 rupees is exactly 29 paisa (Math.round(0.29 * 100) would be 28.999… on some paths).
    expect(rupeesToPaisa("0.29")).toBe(29);
    expect(rupeesToPaisa("1234567.89")).toBe(123_456_789);
  });
  it("back to an input's text and to a reading", () => {
    expect([paisaToRupees(70_000), paisaToRupees(70_050), paisaToRupees(5), paisaToRupees(0)]).toEqual(["700", "700.50", "0.05", "0"]);
    expect(rsPaisa(123_405)).toBe("Rs. 1,234.05");
    for (const p of [0, 1, 99, 100, 70_050, 123_456_789]) expect(rupeesToPaisa(paisaToRupees(p))).toBe(p);
  });
});

describe("editing a copy of the catalog", () => {
  it("prices, limits (unlimited, hard/soft with %), features, app settings, add-ons; the original never changes", () => {
    const before = JSON.stringify(CAT);
    let c = setEdition(CAT, "hotel", "full", { priceMonthPaisa: 80_000 });
    c = setLimit(c, "hotel", "free", "rooms", { value: "8", behaviour: "soft", softOverPct: "30" });
    c = setLimit(c, "hotel", "full", "rooms", { value: "", behaviour: "hard" });
    c = toggleFeature(c, "hotel", "full", "channel_manager");
    c = toggleFeature(c, "hotel", "full", "reports");
    c = setApp(c, "hotel", { trialDays: "", visible: false });
    c = setAddon(c, "rooms_10", { active: false });
    expect(JSON.stringify(CAT)).toBe(before);
    expect(c.apps.hotel.editions.full.priceMonthPaisa).toBe(80_000);
    expect(c.apps.hotel.editions.free.limits.rooms).toEqual({ value: 8, behaviour: "soft", softOverPct: 30 });
    expect(c.apps.hotel.editions.full.limits.rooms).toEqual({ value: null, behaviour: "hard" });
    expect(c.apps.hotel.editions.full.features).toEqual(["reports"]);
    expect([c.apps.hotel.trialDays, c.apps.hotel.visible, c.addons[0].active]).toEqual([null, false, false]);
    expect(isDirty(c, CAT)).toBe(true);
    expect(isDirty(JSON.parse(before), CAT)).toBe(false);
  });
});

describe("the forms only send what BE-7 accepts (billing-bodies.ts)", () => {
  it("pricing preview and save (a reason of 5 to 300 characters)", () => {
    expect(() => PricingPreview.parse(previewBody(CAT))).not.toThrow();
    expect(() => PricingSave.parse(saveBody(CAT, "  New prices for 2083  "))).not.toThrow();
    expect(saveBody(CAT, "  New prices ").reason).toBe("New prices");
    expect(() => PricingSave.parse(saveBody(CAT, "no"))).toThrow();
    expect([reasonOk("no"), reasonOk("Seasonal price"), reasonOk("x".repeat(301))]).toEqual([false, true, false]);
  });
  it("coupons: percent, a fixed amount in rupees → paisa, trial days; dates, caps; a pause with the version", () => {
    const pct = couponBody({ code: "dashain10", kind: "percent", value: "10", appIds: ["hotel"], perBusinessLimit: "1", periods: "1" });
    expect(CouponCreate.parse(pct)).toMatchObject({ code: "DASHAIN10", appliesTo: "apps", appIds: ["hotel"], value: 10 });
    const fixed = couponBody({ code: "RS500", kind: "fixed_paisa", value: "500.50", minSpend: "2000", validFrom: "2026-11-20", validTo: "2026-12-31", maxRedemptions: "100", perBusinessLimit: "2", periods: "3" });
    expect(CouponCreate.parse(fixed)).toMatchObject({ value: 50_050, minSpendPaisa: 200_000, maxRedemptions: 100, perBusinessLimit: 2, periods: 3, appliesTo: "all" });
    expect(fixed.validFrom).toBe("2026-11-19T18:15:00.000Z"); // midnight in Nepal
    expect(() => CouponCreate.parse(couponBody({ code: "TRIAL7", kind: "trial_days", value: "7" }))).not.toThrow();
    expect(() => CouponPatch.parse(couponPatchBody({ version: 3 }, { active: false }))).not.toThrow();
    expect(() => CouponPatch.parse(couponPatchBody({ version: 3 }, { validTo: new Date().toISOString() }))).not.toThrow();
  });
  it("gifts, taking back, trial extension, AI credits, approvals", () => {
    expect(() => Grant.parse(grantBody({ kind: "app", appId: "hotel", endsAt: "2026-12-31", reason: "Pilot business" }))).not.toThrow();
    expect(Grant.parse(grantBody({ kind: "limit", appId: "hotel", key: "rooms", value: "20", endsAt: "2026-12-31", reason: "Pilot business" }))).toMatchObject({ value: 20, key: "rooms" });
    expect(grantBody({ kind: "seats", appId: "", key: "x", value: "2", endsAt: "2026-12-31", reason: "Extra staff" })).toEqual({ kind: "seats", value: 2, endsAt: "2026-12-31T18:14:59.000Z", reason: "Extra staff" });
    expect(() => Revoke.parse(revokeBody("Given by mistake"))).not.toThrow();
    expect(() => ExtendTrial.parse(extendTrialBody("7", "Asked for more time", 2))).not.toThrow();
    expect(() => AiCredits.parse(aiCreditsBody("100", "90", "Launch gift"))).not.toThrow();
    expect(() => Decide.parse(decideBody("approve", "Checked"))).not.toThrow();
    expect(decideBody("anything", "Not ok").decision).toBe("reject");
  });
});

describe("Who is affected: only the server's answer", () => {
  const impact = { changes: [{ kind: "price_rise", appId: "hotel", editionId: "full", what: "price a month", from: 70_000, to: 80_000, paying: 3, free: 0 }], refused: [], needsApproval: true, payingAffected: 3, approvalSkipped: false };
  it("a price rise with paying customers says Needs approval and the numbers", () => {
    const html = renderToStaticMarkup(<ImpactView impact={impact} />);
    expect(html).toContain("3 paying subscriptions affected");
    expect(html).toContain("Needs approval");
    expect(changeText(impact.changes[0])).toBe("Price rise · hotel full · price a month: Rs. 700 → Rs. 800 (3 paying, 0 free)");
  });
  it("a one-person team is told it saves at once; refusals are shown as alerts", () => {
    const html = renderToStaticMarkup(<ImpactView impact={{ ...impact, approvalSkipped: true, refused: ["hotel: 4 businesses use this app"] }} />);
    expect(html).toContain("nobody else can approve");
    expect(html).toMatch(/role="alert"[^>]*>.*4 businesses use this app/);
  });
  it("Save waits for the check and a valid reason; the button says Send for approval", () => {
    const p = src("./Pricing.jsx");
    expect(p).toContain("disabled={busy || !dirty || !impact || !reasonOk(reason) || impact.refused?.length > 0}");
    expect(p).toContain('"Send for approval"');
    expect(p).toContain("if (e.status === 409) setStale(true)");
  });
});

describe("admin menu and routes", () => {
  const app = src("./AdminApp.jsx");
  it("Pricing, Coupons and Approvals in the menu (live only) and guarded routes; the business page links its subscriptions", () => {
    expect(app).toContain('{ to: "/admin/pricing", icon: "tag", key: "nav.pricing", perm: "platform.billing.read" }');
    expect(app).toMatch(/path: "\/admin\/pricing", render: \(\) => guard\("platform\.billing\.read"/);
    expect(app).toMatch(/path: "\/admin\/coupons", render: \(\) => guard\("platform\.billing\.read"/);
    expect(app).toMatch(/path: "\/admin\/approvals", render: \(\) => guard\(\["platform\.pricing\.manage", "platform\.billing\.refund"\]/);
    expect(app).toMatch(/path: "\/admin\/tenants\/:id\/subscriptions", render: \(\{ id \}\) => guard\("platform\.business\.read"/);
    expect(src("./AdminTenants.jsx")).toContain("/admin/tenants/${id}/subscriptions");
  });
  it("raw buttons say type=button", () => {
    for (const f of ["./Pricing.jsx", "./Coupons.jsx", "./PlatformApprovals.jsx", "./BusinessSubscriptions.jsx"]) expect([...src(f).matchAll(/<button(?![^>]*type="button")/g)], f).toHaveLength(0);
  });
});
