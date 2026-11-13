// The business settings model: the defaults of every settings section and how saved settings lie over them.
// Where it fits: the Settings page (pages/SettingsPage.jsx), and the panel's forms, invoices and settings loader (business/frontend imports these through
// the BusinessSettings.jsx shim). Moved here from business/frontend/src/pages/BusinessSettings.jsx in P2-W6.
// Rules: pure functions and constants; the server keeps the saved values (GET/PUT /workspace/settings, PATCH /workspace/profile).

// Brand presets stay inside the logo palette by default; businesses may also enter their own hex.
export const BRAND_PRESETS = ["#9D1D21", "#EA2229", "#59595B", "#1F6F5C", "#1E4E8C", "#7A4B12", "#5B3B8C", "#0F766E"];

export const defaultTenantSettings = (tenant) => ({
  profile: { displayName: tenant.name, city: tenant.city || "", phone: tenant.phone || "", email: tenant.email || "", address: tenant.address ?? (tenant.city ? `${tenant.city}, Nepal` : ""), pan: tenant.pan || "", vatRegistered: tenant.vatRegistered ?? true, website: tenant.website || "" },
  branding: { useBrand: false, color: "#9D1D21", logoText: tenant.name.split(" ").map((w) => w[0]).slice(0, 2).join(""), receiptHeader: tenant.name, receiptFooter: "Thank you. Please visit again.", showPoweredBy: true },
  payments: {
    mode: "shetal", // shetal = Sheetal collects and pays out; own = money goes straight to the business
    payoutBank: { bank: "", holder: tenant.owner, account: "", branch: tenant.city }, // filled in by the business
    own: { fonepay: { on: true, merchant: "", qr: null }, esewa: { on: false, merchant: "" }, khalti: { on: false, key: "" }, bankQr: { on: true, bank: "", qr: null }, cash: { on: true } },
    advancePct: 30, autoReceipt: true, partialAllowed: true,
  },
  notifications: { newBooking: { app: true, sms: true, email: true, wa: true }, payment: { app: true, sms: false, email: true, wa: true }, lead: { app: true, sms: false, email: false, wa: true }, agreement: { app: true, sms: true, email: true, wa: false }, dailySummary: true, quietHours: true },
  listings: { defaultVisibility: "public", autoRenew: true, watermark: true, showPhone: "after_login" },
  documents: { defaultLang: "both", witnesses: 2, esign: "otp", stampSlot: true, bsDates: true },
});

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
/** `over` laid on `base`, object by object (saved settings over the defaults, so new defaults show up). */
export function mergeSettings(base, over) {
  if (!isObj(over)) return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = isObj(v) && isObj(base?.[k]) ? mergeSettings(base[k], v) : v;
  return out;
}

// The tabs saved as settings sections on the server (the profile has its own endpoint).
export const SERVER_SECTIONS = ["branding", "payments", "notifications", "listings", "documents"];

