// The pure part of Admin → Pricing → "Billing rules" (BillingRules.jsx): the platform.billing setting as a form and back.
// Where it fits: the panel reads GET /admin/settings/store/platform.billing and saves PUT … { value, reason } (the typed settings store);
// the server checks everything again (BillingSettingsSchema and its guard in platform/src/billing/catalog.ts).
// How it works: the form holds text for every number, so a half-typed value is never rounded under the person's fingers. formOf() makes the
// form from the saved value; problemsOf() says in plain words what is wrong; bodyOf() builds the request, keeping every field the form does
// not show (the migration lock, quote hours, …) exactly as it was saved.
// Rules: no floating point for money (the minimum charge is typed in rupees and sent as paisa); day lists are whole numbers, biggest first.

import { paisaToRupees, rupeesToPaisa } from "./pricingLogic";

/** The numbers the panel edits: [key, label, min, max, help]. */
export const RULE_FIELDS = [
  ["vatRatePct", "VAT %", 0, 50, "Shown on every invoice. Prices already include it."],
  ["trialDays", "Trial days", 0, 90, "A free trial of a paid edition, once per app per business."],
  ["graceDays", "Grace days", 0, 60, "After an unpaid renewal, everything keeps working this long."],
  ["readOnlyDays", "Read-only days", 0, 365, "After the grace: data can be read, not changed, this long."],
  ["refundWindowDays", "Refund window (days)", 0, 90, "A refund can be asked this many days after a payment."],
  ["priceChangeNoticeDays", "Price rise notice (days)", 0, 180, "A price rise reaches a renewal only after this notice."],
];

const listText = (a) => (Array.isArray(a) ? a.join(", ") : "");

/** The saved value as form text. */
export function formOf(value) {
  const f = { salesEnabled: !!value.salesEnabled, minCharge: paisaToRupees(value.minChargePaisa), reminderDays: listText(value.reminderDays), pastDueReminderDays: listText(value.pastDueReminderDays) };
  for (const [k] of RULE_FIELDS) f[k] = String(value[k] ?? "");
  return f;
}

/** "7, 1" → [7, 1] (whole numbers within min..max, no repeats, biggest first); null when the text is not such a list. */
export function parseDays(text, min, max) {
  const parts = String(text ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length > 10 || parts.some((p) => !/^\d+$/.test(p))) return null;
  const nums = [...new Set(parts.map(Number))];
  if (nums.some((n) => n < min || n > max)) return null;
  return nums.sort((a, b) => b - a);
}

const numberOf = (text, min, max, whole) => {
  const t = String(text ?? "").trim();
  if (!(whole ? /^\d+$/ : /^\d+(\.\d{1,2})?$/).test(t)) return null;
  const n = Number(t);
  return n >= min && n <= max ? n : null;
};

/** What is wrong with the form, by field: { vatRatePct: "0 to 50", … }. Empty = fine. */
export function problemsOf(form) {
  const out = {};
  for (const [k, , min, max] of RULE_FIELDS) if (numberOf(form[k], min, max, k !== "vatRatePct") == null) out[k] = k === "vatRatePct" ? `A number from ${min} to ${max}.` : `A whole number from ${min} to ${max}.`;
  const p = rupeesToPaisa(form.minCharge);
  if (p == null || p > 100_000) out.minCharge = "An amount from Rs 0 to Rs 1,000.";
  if (!parseDays(form.reminderDays, 0, 60)) out.reminderDays = "Whole days from 0 to 60 with commas between, for example 7, 1.";
  if (!parseDays(form.pastDueReminderDays, 1, 60)) out.pastDueReminderDays = "Whole days from 1 to 60 with commas between, for example 3, 6.";
  return out;
}

/** The request body: the saved value with the form's fields put in; everything the form doesn't show stays as saved. null when the form has problems. */
export function bodyOf(saved, form, reason) {
  if (Object.keys(problemsOf(form)).length) return null;
  const value = { ...saved, salesEnabled: !!form.salesEnabled, minChargePaisa: rupeesToPaisa(form.minCharge), reminderDays: parseDays(form.reminderDays, 0, 60), pastDueReminderDays: parseDays(form.pastDueReminderDays, 1, 60).sort((a, b) => a - b) };
  for (const [k] of RULE_FIELDS) value[k] = Number(String(form[k]).trim());
  return { value, reason: String(reason ?? "").trim() };
}

/** True when the form differs from what is saved. */
export const rulesDirty = (saved, form) => JSON.stringify(formOf(saved)) !== JSON.stringify({ ...formOf(saved), ...form });
