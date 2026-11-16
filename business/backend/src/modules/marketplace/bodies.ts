// The request bodies of the business marketplace API (P3-BE-6), in their own file so the screens' tests can check the bodies the pages
// send against the very same rules (TEAM-RULES #12: a .strict() body must match what the front-end sends; P3-FE-1).
// Where it fits: routes.ts parses every cart, checkout and invoice payment with these; business/frontend/src/pages/marketplaceLogic.test.js
// builds bodies with the page helpers and parses them here.
// Rules: plain zod only (no server imports), so a browser-side test can load it; every object is .strict().

import { z } from "zod";

export const AppId = z.string().regex(/^[a-z][a-z0-9_]{0,40}$/);
export const Item = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("subscribe"), appId: AppId, editionId: AppId, periodMonths: z.union([z.literal(1), z.literal(12)]) }).strict(),
  z.object({ kind: z.literal("change"), appId: AppId, editionId: AppId, periodMonths: z.union([z.literal(1), z.literal(12)]) }).strict(),
  z.object({ kind: z.literal("renew"), appId: AppId }).strict(),
  z.object({ kind: z.literal("addon"), addonKey: AppId, qty: z.number().int().min(1).max(1000) }).strict(),
]);
export const Cart = z.object({ items: z.array(Item).min(1).max(20), couponCode: z.string().trim().toUpperCase().max(32).optional() }).strict();
export const Checkout = Cart.extend({ provider: z.enum(["esewa", "khalti", "fonepay", "manual"]) }).strict();
export const PayInvoice = z.object({ invoiceId: z.string().max(40), provider: z.enum(["esewa", "khalti", "fonepay", "manual"]) }).strict();
export const CouponCheck = Cart.extend({ couponCode: z.string().trim().toUpperCase().min(3).max(32) }).strict();
export const Change = z.object({ editionId: AppId, periodMonths: z.union([z.literal(1), z.literal(12)]) }).strict();
export const Trial = z.object({ editionId: AppId.optional() }).strict();
export const Cancel = z.object({ reason: z.string().trim().max(500).optional() }).strict();
