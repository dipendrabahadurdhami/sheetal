// The input shapes of Agreements, unchanged from the old route file (P2-W1 stage 3), plus an optional `version` on a draft save.
// Where it fits: AgreementService parses every body with these (a ZodError becomes 422).

import { z } from "zod";
import { KINDS, LANGS, SignersInput } from "@sheetal/backend-core/domain/agreements";

export const Body = z.object({
  title: z.string().trim().min(1, "Give the agreement a title.").max(160),
  lang: z.enum(LANGS),
  values: z.record(z.string(), z.unknown()).default({}),
  bodyEn: z.string().max(30_000).default(""),
  bodyNe: z.string().max(30_000).default(""),
  signers: SignersInput.default([]),
  version: z.number().int().min(1).optional(),
});
export const Create = z.object({
  kind: z.enum(KINDS),
  lang: z.enum(LANGS).default("both"),
  leaseId: z.string().max(40).nullish(),
  leadId: z.string().max(40).nullish(),
  listingId: z.number().int().positive().nullish(),
  branchId: z.string().max(40).nullish(),
});
export const CancelBody = z.object({ note: z.string().trim().max(300).default("") });
