import React from "react";
import { Icon } from "@sheetal/shared/core/icons";

// Small pieces the public pages share with the business app (each app keeps its own copy)
export function Counter({ value, min = 0, max = 99, onChange, label }) {
  return (
    <div className="pf-counter" role="group" aria-label={label}>
      <button type="button" aria-label={`${label} −`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}><Icon name="minus" size={16} /></button>
      <b className="tnum" aria-live="polite">{value}</b>
      <button type="button" aria-label={`${label} +`} disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}><Icon name="plus" size={16} /></button>
    </div>
  );
}

export const defaultTenantSettings = (tenant) => ({
  profile: { displayName: tenant.name, phone: tenant.phone, email: tenant.email, address: `${tenant.city}, Nepal`, pan: tenant.pan, vatRegistered: true, website: "" },
  branding: { useBrand: false, color: "#9D1D21", logoText: tenant.name.split(" ").map((w) => w[0]).slice(0, 2).join(""), receiptHeader: tenant.name, receiptFooter: "Thank you. Please visit again.", showPoweredBy: true },
  payments: {
    mode: "shetal", // shetal = Sheetal collects and pays out; own = money goes straight to the business
    payoutBank: { bank: "NIC Asia", holder: tenant.owner, account: "•••• 4021", branch: tenant.city },
    own: { fonepay: { on: true, merchant: "", qr: null }, esewa: { on: false, merchant: "" }, khalti: { on: false, key: "" }, bankQr: { on: true, bank: "NIC Asia", qr: null }, cash: { on: true } },
    advancePct: 30, autoReceipt: true, partialAllowed: true,
  },
  notifications: { newBooking: { app: true, sms: true, email: true, wa: true }, payment: { app: true, sms: false, email: true, wa: true }, lead: { app: true, sms: false, email: false, wa: true }, agreement: { app: true, sms: true, email: true, wa: false }, dailySummary: true, quietHours: true },
  listings: { defaultVisibility: "public", autoRenew: true, watermark: true, showPhone: "after_login" },
  documents: { defaultLang: "both", witnesses: 2, esign: "otp", stampSlot: true, bsDates: true },
});
