// Tests for the billing prompt kit (P3-FE-2): the one error mapper with every error body (new and old codes), the bus and the toast it
// replaces, the 80% banner rules (dismiss 7 days, never over a form), which app a page belongs to, useEntitlements' plain part, the API
// client reporting errors with their details, and each component rendered with each error body (no modal, no model call).
// Where it fits: the root front-end test run (npx vitest run packages/ui). Renders with react-dom/server.
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nProvider } from "@sheetal/shared/core/i18n";
import { appOfPath, bannerVisible, billingErrorOf, onBillingError, pctUsed, reportBillingError, shownAsPrompt } from "./errors.js";
import { AiLocked, EditionBadge, LimitBanner, ReadOnlyBanner, UpgradePanel } from "./Prompts.jsx";
import { entitlementsView } from "../../../sdk/src/hooks.js";
import { ApiError, createApi } from "../../../sdk/src/client.js";

const render = (el) => renderToStaticMarkup(<I18nProvider lang="en">{el}</I18nProvider>);
const DAY = 864e5;
// The bodies the server sends (MB 6.3, platform/src/billing/entitlements.ts, platform/src/core/errors.ts planLimit).
const BODIES = {
  limit_reached: { status: 402, code: "limit_reached", message: "Your Free Hotel has room for 5 and 5 are used.", details: { appId: "hotel", key: "rooms", limit: 5, used: 5, behaviour: "hard", tryEdition: "full", tryPricePaisa: 70000 } },
  soft: { status: 402, code: "limit_reached", message: "Your Free POS has room for 100 and 120 are used.", details: { appId: "pos", key: "bills_per_month", limit: 100, used: 120, behaviour: "soft", tryEdition: "full", tryPricePaisa: 40000 } },
  subscription_read_only: { status: 402, code: "subscription_read_only", message: "Your Expenses subscription has ended.", details: { appId: "expenses", access: "read_only" } },
  locked: { status: 402, code: "subscription_read_only", message: "Your subscription for Hotel is paused.", details: { appId: "hotel", access: "locked" } },
  app_not_available: { status: 403, code: "app_not_available", message: "Your business doesn't have CRM.", details: { appId: "crm", marketplace: true } },
  seat_limit: { status: 402, code: "seat_limit", message: "Your plan has 3 seats.", details: { limit: 3, used: 3 } },
  listing_limit: { status: 402, code: "listing_limit", message: "Your plan allows 5 listings." },
  plan_feature: { status: 402, code: "plan_feature", message: "Agreements are on Business and Pro.", details: { feature: "agreements" } },
  upgrade_needed: { status: 402, code: "upgrade_needed", message: "Upgrade to use this." },
  app_limit: { status: 402, code: "app_limit", message: "Your plan allows 5 here.", details: { limit: 5, key: "rooms" } },
};

describe("one mapper for every billing error", () => {
  it("new codes", () => {
    expect(billingErrorOf(BODIES.limit_reached)).toEqual({ code: "limit_reached", message: BODIES.limit_reached.message, appId: "hotel", kind: "limit", key: "rooms", limit: 5, used: 5, behaviour: "hard", tryEdition: "full", tryPricePaisa: 70000 });
    expect(billingErrorOf(BODIES.soft)).toMatchObject({ kind: "limit", behaviour: "soft", used: 120 });
    expect(billingErrorOf(BODIES.subscription_read_only)).toMatchObject({ kind: "read_only", access: "read_only", appId: "expenses" });
    expect(billingErrorOf(BODIES.locked)).toMatchObject({ kind: "read_only", access: "locked" });
    expect(billingErrorOf(BODIES.app_not_available)).toMatchObject({ kind: "app", appId: "crm" });
  });
  it("old codes map to the same panel for one release", () => {
    expect(billingErrorOf(BODIES.seat_limit)).toMatchObject({ kind: "limit", key: "seats", limit: 3, used: 3, tryEdition: null });
    expect(billingErrorOf(BODIES.listing_limit)).toMatchObject({ kind: "limit", key: "listings", limit: null });
    expect(billingErrorOf(BODIES.app_limit)).toMatchObject({ kind: "limit", key: "rooms", limit: 5 });
    expect(billingErrorOf(BODIES.plan_feature)).toMatchObject({ kind: "feature", feature: "agreements" });
    expect(billingErrorOf(BODIES.upgrade_needed)).toMatchObject({ kind: "feature" });
  });
  it("anything else is not a billing prompt; strange details are ignored, never trusted", () => {
    expect(billingErrorOf({ status: 409, code: "version_conflict", message: "x" })).toBeNull();
    expect(billingErrorOf(null)).toBeNull();
    expect(billingErrorOf({ code: "limit_reached", message: "m", details: { limit: "5", used: NaN, tryEdition: 3 } })).toMatchObject({ limit: null, used: null, tryEdition: null });
  });
});

describe("the bus replaces the failed action's toast", () => {
  it("reported errors reach the panel; the same message as a toast is skipped for a few seconds", () => {
    const got = [];
    const off = onBillingError((p) => got.push(p));
    reportBillingError(BODIES.limit_reached, 1000);
    reportBillingError({ status: 400, code: "bad", message: "Plain error" }, 1000);
    expect(got).toHaveLength(1);
    expect(shownAsPrompt(BODIES.limit_reached.message, 3000)).toBe(true);
    expect(shownAsPrompt(BODIES.limit_reached.message, 7000)).toBe(false);
    expect(shownAsPrompt("Plain error", 1000)).toBe(false);
    off();
  });
  it("with no panel mounted (today's plans) nothing is skipped", () => {
    reportBillingError({ ...BODIES.seat_limit, message: "No panel here" }, 1000);
    expect(shownAsPrompt("No panel here", 1000)).toBe(false);
  });
  it("the toast checks the bus before showing", async () => {
    const { readFileSync } = await import("node:fs");
    expect(readFileSync(new URL("../primitives.jsx", import.meta.url), "utf8")).toContain("if (shownAsPrompt(text)) return;");
  });
});

describe("the API client keeps the details and reports billing errors", () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  it("a 402 limit_reached becomes an ApiError with details, and the panel hears it", async () => {
    vi.stubGlobal("localStorage", { getItem: () => "tok" });
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ message: BODIES.limit_reached.message, code: "limit_reached", details: BODIES.limit_reached.details }), { status: 402, headers: { "content-type": "application/json" } }));
    const got = [];
    const off = onBillingError((p) => got.push(p));
    const { api } = createApi({ baseUrl: "http://127.0.0.1:4001/v1" });
    const err = await api("POST", "/hotel/rooms", {}).catch((e) => e);
    off();
    expect(err).toBeInstanceOf(ApiError);
    expect([err.status, err.code, err.details]).toEqual([402, "limit_reached", BODIES.limit_reached.details]);
    expect(got[0]).toMatchObject({ kind: "limit", used: 5, limit: 5 });
  });
});

describe("the 80% banner", () => {
  const now = 10 * DAY;
  it("shows from 80%, never for unlimited or over a form; dismiss hides it for 7 days", () => {
    expect(pctUsed(4, 5)).toBe(80);
    expect(bannerVisible({ used: 3, limit: 5, now })).toBe(false);
    expect(bannerVisible({ used: 4, limit: 5, now })).toBe(true);
    expect(bannerVisible({ used: 400, limit: null, now })).toBe(false);
    expect(bannerVisible({ used: 5, limit: 5, now, formOpen: true })).toBe(false);
    expect(bannerVisible({ used: 5, limit: 5, now, seen: { dismissedAt: now - 6 * DAY } })).toBe(false);
    expect(bannerVisible({ used: 5, limit: 5, now, seen: { dismissedAt: now - 8 * DAY } })).toBe(true);
  });
  it("renders the numbers it was given, with Upgrade and Hide", () => {
    const html = render(<LimitBanner appId="hotel" limitKey="rooms" label="rooms" used={4} limit={5} now={now} />);
    expect(html).toContain("4 of 5 used"); expect(html).toContain("/business/marketplace?app=hotel"); expect(html).toContain("Hide for 7 days");
    expect(render(<LimitBanner appId="hotel" limitKey="rooms" used={1} limit={5} now={now} />)).toBe("");
  });
});

describe("UpgradePanel with each error body", () => {
  for (const [name, body] of Object.entries(BODIES)) {
    it(`${name}: says what happened, never a modal`, () => {
      const html = render(<UpgradePanel prompt={billingErrorOf(body)} appName="Hotel" onClose={() => {}} />);
      expect(html).toContain(body.message.replace(/'/g, "&#x27;"));
      expect(html).toContain('role="alert"');
      expect(html).not.toContain('aria-modal="true"');
      expect(html).toContain("Not now");
    });
  }
  it("a limit shows the exact numbers, the next edition and its price", () => {
    const html = render(<UpgradePanel prompt={billingErrorOf(BODIES.limit_reached)} appName="Hotel" editionName="Full" onClose={() => {}} />);
    expect(html).toContain("5 of 5 used"); expect(html).toContain("Hotel Full lifts this limit: Rs. 700 a month."); expect(html).toContain("/business/marketplace?app=hotel");
  });
  it("read only sends to billing to renew", () => {
    expect(render(<UpgradePanel prompt={billingErrorOf(BODIES.subscription_read_only)} onClose={() => {}} />)).toContain('href="/business/billing"');
  });
});

describe("the other prompts", () => {
  it("ReadOnlyBanner explains and links to billing and export; nothing for full access", () => {
    const html = render(<ReadOnlyBanner appName="Expenses" access="read_only" />);
    expect(html).toContain("Your Expenses subscription has ended. Everything is safe.");
    expect(html).toContain("/business/billing"); expect(html).toContain("/business/data");
    expect(render(<ReadOnlyBanner appName="Hotel" access="locked" />)).toContain("is paused");
    expect(render(<ReadOnlyBanner appName="Hotel" access="full" />)).toBe("");
  });
  it("AiLocked shows a sample and Turn on AI, and calls nothing", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const html = render(<AiLocked sample="Dear guest, thank you for your stay…" />);
    vi.unstubAllGlobals();
    expect(html).toContain("Dear guest"); expect(html).toContain("Turn on AI"); expect(html).toContain("/business/ai-accounts");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("EditionBadge is a Full chip that opens the marketplace drawer", () => {
    const html = render(<EditionBadge appId="pos" />);
    expect(html).toContain("Full"); expect(html).toContain("/business/marketplace?app=pos"); expect(html).toContain("title=");
  });
});

describe("pages and apps; useEntitlements", () => {
  it("which app a page belongs to", () => {
    expect(appOfPath("/business/pos/shift")).toBe("pos");
    expect(appOfPath("/business/bookings")).toBe("hotel");
    expect(appOfPath("/business/invoices?x=1")).toBe("invoicing");
    expect(appOfPath("/business/settings")).toBeNull();
    expect(appOfPath("/admin/pos")).toBeNull();
  });
  it("on apps the answer is exact; on plans or while loading every app counts as there (the server still refuses)", () => {
    const apps = entitlementsView({ mode: "apps", apps: [{ appId: "hotel", access: "read_only", edition: "full", limits: { rooms: 20 } }, { appId: "crm", access: "none", edition: null, limits: {} }], seats: { used: 2, limit: 3 }, ai: "sheetal" });
    expect([apps.accessOf("hotel"), apps.hasApp("hotel"), apps.hasApp("crm"), apps.hasApp("pos")]).toEqual(["read_only", true, false, false]);
    expect([apps.editionOf("hotel"), apps.limitOf("hotel", "rooms"), apps.limitOf("hotel", "x"), apps.ai]).toEqual(["full", 20, null, "sheetal"]);
    const plans = entitlementsView({ mode: "plans", apps: [{ appId: "crm", access: "none" }] });
    expect([plans.hasApp("crm"), plans.accessOf("pos")]).toEqual([true, "full"]);
    expect(entitlementsView(null).hasApp("anything")).toBe(true);
  });
});
