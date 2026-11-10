// Listing rules shared by the website, business and admin APIs: which kinds a business may list and how many.
// Where it fits: used when listings are created, edited, moved between businesses or posted from the website.
// How it works: kinds come from the business type, or every kind on a plan with all_kinds (Pro); the cap comes from
// the plan's limits.
// Rules: keep in step with shared/src/data/catalog.js and shared/src/core/plans.js (the screens use those copies).

import type { ListingStatus, Plan } from "@prisma/client";
import type { BusinessType } from "./permissions.js";

export const LISTING_KINDS = ["sell", "rentout", "stay_hotel", "stay_unit", "project", "invest"] as const;
export type ListingKind = (typeof LISTING_KINDS)[number];

const KINDS_BY_TYPE: Record<BusinessType, ListingKind[]> = {
  agency: ["sell", "rentout"], hotel: ["stay_hotel", "stay_unit"], host: ["stay_unit"], developer: ["project", "sell"], sponsor: ["invest"],
};

/** Kinds a business may list: its type's kinds, or all of them on a plan with all_kinds (Pro). */
export function kindsFor(type: string, plan: Pick<Plan, "features">, byType?: Record<string, string[]>): ListingKind[] {
  if ((plan.features as Record<string, boolean>)?.all_kinds) return [...LISTING_KINDS];
  // What Sheetal staff set in Admin → Listing setup (lib/catalog.ts), when they changed it.
  const staff = byType?.[type]?.filter((k): k is ListingKind => (LISTING_KINDS as readonly string[]).includes(k));
  if (staff) return staff;
  return KINDS_BY_TYPE[type as BusinessType] ?? ["sell"];
}

/** Sale or rent, for the website's filters. Stays are rented by the night. */
export const purposeOf = (kind: string): "sale" | "rent" => (kind === "rentout" || kind.startsWith("stay_") ? "rent" : "sale");

/** How many listings may exist at once: Starter 1, otherwise the plan's listing limit (-1 = no limit). */
export const listingCap = (plan: Pick<Plan, "price" | "limits">) => (plan.price > 0 ? ((plan.limits as Record<string, number>).listings ?? -1) : 1);

/** Listings that count against the plan: everything except removed, expired, archived and rejected. */
export const COUNTED: ListingStatus[] = ["draft", "pending", "published", "sold", "rented", "paused"];

/** Shown on the website. */
export const LIVE_STATUSES: ListingStatus[] = ["published", "sold", "rented"];

/** The roles that work with listings, whatever the business type. */
export const LISTING_PERMS = ["listings.manage", "projects.manage", "investments.manage", "calendar.edit"];

/** Days until an approved listing is first asked about in check-ups. */
export const FIRST_CHECKUP_DAYS = 30;
