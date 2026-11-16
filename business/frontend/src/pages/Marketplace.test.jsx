// Component and page tests for the marketplace (P3-FE-1): the quote panel shows exactly the API's numbers (it never adds up money itself),
// the edition drawer compares editions from the catalog, the pages are keyboard- and phone-friendly, the shell shows the new pages only for
// a business on per-app billing, and every text has Nepali.
// Where it fits: the root front-end test run (npx vitest run business/frontend). Renders with react-dom/server (no browser needed).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nProvider } from "@sheetal/shared/core/i18n";
import en from "../../../../shared/src/i18n/en-market.js";
import ne from "../../../../shared/src/i18n/ne-market.js";
import { QuotePanel } from "./Cart.jsx";
import { EditionDrawer } from "./Marketplace.jsx";
import { rsPaisa } from "./marketplaceLogic.js";

const src = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
const render = (el, lang = "en") => renderToStaticMarkup(<I18nProvider lang={lang}>{el}</I18nProvider>);
const paisaShown = (html) => [...html.matchAll(/data-paisa="(-?\d+)"[^>]*>(?:<b>)?([^<]+)/g)].map(([, p, text]) => [Number(p), text]);

// A quote as POST /subscriptions/quote answers it (numbers chosen so a screen that added them up itself would differ).
const QUOTE = {
  lines: [
    { kind: "subscription", appId: "hotel", editionId: "full", description: { en: "Hotel · Full, 1 year", ne: "होटल · पूरा, १ वर्ष" }, periodStart: "2026-11-16T00:00:00.000Z", periodEnd: "2027-11-16T00:00:00.000Z", qty: 1, grossPaisa: 700_000, discountPaisa: 0, netPaisa: 619_469, vatPaisa: 80_531 },
    { kind: "proration_credit", appId: "crm", editionId: "full", description: { en: "CRM: unused days" }, periodStart: null, periodEnd: null, qty: 1, grossPaisa: -11_299, discountPaisa: 0, netPaisa: -9_999, vatPaisa: -1_300 },
  ],
  discountPaisa: 70_000, subtotalPaisa: 547_788, vatPaisa: 70_913, totalPaisa: 618_701, carryPaisa: 0, anchorDay: 16, dueAt: "2026-11-23T00:00:00.000Z",
  notes: [{ en: "Your CRM credit is taken off." }], warnings: [], errors: [{ en: "That code has expired." }],
};

describe("QuotePanel: the numbers come only from the API", () => {
  it("every amount shown is the quote's own field, formatted from paisa", () => {
    const html = render(<QuotePanel quote={QUOTE} />);
    const shown = paisaShown(html);
    expect(shown).toEqual([
      [700_000, rsPaisa(700_000)], [-11_299, rsPaisa(-11_299)],
      [-70_000, rsPaisa(-70_000)], [547_788, rsPaisa(547_788)], [70_913, rsPaisa(70_913)], [618_701, rsPaisa(618_701)],
    ]);
    // The total is the API's 6,187.01, not a sum of the lines.
    expect(html).toContain("Rs. 6,187.01");
    expect(html).toContain("Your CRM credit is taken off.");
    expect(html).toMatch(/role="alert"[^>]*>.*That code has expired\./);
  });
  it("in Nepali the line names come from the catalog text, falling back to English", () => {
    const html = render(<QuotePanel quote={QUOTE} />, "ne");
    expect(html).toContain("होटल · पूरा, १ वर्ष");
    expect(html).toContain("CRM: unused days");
    expect(html).toContain(ne["mkt.total"]);
  });
  it("no page adds, subtracts or multiplies a paisa amount itself", () => {
    for (const f of ["./Cart.jsx", "./Subscriptions.jsx", "./Marketplace.jsx", "./PriceProtection.jsx"]) {
      expect(src(f), f).not.toMatch(/Paisa\s*[+*/]|[+*/]\s*\w+\.\w*Paisa|Paisa\s*-\s*\w/);
    }
  });
});

describe("EditionDrawer: compares editions from the catalog", () => {
  const app = { id: "hotel", name: { en: "Hotel" }, tagline: { en: "Rooms" }, availability: "live", trialDays: 14, freeEdition: true, editions: [
    { id: "free", name: { en: "Free" }, free: true, priceMonthPaisa: 0, priceYearPaisa: 0, limits: { rooms: 5 }, features: [] },
    { id: "full", name: { en: "Full" }, free: false, priceMonthPaisa: 70_000, priceYearPaisa: 700_000, limits: { rooms: null }, features: ["channel_manager"] },
  ] };
  const html = render(<EditionDrawer app={app} mine={undefined} opts={{ mode: "apps", salesEnabled: true }} onClose={() => {}} onChoose={() => {}} onInstall={() => {}} onTrial={() => {}} />);
  it("prices month and year, the saving, limits and features, with the right buttons", () => {
    expect(html).toContain("Rs. 700"); expect(html).toContain("Rs. 7,000");
    expect(html).toContain("You save 2 months");
    expect(html).toContain("Rooms"); expect(html).toContain("Unlimited"); expect(html).toContain(">5<");
    expect(html).toContain("Channel manager");
    expect(html).toContain("Install free"); expect(html).toContain("Add to cart"); expect(html).toContain("Try the full edition free for 14 days");
  });
  it("a business still on plans sees no buying buttons", () => {
    const plans = render(<EditionDrawer app={app} mine={undefined} opts={{ mode: "plans", salesEnabled: true }} onClose={() => {}} onChoose={() => {}} onInstall={() => {}} onTrial={() => {}} />);
    expect(plans).not.toContain("Add to cart"); expect(plans).not.toContain("Install free"); expect(plans).toContain("still on its Starter");
  });
  it("is a labelled dialog with a captioned table and row headers (keyboard and screen readers)", () => {
    expect(html).toMatch(/role="dialog"[^>]*aria-label="Hotel"/);
    expect(html).toContain("<caption"); expect(html).toContain('scope="row"'); expect(html).toContain('role="radiogroup"');
  });
});

describe("keyboard and phone layout (FRONTEND-KIT.md)", () => {
  const pages = ["./Cart.jsx", "./Subscriptions.jsx", "./Marketplace.jsx"].map(src).join("\n");
  it("every raw button says type=button; filter chips say aria-pressed; wide tables scroll inside their own box", () => {
    expect([...pages.matchAll(/<button(?![^>]*type="button")/g)]).toHaveLength(0);
    expect(src("./Marketplace.jsx")).toContain("aria-pressed={category === c}");
    expect(src("./Marketplace.jsx")).toContain('className="pf-table-wrap"');
    expect(pages).toContain('className="pf-plan-grid"'); // the card grid wraps to one column on a phone
    expect(pages).not.toMatch(/onClick=\{[^}]*\}\s*(?:className|style)=\{?"?[^>]*<(?:div|span)\s+onClick/);
  });
  it("the coupon box applies with Enter", () => {
    expect(src("./Cart.jsx")).toContain('if (e.key === "Enter") checkCoupon();');
  });
});

describe("the shell (go back: only for apps mode)", () => {
  const app = src("./BusinessApp.jsx");
  it("menu item only for apps, billing page by mode, all three routes need workspace.billing.manage", () => {
    expect(app).toContain('...(onApps ? [{ to: "/business/marketplace"');
    expect(app).toContain("{onApps ? <Subscriptions key={tenant.id} tenant={tenant} /> : <BusinessBilling tenant={tenant} canManage />}");
    expect(app).toMatch(/path: "\/business\/marketplace", render: \(\) => guard\(can\(role, "workspace\.billing\.manage"\)/);
    expect(app).toMatch(/path: "\/business\/marketplace\/cart", render: \(\) => guard\(can\(role, "workspace\.billing\.manage"\)/);
  });
  it("the mode comes from GET /entitlements, and stays null (today's pages) until it is known", () => {
    const mode = src("../billingMode.js");
    expect(mode).toContain('bizApi("GET", "/entitlements")');
    expect(mode).toContain("known.get(tenantId) ?? null");
  });
});

describe("texts: English and Nepali for every string", () => {
  const used = new Set(["./Cart.jsx", "./Subscriptions.jsx", "./Marketplace.jsx", "./PriceProtection.jsx", "./marketplaceLogic.js", "./BusinessApp.jsx"]
    .flatMap((f) => [...src(f).matchAll(/"((?:mkt|nav)\.[A-Za-z_]+)"/g)].map((m) => m[1])).filter((k) => k.startsWith("mkt.") || k === "nav.marketplace"));
  it("every key a page uses exists in English", () => {
    for (const k of used) expect(en[k], k).toBeTruthy();
    for (const k of ["all", "property", "hospitality", "sales", "money", "people", "growth", "settings"]) expect(en[`mkt.cat_${k}`]).toBeTruthy();
    for (const k of ["subscribe", "change", "renew", "addon"]) expect(en[`mkt.kind_${k}`]).toBeTruthy();
    for (const k of ["open", "paid", "void", "cancelled", "refunded"]) expect(en[`mkt.inv_${k}`]).toBeTruthy();
  });
  it("every English key has Nepali with the same {placeholders}", () => {
    const holes = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    expect(Object.keys(ne).sort()).toEqual(Object.keys(en).sort());
    for (const k of Object.keys(en)) expect(holes(ne[k]), k).toEqual(holes(en[k]));
  });
  it("never says verified", () => {
    for (const s of [...Object.values(en), ...Object.values(ne)]) expect(s).not.toMatch(/verif|प्रमाणित/i);
  });
});
