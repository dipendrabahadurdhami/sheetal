// Tests for the marketplace's plain rules (P3-FE-1): money from paisa, the card's status chip and buttons, search and order, the cart, and
// the request bodies: every body the pages build is parsed with the API's own .strict() rules (business/backend/src/modules/marketplace/bodies.ts),
// so a page can't send a shape the server refuses (TEAM-RULES #12).
// Where it fits: the root front-end test run (npx vitest run business/frontend).
import { describe, expect, it } from "vitest";
import { Cancel, Cart, Change, Checkout, CouponCheck, PayInvoice, Trial } from "../../../../business/backend/src/modules/marketplace/bodies.ts";
import {
  addToCart, addonItem, cardActions, categoriesOf, changeBody, checkoutBody, daysLeft, errorKey, invoiceTitle, itemLabel, lockView, monthsSaved,
  payInvoiceBody, priceLine, quoteBody, removeFromCart, renewItems, rsPaisa, setCartPeriod, statusOf, subscribeItem, textOf, visibleApps,
} from "./marketplaceLogic.js";

const NOW = new Date("2026-11-16T06:00:00Z");
const ed = (id, free, m, y, limits = {}, features = []) => ({ id, name: { en: id === "free" ? "Free" : "Full", ne: id === "free" ? "निःशुल्क" : "पूरा" }, free, priceMonthPaisa: m, priceYearPaisa: y, limits, features });
const HOTEL = { id: "hotel", name: { en: "Hotel", ne: "होटल" }, tagline: { en: "Rooms and bookings" }, category: "hospitality", availability: "live", trialDays: 14, freeEdition: true,
  editions: [ed("free", true, 0, 0, { rooms: 5 }), ed("full", false, 70_000, 700_000, { rooms: null }, ["channel_manager"])] };
const CRM = { id: "crm", name: { en: "CRM" }, tagline: { en: "Leads" }, category: "sales", availability: "live", trialDays: 14, freeEdition: false, editions: [ed("full", false, 30_000, 300_000)] };
const PAYROLL = { id: "payroll", name: { en: "Payroll" }, category: "people", availability: "coming_soon", trialDays: null, freeEdition: false, editions: [ed("full", false, 50_000, 500_000)] };
const APPS = [CRM, PAYROLL, HOTEL];
const ON = { mode: "apps", salesEnabled: true };

describe("money from paisa", () => {
  it("whole rupees, paisa when there are any, Indian grouping, minus for credits; no floating point", () => {
    expect(rsPaisa(70_000)).toBe("Rs. 700");
    expect(rsPaisa(123_456_750)).toBe("Rs. 12,34,567.50");
    expect(rsPaisa(5)).toBe("Rs. 0.05");
    expect(rsPaisa(-11_299)).toBe("− Rs. 112.99");
    expect(rsPaisa(null)).toBe("Rs. 0");
    // 0.1 + 0.2 style errors can't happen: 10 + 20 paisa is exactly 30.
    expect(rsPaisa(10 + 20)).toBe("Rs. 0.30");
  });
  it("catalog texts in Nepali fall back to English", () => {
    expect(textOf({ en: "Hotel", ne: "होटल" }, "ne")).toBe("होटल");
    expect(textOf({ en: "CRM" }, "ne")).toBe("CRM");
    expect(textOf("plain", "ne")).toBe("plain");
  });
});

describe("an app card", () => {
  it("status chip: not installed, free, trial n days, paid, ending, past due, read only, coming soon", () => {
    expect(statusOf(HOTEL, undefined).key).toBe("mkt.st_none");
    expect(statusOf(HOTEL, { installed: true, status: "active", access: "limited", periodMonths: null }).key).toBe("mkt.st_free");
    expect(statusOf(HOTEL, { installed: true, status: "trialing", trialEndsAt: "2026-11-20T06:00:00Z" }, NOW)).toEqual({ key: "mkt.st_trial", tone: "progress", days: 4 });
    expect(statusOf(HOTEL, { installed: true, status: "active", access: "full", periodMonths: 1 }).key).toBe("mkt.st_paid");
    expect(statusOf(HOTEL, { installed: true, status: "active", access: "full", periodMonths: 1, cancelAtPeriodEnd: true }).key).toBe("mkt.st_ending");
    expect(statusOf(HOTEL, { installed: true, status: "past_due", access: "full", periodMonths: 1 }).key).toBe("mkt.st_pastDue");
    expect(statusOf(HOTEL, { installed: true, status: "read_only", access: "read_only", periodMonths: 1 }).key).toBe("mkt.st_readOnly");
    expect(statusOf(PAYROLL, undefined).key).toBe("mkt.st_soon");
    expect(statusOf(HOTEL, { installed: false, status: "active" }).key).toBe("mkt.st_none"); // removed
  });
  it("price line and yearly saving come from the catalog numbers", () => {
    expect(priceLine(HOTEL)).toEqual({ fromMonthPaisa: 70_000, free: true });
    expect(priceLine(CRM)).toEqual({ fromMonthPaisa: 30_000, free: false });
    expect(monthsSaved(HOTEL.editions[1])).toBe(2); // yearly = 10 months (owner's answer 5)
    expect(monthsSaved(ed("x", false, 1000, 12_000))).toBeNull();
  });
  it("buttons: install free, try, upgrade, change; only looking outside apps mode; nothing to buy for coming soon or with sales off", () => {
    expect(cardActions(HOTEL, undefined, ON)).toEqual(["install", "trial", "upgrade", "view"]);
    expect(cardActions(CRM, undefined, ON)).toEqual(["trial", "upgrade", "view"]);
    expect(cardActions(CRM, { installed: true, trialUsed: true, status: "active", periodMonths: null }, ON)).toEqual(["upgrade", "view"]);
    expect(cardActions(HOTEL, { installed: true, periodMonths: 12, access: "full", trialUsed: false }, ON)).toEqual(["change", "view"]);
    expect(cardActions(HOTEL, undefined, { mode: "plans", salesEnabled: true })).toEqual(["view"]);
    expect(cardActions(HOTEL, undefined, { mode: "apps", salesEnabled: false })).toEqual(["install", "trial", "view"]);
    expect(cardActions(PAYROLL, undefined, ON)).toEqual(["notify"]);
  });
  it("search in both languages, category filter, popular for the type first, coming soon last", () => {
    expect(visibleApps(APPS, { type: "hotel" }).map((a) => a.id)).toEqual(["hotel", "crm", "payroll"]);
    expect(visibleApps(APPS, { type: "agency" }).map((a) => a.id)).toEqual(["crm", "hotel", "payroll"]);
    expect(visibleApps(APPS, { q: "होटल" }).map((a) => a.id)).toEqual(["hotel"]);
    expect(visibleApps(APPS, { q: "leads" }).map((a) => a.id)).toEqual(["crm"]);
    expect(visibleApps(APPS, { category: "people" }).map((a) => a.id)).toEqual(["payroll"]);
    expect(categoriesOf(APPS)).toEqual(["hospitality", "sales", "people"]);
  });
});

describe("the cart", () => {
  it("one item per app (the later choice wins), add-ons by key, period switch, remove", () => {
    let c = addToCart({ items: [] }, subscribeItem("hotel", "full", 1));
    c = addToCart(c, subscribeItem("crm", "full", 1));
    c = addToCart(c, subscribeItem("hotel", "full", 12));
    c = addToCart(c, addonItem("seats", 3));
    expect(c.items).toEqual([
      { kind: "subscribe", appId: "crm", editionId: "full", periodMonths: 1 },
      { kind: "subscribe", appId: "hotel", editionId: "full", periodMonths: 12 },
      { kind: "addon", addonKey: "seats", qty: 3 },
    ]);
    expect(setCartPeriod(c, 12).items.map((x) => x.periodMonths ?? x.qty)).toEqual([12, 12, 3]);
    expect(removeFromCart(c, 0).items).toHaveLength(2);
    expect(subscribeItem("hotel", "full", 1, { installed: true, periodMonths: 1 }).kind).toBe("change"); // already paid: a change
    expect(addonItem("seats", 0).qty).toBe(1);
    expect(addonItem("seats", 5000).qty).toBe(1000);
    let big = { items: [] };
    for (let i = 0; i < 25; i++) big = addToCart(big, addonItem(`a${i}`));
    expect(big.items).toHaveLength(20); // the API takes at most 20
  });
  it("cart lines are named from the catalog", () => {
    const catalog = { apps: APPS, addons: [{ key: "seats", name: { en: "Extra seat", ne: "थप सिट" } }] };
    expect(itemLabel(subscribeItem("hotel", "full", 1), catalog)).toBe("Hotel · Full");
    expect(itemLabel(subscribeItem("hotel", "full", 1), catalog, "ne")).toBe("होटल · पूरा");
    expect(itemLabel(addonItem("seats"), catalog, "ne")).toBe("थप सिट");
  });
});

describe("every body the pages send passes the API's .strict() rules (bodies.ts)", () => {
  const cart = addToCart(addToCart(addToCart({ items: [] }, subscribeItem("hotel", "full", 12)), subscribeItem("crm", "full", 1, { installed: true, periodMonths: 1 })), addonItem("seats", 2));
  it("quote, coupon check, checkout, pay an invoice, change, trial, cancel", () => {
    expect(Cart.parse(quoteBody(cart))).toEqual({ items: cart.items });
    expect(Cart.parse(quoteBody(cart, " save10 "))).toEqual({ items: cart.items, couponCode: "SAVE10" });
    expect(() => CouponCheck.parse(quoteBody(cart, "save10"))).not.toThrow();
    for (const p of ["esewa", "khalti", "fonepay", "manual"]) expect(() => Checkout.parse(checkoutBody(cart, p, "SAVE10"))).not.toThrow();
    expect(() => Checkout.parse(checkoutBody(cart, "esewa"))).not.toThrow();
    expect(() => PayInvoice.parse(payInvoiceBody("inv_123", "khalti"))).not.toThrow();
    expect(() => Change.parse(changeBody("full", 12))).not.toThrow();
    expect(() => Change.parse(changeBody("free", 3))).not.toThrow(); // anything but 12 is monthly
    expect(() => Trial.parse({})).not.toThrow();
    expect(() => Cancel.parse({})).not.toThrow();
    expect(() => Cart.parse({ items: renewItems([{ appId: "hotel", installed: true, periodMonths: 1, cancelAtPeriodEnd: false, currentPeriodEnd: "2026-12-16T00:00:00Z" }], NOW) })).not.toThrow();
  });
  it("a stray field would be refused, so the helpers never add one", () => {
    expect(() => Cart.parse({ ...quoteBody(cart), total: 1 })).toThrow();
    expect(Object.keys(checkoutBody(cart, "esewa")).sort()).toEqual(["items", "provider"]);
  });
});

describe("Subscriptions page rules", () => {
  it("the next invoice renews only paid apps that will renew", () => {
    const subs = [
      { appId: "hotel", installed: true, periodMonths: 1, cancelAtPeriodEnd: false, currentPeriodEnd: "2026-12-16T00:00:00Z" },
      { appId: "crm", installed: true, periodMonths: 12, cancelAtPeriodEnd: true, currentPeriodEnd: "2027-11-16T00:00:00Z" },
      { appId: "reviews", installed: true, periodMonths: null },
      { appId: "pos", installed: false, periodMonths: 1, currentPeriodEnd: "2026-12-16T00:00:00Z" },
      { appId: "people", installed: true, periodMonths: 1, cancelAtPeriodEnd: false, currentPeriodEnd: "2026-11-01T00:00:00Z" },
    ];
    expect(renewItems(subs, NOW)).toEqual([{ kind: "renew", appId: "hotel" }]);
  });
  it("price protection: days left, and choosing the apps from 60 days before the end", () => {
    expect(lockView(null)).toBeNull();
    expect(lockView({ lockEnd: "2027-03-01T00:00:00Z", monthlyGrossPaisa: 150_000, coversApps: [] }, NOW)).toMatchObject({ daysLeft: 105, chooseNow: false, ended: false });
    expect(lockView({ lockEnd: "2026-12-16T00:00:00Z", monthlyGrossPaisa: 150_000, coversApps: [] }, NOW)).toMatchObject({ chooseNow: true, ended: false });
    expect(lockView({ lockEnd: "2026-11-01T00:00:00Z", monthlyGrossPaisa: 150_000, coversApps: [] }, NOW)).toMatchObject({ daysLeft: 0, ended: true });
    expect(daysLeft(null)).toBe(0);
  });
  it("invoice titles and error codes", () => {
    const t = (k) => k;
    expect(invoiceTitle({ number: "INV-2083-84-0001" }, t)).toBe("INV-2083-84-0001");
    expect(invoiceTitle({ number: null, kind: "subscription" }, t)).toBe("mkt.toPayInvoice");
    expect(invoiceTitle({ number: null, kind: "credit" }, t)).toBe("mkt.creditNote");
    expect(errorKey({ code: "sales_off" })).toBe("mkt.err_salesOff");
    expect(errorKey({ code: "something_else" })).toBeNull();
  });
});
