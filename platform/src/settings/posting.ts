// Free website posting (MARKETPLACE-AND-BILLING.md section 0 and P3-BE-11): the fair-use limits and the "go live at once" rule, as a setting
// staff edit in Admin -> Settings instead of plan limits.
// Where it fits: website/backend posting (POST /post-property) reads it for every post. Plan limits no longer decide how many listings a
// person may post once their business is on billingMode "shadow" or "apps" (a business still on "plans" keeps today's plan limit, MB 8.6).
// How it works: perDay = posts a person may send per Nepal day; perDayChecked = the same for posters whose business Sheetal has checked
// (documents checked by staff). checkedGoLive: those posts are published at once; everyone else's wait for review.
// Rules: public answers never say whether a business was checked (TEAM-RULES: never "verified" on a public page).

import { z } from "zod";
import type { SettingDef } from "./types.js";

export const PostingRules = z.object({
  fairUse: z.object({
    perDay: z.number().int().min(1).max(100),
    perDayChecked: z.number().int().min(1).max(500),
  }).strict(),
  checkedGoLive: z.boolean(),
}).strict();
export type PostingRules = z.infer<typeof PostingRules>;

export const POSTING_DEFAULT: PostingRules = { fairUse: { perDay: 5, perDayChecked: 20 }, checkedGoLive: true };

export const POSTING_SETTING: SettingDef<PostingRules> = {
  key: "platform.posting", scope: "platform", schema: PostingRules, default: POSTING_DEFAULT, group: "website",
  label: { en: "Free posting on the website" },
  help: { en: "How many properties one person may post in a day (more for businesses Sheetal has checked), and whether checked businesses' posts go live without review." },
  read: "platform.settings.read", write: "platform.settings.update", audit: "values",
  guard: (next) => (next.fairUse.perDayChecked < next.fairUse.perDay ? "Checked businesses can't have a lower daily limit than everyone else." : null),
};
