// The plain rules behind the marketplace, cart and subscriptions pages (P3-FE-1): money from paisa, the status chip and buttons of an
// app card, search and "popular for your type" order, the cart and the exact request bodies the pages send.
// Where it fits: Marketplace.jsx, Cart.jsx, Subscriptions.jsx and PriceProtection.jsx use these; marketplaceLogic.test.js checks them and
// parses every body with the API's own rules (business/backend/src/modules/marketplace/bodies.ts).
// How it works: pure functions, no React and no API calls, so they can be tested on their own.
// Rules: the screen never decides a price, a total, VAT or a limit: every number shown comes from GET /marketplace, a quote or the overview
// (MB 14.2). Money arrives in paisa (integers) and is shown with integer arithmetic only.

/** Paisa (an integer) as "Rs. 1,234" or "Rs. 1,234.50"; negative amounts get a minus sign. Never uses floating point for the paisa. */
export function rsPaisa(paisa) {
  const p = Math.round(Number(paisa) || 0);
  const neg = p < 0;
  const abs = Math.abs(p);
  const rupees = Math.floor(abs / 100).toLocaleString("en-IN");
  const ps = abs % 100;
  return `${neg ? "− " : ""}Rs. ${rupees}${ps ? `.${String(ps).padStart(2, "0")}` : ""}`;
}

/** A catalog text ({ en, ne? }) in the screen's language; Nepali falls back to English. */
export const textOf = (x, lang = "en") => (x == null ? "" : typeof x === "string" ? x : (lang === "ne" && x.ne) || x.en || "");

const DAY = 864e5;
/** Whole days left until a date (0 when it has passed). */
export const daysLeft = (iso, now = new Date()) => (iso ? Math.max(0, Math.ceil((new Date(iso) - now) / DAY)) : 0);

/**
 * The status chip of an app card (MB 14.1): Not installed, Free, Trial n days, Paid, Past due, Read only, Coming soon.
 * `mine` is the business's entry from GET /marketplace (undefined when never installed). Returns { key, tone, days? } (i18n key under mkt.).
 */
export function statusOf(app, mine, now = new Date()) {
  if (app.availability === "coming_soon") return { key: "mkt.st_soon", tone: "neutral" };
  if (!mine || !mine.installed) return { key: "mkt.st_none", tone: "neutral" };
  if (mine.status === "trialing") return { key: "mkt.st_trial", tone: "progress", days: daysLeft(mine.trialEndsAt, now) };
  if (mine.status === "past_due") return { key: "mkt.st_pastDue", tone: "action" };
  if (mine.status === "read_only" || mine.access === "read_only") return { key: "mkt.st_readOnly", tone: "action" };
  if (mine.periodMonths != null && mine.access === "full") return { key: mine.cancelAtPeriodEnd ? "mkt.st_ending" : "mkt.st_paid", tone: mine.cancelAtPeriodEnd ? "action" : "done" };
  return { key: "mkt.st_free", tone: "done" };
}

/** The editions that cost money, cheapest first (the catalog already sorts editions). */
export const paidEditions = (app) => (app.editions || []).filter((e) => !e.free);
/** The free edition of an app, when it has one switched on. */
export const freeEdition = (app) => (app.freeEdition ? (app.editions || []).find((e) => e.free) : undefined);

/** The card's price line: the lowest monthly price of a paid edition, and whether a free edition exists. */
export function priceLine(app) {
  const paid = paidEditions(app).map((e) => e.priceMonthPaisa).filter((p) => p > 0);
  return { fromMonthPaisa: paid.length ? Math.min(...paid) : null, free: !!freeEdition(app) };
}

/** "You save n months" on a yearly price, from the catalog numbers (null when the year isn't cheaper). */
export function monthsSaved(edition) {
  const m = edition.priceMonthPaisa, y = edition.priceYearPaisa;
  if (!m || !y || y >= m * 12) return null;
  return Math.round((m * 12 - y) / m);
}

/**
 * The buttons of an app card: which of install / trial / upgrade / change / view apply (MB 14.1). `mode` is the business's billing mode:
 * outside "apps" the cards are for looking only. `salesEnabled` false hides buying (the API would answer 409 sales_off).
 */
export function cardActions(app, mine, { mode, salesEnabled }) {
  if (app.availability === "coming_soon") return ["notify"];
  if (mode !== "apps") return ["view"];
  const installed = mine?.installed;
  const out = [];
  if (!installed && freeEdition(app)) out.push("install");
  if (app.trialDays && !mine?.trialUsed && paidEditions(app).length && !(mine?.periodMonths != null && mine?.access === "full")) out.push("trial");
  if (salesEnabled && paidEditions(app).length) out.push(mine?.periodMonths != null ? "change" : "upgrade");
  out.push("view");
  return out;
}

// Apps most businesses of a type use first. Only the order of the cards: prices and limits still come from the catalog.
const POPULAR = {
  hotel: ["hotel", "pos", "reviews", "people", "expenses", "invoicing"],
  host: ["hotel", "reviews", "expenses", "invoicing"],
  developer: ["projects", "collections", "crm", "listings", "agreements"],
  agency: ["listings", "crm", "rentals", "agreements", "invoicing"],
  sponsor: ["investments", "crm", "invoicing"],
};
export const popularFor = (type) => POPULAR[type] || [];

/** Cards to show: search (name and tagline, both languages) and category; popular apps for the business type first, coming soon last. */
export function visibleApps(apps, { q = "", category = "all", type } = {}) {
  const needle = q.trim().toLowerCase();
  const pop = popularFor(type);
  const rank = (a) => (a.availability === "coming_soon" ? 1000 : pop.includes(a.id) ? pop.indexOf(a.id) : 100);
  return apps
    .filter((a) => category === "all" || a.category === category)
    .filter((a) => !needle || [a.name?.en, a.name?.ne, a.tagline?.en, a.tagline?.ne, a.id].some((s) => s && s.toLowerCase().includes(needle)))
    .map((a, i) => [a, i])
    .sort(([a, i], [b, j]) => rank(a) - rank(b) || i - j)
    .map(([a]) => a);
}

/** The categories present in the catalog, in a fixed order. */
const CATEGORY_ORDER = ["property", "hospitality", "sales", "money", "people", "growth", "settings"];
export const categoriesOf = (apps) => CATEGORY_ORDER.filter((c) => apps.some((a) => a.category === c));

// ───────────── The cart ─────────────
// A cart is { items: [...] } with items exactly as the API takes them. One item per app (a later choice replaces the earlier one); add-ons by key.

const sameSlot = (a, b) => (a.kind === "addon" ? b.kind === "addon" && a.addonKey === b.addonKey : b.kind !== "addon" && a.appId === b.appId);

/** Adds an item, replacing any item for the same app (or the same add-on). At most 20 items (the API's limit). */
export function addToCart(cart, item) {
  const items = (cart?.items || []).filter((x) => !sameSlot(x, item));
  return { items: [...items, item].slice(-20) };
}
export const removeFromCart = (cart, i) => ({ items: (cart?.items || []).filter((_, k) => k !== i) });
/** Switches every app item between monthly and yearly (add-ons and renewals keep their own period). */
export const setCartPeriod = (cart, periodMonths) => ({ items: (cart?.items || []).map((x) => (x.kind === "subscribe" || x.kind === "change" ? { ...x, periodMonths } : x)) });

/** A new app, or a change of edition/period for an app already paid for. */
export const subscribeItem = (appId, editionId, periodMonths, mine) =>
  ({ kind: mine?.periodMonths != null && mine?.installed ? "change" : "subscribe", appId, editionId, periodMonths: periodMonths === 12 ? 12 : 1 });
export const addonItem = (addonKey, qty = 1) => ({ kind: "addon", addonKey, qty: Math.max(1, Math.min(1000, Math.floor(qty) || 1)) });

/** The body of POST /subscriptions/quote (and /coupons/check when a code is set). */
export function quoteBody(cart, couponCode) {
  const code = (couponCode || "").trim().toUpperCase();
  return code ? { items: cart.items, couponCode: code } : { items: cart.items };
}
/** The body of POST /subscriptions/checkout. */
export const checkoutBody = (cart, provider, couponCode) => ({ ...quoteBody(cart, couponCode), provider });
/** The body of POST /subscriptions/invoices/pay. */
export const payInvoiceBody = (invoiceId, provider) => ({ invoiceId, provider });
/** The body of POST /subscriptions/:appId/change. */
export const changeBody = (editionId, periodMonths) => ({ editionId, periodMonths: periodMonths === 12 ? 12 : 1 });

/** The cart line's name for the screen, from the catalog (the quote has its own description once it is loaded). */
export function itemLabel(item, catalog, lang = "en") {
  if (item.kind === "addon") return textOf(catalog?.addons?.find((a) => a.key === item.addonKey)?.name, lang) || item.addonKey;
  const app = catalog?.apps?.find((a) => a.id === item.appId);
  const ed = app?.editions?.find((e) => e.id === item.editionId);
  return [textOf(app?.name, lang) || item.appId, ed ? textOf(ed.name, lang) : null].filter(Boolean).join(" · ");
}

/** Which message to show for an API error code from these routes (falls back to the server's own message). */
const ERROR_KEYS = { billing_mode: "mkt.err_mode", sales_off: "mkt.err_salesOff", trial_used: "mkt.err_trialUsed", method_off: "mkt.err_methodOff", already_installed: "mkt.err_installed" };
export const errorKey = (e) => ERROR_KEYS[e?.code] || null;

// ───────────── Subscriptions page ─────────────

/** Subscriptions paid for by the period (monthly or yearly) that renew: the next invoice preview quotes a renewal of each. */
export const renewItems = (subs, now = new Date()) =>
  subs.filter((s) => s.installed && s.periodMonths != null && !s.cancelAtPeriodEnd && s.currentPeriodEnd && new Date(s.currentPeriodEnd) > now)
    .map((s) => ({ kind: "renew", appId: s.appId }));

/** The price-protection card: shown for a moved business; "Choose the apps you keep" from 60 days before the lock ends. */
export function lockView(lock, now = new Date()) {
  if (!lock) return null;
  const left = daysLeft(lock.lockEnd, now);
  return { ...lock, daysLeft: left, ended: new Date(lock.lockEnd) <= now, chooseNow: left <= 60 };
}

/** One invoice row's title: the tax number, or an i18n key until it is paid (numbers are given at payment, MB 9.1). */
export const invoiceTitle = (i, t) => i.number || t(i.kind === "credit" ? "mkt.creditNote" : "mkt.toPayInvoice");
