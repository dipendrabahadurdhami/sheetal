// How a listing is shown to the business panel and what the wizard's summary writes: moved unchanged from business/backend/src/modules/listings/routes.ts (P2-W5).
// Where it fits: ListingService. row() is the listings-table row (plus `version`); formOf() is the wizard form for editing; columns() turns the wizard's
// summary into listing columns. Rules: no database reads here.

import type { Listing, ListingPhoto, ListingStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import { isPhotoName, photoUrl } from "@sheetal/backend-core/lib/photos";
import { LISTING_KINDS, purposeOf } from "@sheetal/backend-core/domain/listings";

export const LIVE: ListingStatus[] = ["published", "sold", "rented"];
export const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const n = z.coerce.number().min(0).max(1e13).optional().nullable().transform((v) => v ?? undefined);
const int = z.coerce.number().int().min(0).max(1000).optional().nullable().transform((v) => v ?? undefined);
const str = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => v || undefined);

export const Summary = z.object({
  title: z.string().trim().max(150).default(""),
  category: str(60), propertyType: str(80),
  price: n, pricePer: z.enum(["month", "night", "total"]).optional().nullable().transform((v) => v ?? undefined), negotiable: z.boolean().optional(),
  province: str(60), district: str(60), city: str(80), area: str(120), street: str(120), ward: str(10),
  lat: z.coerce.number().min(26).max(31).optional().nullable().transform((v) => v ?? undefined),
  lng: z.coerce.number().min(80).max(89).optional().nullable().transform((v) => v ?? undefined),
  bedrooms: int, bathrooms: int, kitchens: int, livingRooms: int, floors: n, parking: str(40),
  landArea: str(80), landSqft: n, builtArea: str(80), roadAccess: str(40), roadType: str(40), facing: str(30), builtYear: str(10), furnishing: str(40),
  facilities: z.array(z.string().trim().max(60)).max(80).default([]),
  description: str(20000), highlights: str(3000), youtubeUrl: z.string().trim().url().max(300).optional().nullable().or(z.literal("")).transform((v) => v || undefined),
  // Public extras the website may show (room types, unit types, house rules…). Small, plain values only.
  details: z.record(z.string().max(40), z.unknown()).default({}).refine((d) => JSON.stringify(d).length <= 20_000, "Too many details."),
  photos: z.array(z.string().refine(isPhotoName, "Unknown photo.")).max(40).default([]),
});
export type SummaryIn = z.infer<typeof Summary>;
export const Body = z.object({
  kind: z.enum(LISTING_KINDS),
  values: z.record(z.string(), z.unknown()).default({}).refine((v) => JSON.stringify(v).length <= 200_000, "The form is too large."),
  summary: Summary,
  /** true = send for review; false = keep as a draft. */
  submit: z.boolean().default(true),
  version: z.number().int().min(1).optional(),
});
/** The branch picked in the listing form (optional; otherwise the branch open in the panel). */
export const BranchPick = z.object({ branchId: z.string().max(40).nullish() });

export type Row = Listing & { photos: ListingPhoto[]; branch?: { id: string; name: string } | null; version: number };

/** Columns from the wizard's summary. */
export const columns = (kind: string, s: SummaryIn): Prisma.ListingUncheckedUpdateInput => ({
  kind, purpose: purposeOf(kind), title: s.title || "Untitled listing", category: s.category ?? "House", propertyType: s.propertyType ?? null,
  price: s.price ? BigInt(Math.round(s.price)) : null, pricePer: s.pricePer ?? (kind === "rentout" ? "month" : kind.startsWith("stay_") ? "night" : null), negotiable: !!s.negotiable,
  province: s.province ?? null, district: s.district ?? null, city: s.city ?? null, area: s.area ?? null, street: s.street ?? null, ward: s.ward ?? null,
  lat: s.lat ?? null, lng: s.lng ?? null,
  bedrooms: s.bedrooms ?? null, bathrooms: s.bathrooms ?? null, kitchens: s.kitchens ?? null, livingRooms: s.livingRooms ?? null, floors: s.floors ?? null, parking: s.parking ?? null,
  landArea: s.landArea ?? null, landSqft: s.landSqft ?? null, builtArea: s.builtArea ?? null, roadAccess: s.roadAccess ?? null, roadType: s.roadType ?? null,
  facing: s.facing ?? null, builtYear: s.builtYear ?? null, furnishing: s.furnishing ?? null, facilities: s.facilities,
  description: s.description ?? null, highlights: s.highlights ?? null, youtubeUrl: s.youtubeUrl ?? null, details: s.details as Prisma.InputJsonValue,
});
export const priv = (l: Listing) => (l.private ?? {}) as Record<string, unknown>;

/** A row for the listings table (same shape the panel already uses). */
export const row = (base: string, l: Row, leads: number) => ({
  id: l.code, tenantId: l.tenantId, kind: l.kind, title: l.title,
  // The panel calls Sheetal's check "in review".
  status: l.status === "pending" ? "in_review" : l.status,
  price: l.price == null ? 0 : Number(l.price), views: l.views, leads, updated: day(l.updatedAt),
  issues: l.status === "rejected" && l.reviewNote ? [l.reviewNote] : undefined,
  cover: l.photos[0] ? photoUrl(base, "thumbnail", l.photos[0].file) : null,
  link: LIVE.includes(l.status) ? `/property/${l.slug}` : null,
  checkDue: day(l.checkDueAt), lastChecked: day(l.lastCheckedAt), branchId: l.branchId, branch: l.branch?.name ?? null, version: l.version,
});

/** The wizard's form for editing. Listings that never went through the wizard (imported) get one from their columns. */
export function formOf(base: string, l: Row): Record<string, unknown> {
  const saved = priv(l).form;
  const photos = l.photos.map((p) => ({ id: p.file, file: p.file, url: photoUrl(base, "main", p.file) }));
  if (saved && typeof saved === "object") return { ...(saved as object), photos };
  const price = l.price == null ? undefined : Number(l.price);
  return {
    title: l.title, category: l.category.toLowerCase(), propertyType: l.propertyType ?? undefined,
    ...(l.kind === "rentout" ? { rent: price } : l.kind === "stay_unit" ? { nightly: price } : l.kind === "invest" ? { target: price } : { price }),
    negotiable: l.negotiable, location: l.district ? { district: l.district, custom: true, area: l.area ?? undefined } : undefined,
    ward: l.ward ? Number(l.ward) || undefined : undefined, tole: l.street ?? undefined,
    pin: l.lat && l.lng ? { lat: l.lat, lng: l.lng } : undefined,
    bedrooms: l.bedrooms ?? undefined, bathrooms: l.bathrooms ?? undefined, kitchens: l.kitchens ?? undefined, living: l.livingRooms ?? undefined, floors: l.floors ?? undefined,
    video: l.youtubeUrl ?? undefined, story: l.description ?? undefined, photos,
  };
}
