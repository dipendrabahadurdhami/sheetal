import type { ListingStatus, Plan } from "@prisma/client";
import type { BusinessType } from "./permissions.js";

// Listing rules shared by the website, business and admin APIs. Mirrors shared/src/data/catalog.js kindsByType
// and shared/src/core/plans.js (kindsFor, listingCap).

export const LISTING_KINDS = ["sell", "rentout", "stay_hotel", "stay_unit", "project", "invest"] as const;
export type ListingKind = (typeof LISTING_KINDS)[number];

const KINDS_BY_TYPE: Record<BusinessType, ListingKind[]> = {
  agency: ["sell", "rentout"], hotel: ["stay_hotel", "stay_unit"], host: ["stay_unit"], developer: ["project", "sell"], sponsor: ["invest"],
};

/** Kinds a business may list: its type's kinds, or all of them on a plan with all_kinds (Pro). */
export function kindsFor(type: string, plan: Pick<Plan, "features">): ListingKind[] {
  if ((plan.features as Record<string, boolean>)?.all_kinds) return [...LISTING_KINDS];
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
