// The input shapes of Projects (units, holds, reservations, reservation payments), unchanged from the old route file (P2-W3), plus an optional `version`.

import { z } from "zod";

export const Money = z.number().int().min(0).max(1e12);
export const AddUnits = z.object({ block: z.string().trim().max(20).default(""), type: z.string().trim().min(1).max(40), sizeSqft: z.number().int().min(0).optional(), price: Money, nos: z.array(z.string().trim().min(1).max(20)).min(1).max(500) });
export const EditUnit = z.object({ price: Money.optional(), type: z.string().max(40).optional(), sizeSqft: z.number().int().min(0).optional(), blocked: z.boolean().optional(), version: z.number().int().min(1).optional() });
export const Hold = z.object({ days: z.number().int().min(1).max(14).default(3) });
export const Reserve = z.object({
  buyer: z.string().trim().min(2).max(80), phone: z.string().trim().max(30).optional(), email: z.union([z.email(), z.literal("")]).optional(), price: Money.optional(),
  plan: z.array(z.object({ label: z.string().trim().min(1).max(60), due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), amount: Money })).max(60).default([]), notes: z.string().max(1000).optional(),
});
export const Pay = z.object({ amount: z.number().int().refine((v) => v !== 0).refine((v) => Math.abs(v) <= 1e12), method: z.enum(["cash", "bank", "cheque", "fonepay", "esewa", "khalti"]), ref: z.string().trim().max(80).optional(), note: z.string().trim().max(200).optional() });
export const CancelBody = z.object({ note: z.string().trim().min(3, "Say why.").max(300) });
