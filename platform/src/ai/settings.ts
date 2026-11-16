// A business's AI choices (MARKETPLACE-AND-BILLING.md section 10.4; P3-BE-8): which of its own AI connections to prefer, and whether a
// failing own key may fall back to Sheetal AI credits.
// Where it fits: a typed business setting (platform/src/settings/defs.ts SETTING_DEFS), read by the AI router (router.ts) and edited on the
// business's AI screen (P3-FE-6) through the business settings route.
// Rules: the fallback is OFF by default, so nobody is charged Sheetal credits by surprise when their own key stops working.

import { z } from "zod";
import type { SettingDef } from "../settings/types.js";

export const AI_PROVIDER_IDS = ["ai.anthropic", "ai.openai", "ai.gemini"] as const;
const BusinessAi = z.object({
  preferred: z.enum(["auto", ...AI_PROVIDER_IDS]),
  fallbackToSheetal: z.boolean(),
}).strict();
export type BusinessAiSettings = z.infer<typeof BusinessAi>;

export const BUSINESS_AI: SettingDef<BusinessAiSettings> = {
  key: "business.ai", scope: "business", schema: BusinessAi, default: { preferred: "auto", fallbackToSheetal: false }, group: "ai",
  label: { en: "AI: own key or Sheetal AI" },
  help: { en: "Which of your own AI connections to use first, and whether Sheetal AI credits may be used when your own key fails (off unless you switch it on)." },
  read: "workspace.settings.update", write: "workspace.settings.update", audit: "values",
};
