// The plain rules behind the admin Pricing, Coupons, Approvals and business Subscriptions screens (P3-FE-3): rupee text ↔ paisa without
// floating point, editing a copy of the catalog, and the exact request bodies the BE-7 routes accept.
// Where it fits: Pricing.jsx, Coupons.jsx, PlatformApprovals.jsx and BusinessSubscriptions.jsx; pricingLogic.test.js checks every body against
// the API's own zod rules (admin/backend/src/modules/billing-bodies.ts).
// How it works: pure functions. Catalog edits never change the catalog passed in: they return a new one.
// Rules: the screen never works out who is affected or whether approval is needed: POST /admin/pricing/preview answers that.

/** "700", "700.5" or "700.50" (rupees typed by a person) as paisa (an integer), or null when it isn't a money amount. */
export function rupeesToPaisa(text) {
  const s = String(text ?? "").trim().replace(/,/g, "");
  const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] || "").padEnd(2, "0") || 0);
}
/** Paisa as rupee text for an input: 70000 → "700", 70050 → "700.50". */
export function paisaToRupees(paisa) {
  const p = Math.round(Number(paisa) || 0), a = Math.abs(p), ps = a % 100;
  return `${p < 0 ? "-" : ""}${Math.floor(a / 100)}${ps ? `.${String(ps).padStart(2, "0")}` : ""}`;
}
/** Paisa for reading: "Rs. 1,234.50". */
export const rsPaisa = (paisa) => {
  const p = Math.round(Number(paisa) || 0), a = Math.abs(p), ps = a % 100;
  return `${p < 0 ? "− " : ""}Rs. ${Math.floor(a / 100).toLocaleString("en-IN")}${ps ? `.${String(ps).padStart(2, "0")}` : ""}`;
};
export const textOf = (x) => (x == null ? "" : typeof x === "string" ? x : x.en || "");

const clone = (c) => JSON.parse(JSON.stringify(c));

/** Changes one field of an edition (price in paisa, name). */
export function setEdition(cat, appId, editionId, patch) {
  const c = clone(cat);
  Object.assign(c.apps[appId].editions[editionId], patch);
  return c;
}
/** A limit: value null = unlimited; behaviour hard/soft; soft limits keep their % over (default 20). */
export function setLimit(cat, appId, editionId, key, { value, behaviour, softOverPct }) {
  const c = clone(cat);
  const lim = { value: value === "" || value == null ? null : Math.max(0, Math.floor(Number(value))), behaviour: behaviour === "soft" ? "soft" : "hard" };
  if (lim.behaviour === "soft") lim.softOverPct = Math.max(1, Math.min(100, Math.floor(Number(softOverPct ?? 20)) || 20));
  c.apps[appId].editions[editionId].limits[key] = lim;
  return c;
}
export function toggleFeature(cat, appId, editionId, feature) {
  const c = clone(cat);
  const f = c.apps[appId].editions[editionId].features;
  c.apps[appId].editions[editionId].features = f.includes(feature) ? f.filter((x) => x !== feature) : [...f, feature];
  return c;
}
/** App-level settings: trial days (null = none), visible, free edition on, availability. */
export function setApp(cat, appId, patch) {
  const c = clone(cat);
  const a = c.apps[appId];
  if ("trialDays" in patch) a.trialDays = patch.trialDays === "" || patch.trialDays == null ? null : Math.max(0, Math.min(90, Math.floor(Number(patch.trialDays)) || 0)) || null;
  if ("visible" in patch) a.visible = !!patch.visible;
  if ("freeEditionEnabled" in patch) a.freeEditionEnabled = !!patch.freeEditionEnabled;
  if ("availability" in patch) a.availability = patch.availability === "coming_soon" ? "coming_soon" : "live";
  return c;
}
export function setAddon(cat, key, patch) {
  const c = clone(cat);
  Object.assign(c.addons.find((a) => a.key === key), patch);
  return c;
}
export function setSeatPrice(cat, patch) {
  const c = clone(cat);
  Object.assign(c.business.seatAddon, patch);
  return c;
}
export function setAiPlan(cat, key, patch) {
  const c = clone(cat);
  Object.assign(c.ai.plans.find((p) => p.key === key), patch);
  return c;
}
/** True when the edited copy differs from the one in use. */
export const isDirty = (a, b) => JSON.stringify(a) !== JSON.stringify(b);

// ───────────── Request bodies (BE-7) ─────────────
export const previewBody = (catalog) => ({ catalog });
export const saveBody = (catalog, reason) => ({ catalog, reason: String(reason || "").trim() });

/** The coupon form as POST /admin/coupons takes it. Amounts typed in rupees become paisa; empty optional fields are null. */
export function couponBody(f) {
  const kind = f.kind || "percent";
  const value = kind === "fixed_paisa" ? rupeesToPaisa(f.value) : Math.floor(Number(f.value));
  const appIds = (f.appIds || []).filter(Boolean);
  const editionIds = (f.editionIds || []).filter(Boolean);
  const date = (d) => (d ? new Date(`${d}T00:00:00+05:45`).toISOString() : null); // a Nepal date from the date picker
  return {
    code: String(f.code || "").trim().toUpperCase(), kind, value: value ?? 0,
    appliesTo: editionIds.length ? "editions" : appIds.length ? "apps" : "all", appIds, editionIds,
    firstPurchaseOnly: !!f.firstPurchaseOnly,
    minSpendPaisa: f.minSpend ? rupeesToPaisa(f.minSpend) : null,
    validFrom: date(f.validFrom), validTo: date(f.validTo),
    maxRedemptions: f.maxRedemptions ? Math.floor(Number(f.maxRedemptions)) : null,
    perBusinessLimit: Math.max(1, Math.floor(Number(f.perBusinessLimit || 1))),
    periods: Math.max(1, Math.min(12, Math.floor(Number(f.periods || 1)))),
  };
}
export const couponPatchBody = (coupon, patch) => ({ version: coupon.version, ...patch });

/** A gift or extension (POST /admin/subscriptions/:tenantId/grants). */
export function grantBody(f) {
  const b = { kind: f.kind, endsAt: new Date(`${f.endsAt}T23:59:59+05:45`).toISOString(), reason: String(f.reason || "").trim() };
  if (f.appId) b.appId = f.appId;
  if ((f.kind === "limit" || f.kind === "feature") && f.key) b.key = f.key;
  if ((f.kind === "limit" || f.kind === "seats") && f.value !== "" && f.value != null) b.value = Math.floor(Number(f.value));
  return b;
}
export const revokeBody = (reason) => ({ reason: String(reason || "").trim() });
export const extendTrialBody = (days, reason, version) => ({ days: Math.floor(Number(days)), reason: String(reason || "").trim(), version });
export const aiCreditsBody = (credits, days, reason) => ({ credits: Math.floor(Number(credits)), days: Math.floor(Number(days)), reason: String(reason || "").trim() });
export const decideBody = (decision, note) => ({ decision: decision === "approve" ? "approve" : "reject", note: String(note || "").trim() });

/** A reason must be 5 to 300 characters (the API says so too; checked here to keep the Save button honest). */
export const reasonOk = (r) => { const n = String(r || "").trim().length; return n >= 5 && n <= 300; };
