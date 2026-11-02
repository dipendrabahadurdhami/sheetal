import type { Listing, ListingPhoto, Tenant } from "@prisma/client";
import type { Config } from "@sheetal/backend-core/config";
import { approx, validLatLng } from "./geo.js";

// Listing → the JSON the website already reads (field names from the old site's API, see website/frontend/src/utils/format.js).
// Only public data goes out: `private` is never read here, and the location is always an approximate area.

export type ListingRow = Listing & { photos: ListingPhoto[] };
export type AgencyRow = Pick<Tenant, "id" | "name" | "city" | "email" | "phone"> & { listings?: number };

const STATUS_LABEL: Record<string, string> = { sold: "SOLD OUT", rented: "RENTED OUT" };

export function mediaBase(config: Config) {
  return (config.MEDIA_URL ?? `${config.API_URL.replace(/\/$/, "")}/media`).replace(/\/$/, "");
}

const photoUrl = (base: string, size: "main" | "thumbnail", file: string) => `${base}/property/${size}/${encodeURIComponent(file)}`;
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
    address: a.city ? `${a.city}, Nepal` : "Nepal",
    phone: a.phone,
    whatsapp: a.phone,
    email: a.email,
    photo: null,
    listings_count: a.listings ?? 0,
  };
}
