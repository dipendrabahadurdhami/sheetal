// The plain rules behind Admin → Sales, Revenue and Billing (P3-FE-4): the range picker's query (Nepal days), CSV links, checking that the
// shown totals are the sum of the shown rows, and the company-details body.
// Where it fits: Sales.jsx, Revenue.jsx, BillingV3.jsx and LegalInfo.jsx; reportsLogic.test.jsx checks them.
// How it works: pure functions. The server works out every range in Nepal time (UTC+05:45) and every sum; the screen only sends the picked range.
// Rules: a custom range is two Nepal dates (YYYY-MM-DD), the start not after the end, at most 366 days.

export const RANGES = [{ id: "today", label: "Today" }, { id: "7d", label: "7 days" }, { id: "30d", label: "30 days" }, { id: "custom", label: "Custom" }];

/** Today's date in Nepal (YYYY-MM-DD), whatever the viewer's clock zone. */
export const nepalToday = (now = new Date()) => new Date(now.getTime() + (5 * 60 + 45) * 60000).toISOString().slice(0, 10);

/** A custom range is usable: two dates, from ≤ to, at most 366 days. */
export function customOk(from, to) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from || "") || !/^\d{4}-\d{2}-\d{2}$/.test(to || "")) return false;
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 864e5;
  return days >= 0 && days <= 366;
}

/** The query string for a range (and extra filters), e.g. "?range=custom&from=2026-11-01&to=2026-11-15&appId=hotel". */
export function rangeQuery({ range = "30d", from, to } = {}, extra = {}, format) {
  const p = new URLSearchParams({ range });
  if (range === "custom") { p.set("from", from); p.set("to", to); }
  for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  if (format) p.set("format", format);
  return `?${p.toString()}`;
}

/** Sums one money field of the rows: used to show that the totals line equals the rows (and to flag it if not). */
export const sumOf = (rows, key) => rows.reduce((a, r) => a + (Number(r[key]) || 0), 0);
/** True when every listed field of `totals` equals the sum of the rows (all rows are on screen). */
export const totalsMatch = (rows, totals, keys) => keys.every((k) => sumOf(rows, k) === Number(totals?.[k] ?? 0));

/** "+12.5%", "−3%", "new" (no earlier sales) or "—". */
export function changeLabel(pct) {
  if (pct === null || pct === undefined) return "new";
  if (!Number.isFinite(pct)) return "—";
  const r = Math.round(pct * 10) / 10;
  return `${r > 0 ? "+" : r < 0 ? "−" : ""}${Math.abs(r)}%`;
}

/** The company-details form as PUT /admin/settings/store/platform.company takes it ({ value, reason }). */
export function companyBody(f, reason) {
  const t = (s) => String(s ?? "").trim();
  return { value: { tradeName: t(f.tradeName), legalName: t(f.legalName), pan: t(f.pan).replace(/\s+/g, ""), vatRegistered: !!f.vatRegistered, address: t(f.address), phone: t(f.phone), email: t(f.email) }, reason: t(reason) };
}
export const panOk = (pan) => /^(\d{9})?$/.test(String(pan ?? "").replace(/\s+/g, ""));
