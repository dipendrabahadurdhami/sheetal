// One error mapper for every billing answer of every app (MB 6.3 and 14.2, P3-FE-2): the new codes `limit_reached`,
// `subscription_read_only` and `app_not_available`, and the old ones (`seat_limit`, `listing_limit`, `plan_feature`, `upgrade_needed`,
// `app_limit`) all become the same shape, so one UpgradePanel handles them. Also the small "bus" the API client reports them on.
// Where it fits: packages/sdk/src/client.js reports every 402/403 billing error here; BillingPrompts.jsx listens and shows the panel;
// ToastProvider (primitives.jsx) skips the plain toast of an error the panel already shows ("replaces the failed action's toast").
// How it works: pure functions and a set of listeners; no React, no API calls.
// Rules: the numbers come only from the server's `details`; nothing here decides a price or a limit. Browser-safe, no imports.

const LIMIT_CODES = new Set(["limit_reached", "seat_limit", "listing_limit", "app_limit"]);
const FEATURE_CODES = new Set(["plan_feature", "upgrade_needed"]);

/**
 * An API error (ApiError or { status, code, message, details }) as a billing prompt, or null when it isn't one.
 * kind: "limit" (a hard stop), "read_only" (paused or ended subscription), "feature" (a paid feature), "app" (the app isn't installed).
 */
export function billingErrorOf(e) {
  if (!e || typeof e !== "object" || !e.code) return null;
  const d = e.details && typeof e.details === "object" ? e.details : {};
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const base = { code: e.code, message: e.message || "", appId: typeof d.appId === "string" ? d.appId : null };
  if (LIMIT_CODES.has(e.code)) {
    return { ...base, kind: "limit", key: d.key ?? (e.code === "seat_limit" ? "seats" : e.code === "listing_limit" ? "listings" : null),
      limit: num(d.limit), used: num(d.used), behaviour: d.behaviour === "soft" ? "soft" : "hard",
      tryEdition: typeof d.tryEdition === "string" ? d.tryEdition : null, tryPricePaisa: num(d.tryPricePaisa) };
  }
  if (e.code === "subscription_read_only") return { ...base, kind: "read_only", access: d.access === "locked" ? "locked" : "read_only" };
  if (e.code === "app_not_available") return { ...base, kind: "app" };
  if (FEATURE_CODES.has(e.code)) return { ...base, kind: "feature", feature: typeof d.feature === "string" ? d.feature : null };
  return null;
}

// ───────────── The bus ─────────────
const listeners = new Set();
const recent = new Map(); // message -> time it was shown in the panel

/** Called by the API client for every failed call; reports billing errors to the listeners. Returns the prompt or null. */
export function reportBillingError(e, now = Date.now()) {
  const b = billingErrorOf(e);
  if (!b || !listeners.size) return b;
  recent.set(b.message, now);
  listeners.forEach((fn) => fn(b));
  return b;
}
/** Listens for billing prompts; returns the unsubscribe function. */
export function onBillingError(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; }
/** True when the panel showed this exact message in the last few seconds, so the plain toast can be skipped. */
export function shownAsPrompt(text, now = Date.now(), withinMs = 5000) {
  const at = recent.get(text);
  return at != null && now - at <= withinMs;
}

// ───────────── The 80% banner rule (MB 14.2) ─────────────
export const WARN_AT_PCT = 80;
const DAY = 864e5;

/** Whole percent used (0 for an unlimited or unknown limit). */
export const pctUsed = (used, limit) => (limit == null || limit <= 0 || used == null ? 0 : Math.floor((used * 100) / limit));

/**
 * Whether the 80% banner shows now: at or over 80%, not dismissed in the last 7 days, and at most once a day (a page that already showed it
 * today keeps showing it until dismissed; a fresh day shows it again). `seen` is { shownDay, dismissedAt } kept in the browser.
 */
export function bannerVisible({ used, limit, seen = {}, now = Date.now(), formOpen = false }) {
  if (formOpen) return false; // never over a form
  if (pctUsed(used, limit) < WARN_AT_PCT) return false;
  if (seen.dismissedAt && now - seen.dismissedAt < 7 * DAY) return false;
  return true;
}

// ───────────── Which app a page belongs to ─────────────
// The business panel's first path part → the app it belongs to (for the read-only banner and the menu by app). Pages not listed are the
// workspace (settings, team, help), which is never read-only for billing.
const PATH_APP = {
  listings: "listings", checkups: "listings", promote: "listings",
  inbox: "crm", forms: "crm",
  bookings: "hotel", calendar: "hotel", channels: "hotel", frontdesk: "hotel",
  pos: "pos", stock: "pos",
  invoices: "invoicing", payouts: "invoicing",
  expenses: "expenses", reviews: "reviews", rentals: "rentals", agreements: "agreements",
  projects: "projects", collections: "collections", investors: "investments", people: "people",
};
/** The app of a business panel path ("/business/pos/shift" → "pos"), or null for workspace pages. */
export function appOfPath(path) {
  const seg = String(path || "").split("?")[0].split("/").filter(Boolean);
  return seg[0] === "business" && seg[1] ? PATH_APP[seg[1]] ?? null : null;
}
