// Read the shared platform database (the one Business and Admin write to) from the website.
import { config } from "@sheetal/shared/core/config";
import { seed, VERSION } from "@sheetal/shared/demo/demo";

export function readDb() {
  try { const s = JSON.parse(localStorage.getItem(config.storageKey)); if (s && s.version === VERSION) return s; } catch (e) { /* ignore */ }
  return seed();
}

const label = (list, id) => (list || []).find((x) => x.id === id)?.en || "";

// Published sale / rent listings from businesses, shaped like the API properties PropertyCard reads.
export function platformListings(db = readDb()) {
  const C = db.catalog || {};
  return (db.listings || []).filter((l) => l.status === "published" && (l.kind === "sell" || l.kind === "rentout")).map((l) => {
    const v = l.values || {};
    const tenant = (db.tenants || []).find((t) => t.id === l.tenantId);
    const loc = [v.location?.area, label(C.districts, v.location?.district)].filter(Boolean).join(", ") || tenant?.city || "";
    return {
      id: l.id, url: l.id, link: `/listing/${l.id}`, platform: true,
      name: l.title, purpose: l.kind === "rentout" ? "Rent" : "Sale", price: l.price || v.price || v.rent,
      property_type: label(C.categories, v.category), property_location: loc, district: label(C.districts, v.location?.district),
      bedroom: v.bedrooms, bathroom: v.bathrooms, property_area: v.landArea?.aana ? `${v.landArea.aana} Aana` : "",
      feature_image: v.photos?.[0]?.url, gallery_images: (v.photos || []).map((p) => p.url),
      created_at: l.updated, tenant,
    };
  });
}

export function matches(p, q = {}) {
  const kw = String(q.keyword || "").toLowerCase().trim();
  if (kw && ![p.name, p.property_location, p.id].join(" ").toLowerCase().includes(kw.replace(/^#/, ""))) return false;
  if (q.property_type && p.property_type && p.property_type.toLowerCase() !== q.property_type.toLowerCase()) return false;
  if (q.min_price && Number(p.price) < Number(q.min_price)) return false;
  if (q.max_price && Number(p.price) > Number(q.max_price)) return false;
  if (q.bedrooms && Number(p.bedroom || 0) < Number(q.bedrooms)) return false;
  return true;
}
