// Turns database rows into the JSON the website reads (listings, cards, agencies).
// Where it fits: used by the catalogue routes and anywhere else the website shows a listing or an agency.
// How it works: keeps the old site's field names (see website/frontend/src/utils/format.js) so pages work unchanged.
// Rules: only public data goes out: a listing's private details are never read here, and locations are approximate.

import type { Listing, ListingPhoto, Tenant } from "@prisma/client";
import { mediaBase, photoUrl } from "@sheetal/backend-core/lib/photos";
import { approx, validLatLng } from "./geo.js";

export type ListingRow = Listing & { photos: ListingPhoto[] };
export type AgencyRow = Pick<Tenant, "id" | "name" | "city" | "email" | "phone" | "logoUrl"> & Partial<Pick<Tenant, "address" | "website" | "verifiedAt">> & { listings?: number };

const STATUS_LABEL: Record<string, string> = { sold: "SOLD OUT", rented: "RENTED OUT" };

export { mediaBase };
const num = (v: bigint | number | null | undefined) => (v == null ? null : Number(v));

/** What a card, list or map needs. */
export function listingCard(l: ListingRow, base: string) {
  const purpose = l.purpose === "rent" ? "Rent" : "Sale";
  const cover = l.photos[0]?.file;
  const point = validLatLng(l.lat, l.lng);
  const [lat, lng] = point ? approx(point[0], point[1], l.id) : [null, null];
  const price = num(l.price);
  return {
    id: l.id,
    property_code: l.code,
    url: l.slug,
    link: `/property/${l.slug}`,
    name: l.title,
    title: l.title,
    // sell, rentout, stay_hotel, stay_unit, project or invest (shared/src/data/catalog.js).
    kind: l.kind,
    purpose,
    advertisement_purpose: purpose,
    property_type: l.propertyType ?? l.category,
    category: l.category,
    propertycategory: l.category,
    total_price: price,
    price,
    rent_per_month: l.purpose === "rent" ? price : null,
    price_per: l.pricePer,
    price_negotiable: l.negotiable,
    property_location: [...new Set([l.area, l.city].filter(Boolean))].join(", ") || l.district,
    tol: l.area,
    town: l.city,
    city: l.city,
    district: l.district,
    zone: l.province,
    street: l.street,
    bedroom: l.bedrooms ?? 0,
    bedrooms: l.bedrooms ?? 0,
    bathroom: l.bathrooms ?? 0,
    bathrooms: l.bathrooms ?? 0,
    floors: l.floors,
    property_area: l.landArea ?? l.builtArea,
    built_up_area: l.builtArea,
    road_access: l.roadAccess,
    land_facing: l.facing,
    furnishing: l.furnishing,
    property_status: STATUS_LABEL[l.status] ?? "AVAILABLE",
    sold: l.status === "sold" || l.status === "rented" ? 1 : 0,
    is_featured: l.featured,
    views: l.views,
    feature_image: cover ? photoUrl(base, "main", cover) : null,
    thumbnail: cover ? photoUrl(base, "thumbnail", cover) : null,
    lat, lng, latitude: lat, longitude: lng,
    // The website draws an area around this point instead of a pin (it is already shifted here).
    location_approximate: true,
    checked_at: l.lastCheckedAt,
    created_at: l.publishedAt ?? l.createdAt,
    updated_at: l.updatedAt,
  };
}

/** Everything the property page shows. */
export function listingDetail(l: ListingRow, base: string, agency: AgencyRow | null) {
  const details = (l.details ?? {}) as Record<string, unknown>;
  return {
    ...details,
    ...listingCard(l, base),
    property_description: l.description,
    property_highlights: l.highlights,
    kitchens: l.kitchens,
    living_room: l.livingRooms,
    parking: l.parking,
    road_type: l.roadType,
    built_year: l.builtYear,
    completion_year: l.builtYear,
    youtube_url: l.youtubeUrl,
    facilities: l.facilities,
    amenities: l.facilities,
    gallery_images: l.photos.map((p) => ({ image: photoUrl(base, "main", p.file), thumbnail: photoUrl(base, "thumbnail", p.file) })),
    agent_id: agency?.id ?? null,
    agent: agency ? agencyJson(agency) : null,
  };
}

/** A business's public profile, in the shape of the old "agent". Contact details are the business's own. */
export function agencyJson(a: AgencyRow) {
  return {
    id: a.id,
    first_name: a.name,
    last_name: "",
    user_name: a.name,
    name: a.name,
    company_name: a.name,
    address: a.address || (a.city ? `${a.city}, Nepal` : "Nepal"),
    website_url: a.website ?? null,
    // Documents checked by Sheetal.
    is_verified: !!a.verifiedAt,
    phone: a.phone,
    whatsapp: a.phone,
    email: a.email,
    photo: a.logoUrl,
    listings_count: a.listings ?? 0,
  };
}
