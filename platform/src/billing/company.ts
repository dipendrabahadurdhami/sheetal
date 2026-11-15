// Sheetal's own company details for tax invoices (MARKETPLACE-AND-BILLING.md section 9.3, SETTINGS.md section 2.1: platform.company).
// Where it fits: a typed setting (defs.ts SETTING_DEFS), edited in Admin -> Settings with a reason. When a subscription invoice is paid,
// applySubscriptionPayment() copies sellerSnapshot() into Invoice.sellerSnapshot, so a later change never alters an issued invoice.
// How it works: the trade name defaults to the site name ("Sheetal Property"); empty fields are left out of the snapshot, so until the owner
// enters the legal details an invoice carries only the trade name (what it carried before this setting existed).
// Rules: PRIVATE. PAN and the legal name appear only on the invoice (a private page for the paying business and staff), never on a public page
// or the public catalog. The technology company is never named here.

import { z } from "zod";
import type { SettingDef } from "../settings/types.js";

const Field = (max: number) => z.string().trim().max(max);
const Company = z.object({
  tradeName: Field(120), legalName: Field(160), pan: z.string().trim().regex(/^(\d{9})?$/, "A PAN has 9 digits."),
  vatRegistered: z.boolean(), address: Field(300), phone: Field(40), email: z.union([z.literal(""), z.email().max(120)]),
}).strict();
export type CompanyDetails = z.infer<typeof Company>;

export const COMPANY_DEFAULT: CompanyDetails = { tradeName: "", legalName: "", pan: "", vatRegistered: false, address: "", phone: "", email: "" };

export const COMPANY_SETTING: SettingDef<CompanyDetails> = {
  key: "platform.company", scope: "platform", schema: Company, default: COMPANY_DEFAULT, group: "company",
  label: { en: "Company details on invoices" }, help: { en: "The seller's legal name, PAN, address and contact printed on Sheetal's tax invoices. Never shown on public pages." },
  read: "platform.settings.read", write: "platform.settings.update", needsReason: true, audit: "names",
};

/** What a tax invoice keeps of the seller: the trade name (or the site name) and every detail that was filled in. */
export function sellerSnapshot(c: CompanyDetails, siteName: string): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = { name: c.tradeName || siteName };
  for (const k of ["legalName", "pan", "address", "phone", "email"] as const) if (c[k]) out[k] = c[k];
  if (c.pan && c.vatRegistered) out.vatRegistered = true;
  return out;
}
